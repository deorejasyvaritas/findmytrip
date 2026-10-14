import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TripPackage } from "../../shared/types.ts";
import { applyRecheck, diffPackage, itemQuote, recheckRequest, type ItemDiff, type RecheckResponse } from "../../shared/recheck.ts";
import { ageHours } from "../../shared/price-age.ts";
import { api } from "./api.ts";

// "Revisar precios" de un viaje guardado. La última revisión queda en este
// navegador (no en la cuenta: no gasta escrituras), así al volver a Mis viajes
// se sigue viendo qué subió o bajó.

const KEY = (id: string) => `fmt.recheck.${id}`;
/** Revisión automática: una vez por día por viaje y hasta 3 viajes por visita. */
const AUTO_EVERY_H = 24;
let autoLeft = 3;

function load(id: string): RecheckResponse | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    const v = raw ? (JSON.parse(raw) as RecheckResponse) : null;
    return v && Array.isArray(v.results) && typeof v.checkedAt === "string" ? v : null;
  } catch {
    return null;
  }
}

function store(id: string, v: RecheckResponse): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(v));
  } catch {
    // Sin almacenamiento (modo privado): queda solo en pantalla.
  }
}

/** Horas desde el precio más viejo del viaje. */
export function oldestPriceHours(pkg: TripPackage, now = Date.now()): number {
  const ages = pkg.items.map((i) => itemQuote(i, pkg)?.at).filter(Boolean) as string[];
  return ages.length ? Math.max(...ages.map((a) => ageHours(a, now))) : ageHours(pkg.createdAt, now);
}

export interface PriceCheck {
  /** Hay algo que se pueda volver a consultar. */
  checkable: boolean;
  busy: boolean;
  error: string | null;
  checkedAt: string | null;
  diffs: Map<number, ItemDiff>;
  /** Hay montos para actualizar (precio exacto que cambió). */
  changed: boolean;
  /** Algún vuelo quedó sin precio exacto (se puede probar con Google). */
  missingFlight: boolean;
  run: (google?: boolean) => Promise<void>;
  apply: () => void;
}

export function usePriceCheck(pkg: TripPackage, onApply: (patch: Pick<TripPackage, "items" | "totalUSD">) => void, auto = false): PriceCheck {
  const request = useMemo(() => recheckRequest(pkg), [pkg]);
  const [res, setRes] = useState<RecheckResponse | null>(() => load(pkg.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (google = false) => {
      if (running.current || !request.length) return;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await api.recheck(request, google);
        setRes(r);
        store(pkg.id, r);
      } catch (err) {
        setError((err as Error).message || "No pudimos revisar los precios. Probá de nuevo.");
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [pkg.id, request],
  );

  // Revisión liviana al abrir Mis viajes: viajes por hacer, con precios de más de un día.
  useEffect(() => {
    if (!auto || !request.length || pkg.status === "reservado" || autoLeft <= 0) return;
    if (pkg.departDate && pkg.departDate < new Date().toISOString().slice(0, 10)) return;
    const last = res ? ageHours(res.checkedAt) : Infinity;
    if (last < AUTO_EVERY_H || oldestPriceHours(pkg) < AUTO_EVERY_H) return;
    autoLeft--;
    void run(false);
    // Solo al montar la tarjeta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => (res ? diffPackage(pkg, res) : []), [pkg, res]);
  const diffs = useMemo(() => new Map(list.map((d) => [d.i, d])), [list]);
  return {
    checkable: request.length > 0,
    busy,
    error,
    checkedAt: res?.checkedAt ?? null,
    diffs,
    changed: list.some((d) => d.canUpdate),
    missingFlight: list.some((d) => pkg.items[d.i]?.kind === "vuelo" && (d.status === "sin-precio" || d.status === "otro-dia")),
    run,
    apply: () => {
      if (!res) return;
      const next = applyRecheck(pkg, list);
      onApply({ items: next.items, totalUSD: next.totalUSD });
    },
  };
}
