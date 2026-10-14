import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChecklistItem, TripPackage } from "../../shared/types.ts";
import { tripOp, type CTrip, type TripOp } from "../../shared/ctrip.ts";
import { api } from "./api.ts";

// Viajes con otros, del lado del navegador.
// - Se cargan al abrir la app y al volver a ella (para ver lo que cambiaron los demás).
// - Cada cambio se ve enseguida y se manda agrupado: una sola escritura por ráfaga
//   de cambios (1,5 s), para cuidar el límite diario de KV.
// - Si otra persona guardó antes (409), se re-aplica el cambio sobre lo último y se
//   reintenta una vez.

const DEBOUNCE_MS = 1500;
const REFRESH_MIN_MS = 5000;

export interface SharedTripsState {
  sharedTrips: CTrip[];
  /** Aviso para mostrar cuando un cambio no se pudo guardar o el viaje desapareció. */
  sharedNotice: string | null;
  clearSharedNotice: () => void;
  shareWithOthers: (pkg: TripPackage) => Promise<CTrip>;
  updateSharedTrip: (id: string, patch: Partial<TripPackage>, fallbackChecklist?: ChecklistItem[]) => void;
  removeSharedMember: (id: string, user: string) => Promise<void>;
  deleteSharedTrip: (id: string) => Promise<void>;
}

const apply = (pkg: TripPackage, ops: TripOp[]) => ops.reduce((p, op) => op(p), pkg);

export function useSharedTrips(me: string): SharedTripsState {
  // Última copia confirmada por el servidor, y cambios todavía sin confirmar.
  const base = useRef(new Map<string, CTrip>());
  const pending = useRef(new Map<string, TripOp[]>());
  const inflight = useRef(new Map<string, TripOp[]>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastLoad = useRef(0);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const publish = useCallback(() => setTick((n) => n + 1), []);

  const sharedTrips = useMemo(
    () =>
      [...base.current.values()].map((t) => {
        const ops = [...(inflight.current.get(t.id) ?? []), ...(pending.current.get(t.id) ?? [])];
        return ops.length ? { ...t, pkg: apply(t.pkg, ops) } : t;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  const reload = useCallback(async () => {
    lastLoad.current = Date.now();
    const r = await api.myCTrips();
    base.current = new Map(r.trips.map((t) => [t.id, t]));
    publish();
  }, [publish]);

  const flush = useCallback(
    async (id: string) => {
      timers.current.delete(id);
      // Un guardado por vez por viaje: si hay uno en camino, esperamos.
      if (inflight.current.has(id)) {
        timers.current.set(id, setTimeout(() => void flush(id), DEBOUNCE_MS));
        return;
      }
      const ops = pending.current.get(id) ?? [];
      const cur = base.current.get(id);
      if (!ops.length || !cur) return;
      pending.current.delete(id);
      inflight.current.set(id, ops);
      let r = await api.saveCTrip(id, cur.version, apply(cur.pkg, ops));
      if (r.status === 409 && r.trip) {
        base.current.set(id, r.trip);
        r = await api.saveCTrip(id, r.trip.version, apply(r.trip.pkg, ops));
      }
      inflight.current.delete(id);
      if (r.status === 200 && r.trip) {
        base.current.set(id, r.trip);
      } else if (r.status === 404) {
        base.current.delete(id);
        pending.current.delete(id);
        setNotice("Ese viaje ya no está disponible: lo borraron o te sacaron.");
      } else {
        setNotice(r.status === 0 ? "Sin conexión: no pudimos guardar el último cambio." : "No pudimos guardar el último cambio. Probá de nuevo.");
        await reload().catch(() => {});
      }
      publish();
    },
    [publish, reload],
  );

  useEffect(() => {
    reload().catch(() => {});
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        // Al salir, mandamos lo pendiente sin esperar.
        for (const [id, t] of timers.current) {
          clearTimeout(t);
          void flush(id);
        }
        return;
      }
      if (Date.now() - lastLoad.current > REFRESH_MIN_MS) reload().catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const t = timers.current;
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      for (const timer of t.values()) clearTimeout(timer);
    };
  }, [reload, flush]);

  const current = (id: string) => sharedTrips.find((t) => t.id === id);

  return {
    sharedTrips,
    sharedNotice: notice,
    clearSharedNotice: () => setNotice(null),
    shareWithOthers: async (pkg) => {
      const { trip } = await api.createCTrip(pkg);
      base.current = new Map([[trip.id, trip], ...[...base.current].filter(([id]) => id !== trip.id)]);
      publish();
      return trip;
    },
    updateSharedTrip: (id, patch, fallbackChecklist) => {
      const t = current(id);
      if (!t) return;
      pending.current.set(id, [...(pending.current.get(id) ?? []), tripOp(t.pkg, patch, fallbackChecklist)]);
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => void flush(id), DEBOUNCE_MS));
      publish();
    },
    removeSharedMember: async (id, user) => {
      const { trip } = await api.removeCTripMember(id, user);
      const prev = base.current.get(id);
      if (user === me) {
        // Me fui del viaje: deja de aparecer en Mis viajes.
        base.current.delete(id);
        pending.current.delete(id);
        clearTimeout(timers.current.get(id));
      } else if (prev) base.current.set(id, { ...prev, members: trip.members });
      publish();
    },
    deleteSharedTrip: async (id) => {
      await api.deleteCTrip(id);
      base.current.delete(id);
      pending.current.delete(id);
      clearTimeout(timers.current.get(id));
      publish();
    },
  };
}

