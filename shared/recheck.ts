// "Revisar precios" de un viaje guardado: qué se vuelve a consultar, cómo se
// compara con lo guardado y cómo se actualizan los montos.

import type { ItemQuote, PackageItem, PriceKind, QuoteSource, TripPackage } from "./types.ts";
import { parseAviasalesUrl } from "./links.ts";

export type RecheckItem =
  | { i: number; type: "flight"; from: string; to: string; depart: string; ret: string | null }
  | { i: number; type: "hotel"; key: string; checkin: string; checkout: string };

export interface RecheckResult {
  i: number;
  /** Precio unitario de ahora (null si no hay precio). */
  unitUSD: number | null;
  kind: PriceKind | null;
  source: QuoteSource | null;
  priceDate?: string | null;
  link?: string | null;
  at: string;
}

export interface RecheckResponse {
  checkedAt: string;
  results: RecheckResult[];
}

/** Límite de ítems por revisión (subpedidos del plan gratis de Workers). */
export const MAX_RECHECK_FLIGHTS = 5;
export const MAX_RECHECK_HOTELS = 3;

/**
 * Datos del precio de un vuelo guardado antes de que existiera `quote`: la
 * ruta y las fechas salen del link de Aviasales y el precio por adulto, de la
 * etiqueta ("USD 420 por adulto").
 */
export function legacyFlightQuote(item: PackageItem, pkg: Pick<TripPackage, "departDate" | "createdAt">): ItemQuote | null {
  if (item.kind !== "vuelo") return null;
  const year = Number(pkg.departDate.slice(0, 4));
  const route = year ? parseAviasalesUrl(item.link, year) : null;
  const unit = /USD\s?([\d.]+) por adulto/.exec(item.label);
  const unitUSD = unit ? Number(unit[1].replace(/\./g, "")) : NaN;
  if (!route || !(unitUSD > 0) || !(item.amountUSD > 0)) return null;
  return {
    kind: "exacto",
    source: "aviasales",
    at: pkg.createdAt,
    unitUSD,
    units: item.amountUSD / unitUSD,
    flight: route,
  };
}

/** Precio guardado de un ítem (el nuevo `quote` o lo que se puede deducir de uno viejo). */
export const itemQuote = (item: PackageItem, pkg: Pick<TripPackage, "departDate" | "createdAt">): ItemQuote | null =>
  item.quote ?? legacyFlightQuote(item, pkg);

/** Qué ítems del viaje se pueden volver a consultar. */
export function recheckRequest(pkg: TripPackage): RecheckItem[] {
  const out: RecheckItem[] = [];
  let flights = 0;
  let hotels = 0;
  pkg.items.forEach((item, i) => {
    const q = itemQuote(item, pkg);
    if (!q || q.kind === "manual") return;
    if (q.flight && flights < MAX_RECHECK_FLIGHTS) {
      flights++;
      out.push({ i, type: "flight", ...q.flight });
    } else if (q.hotel && hotels < MAX_RECHECK_HOTELS) {
      hotels++;
      out.push({ i, type: "hotel", ...q.hotel });
    }
  });
  return out;
}

export type DiffStatus = "igual" | "subio" | "bajo" | "otro-dia" | "sin-precio";

export interface ItemDiff {
  i: number;
  status: DiffStatus;
  /** Monto del ítem con el precio de ahora (todo el grupo). */
  newAmountUSD: number | null;
  /** Diferencia contra lo guardado (positivo = subió). */
  deltaUSD: number;
  /** Solo un precio exacto para las mismas fechas reemplaza lo guardado. */
  canUpdate: boolean;
  result: RecheckResult;
}

/** Cambios menores a esto (o al 1 %) cuentan como "sigue igual". */
const SAME_USD = 3;

export function diffItem(item: PackageItem, quote: ItemQuote, r: RecheckResult): ItemDiff {
  if (r.unitUSD == null || r.unitUSD <= 0) {
    return { i: r.i, status: "sin-precio", newAmountUSD: null, deltaUSD: 0, canUpdate: false, result: r };
  }
  const newAmountUSD = Math.round(r.unitUSD * quote.units);
  const deltaUSD = newAmountUSD - item.amountUSD;
  if (r.kind !== "exacto") return { i: r.i, status: "otro-dia", newAmountUSD, deltaUSD, canUpdate: false, result: r };
  const same = Math.abs(deltaUSD) < Math.max(SAME_USD, item.amountUSD * 0.01);
  return {
    i: r.i,
    status: same ? "igual" : deltaUSD > 0 ? "subio" : "bajo",
    newAmountUSD,
    deltaUSD: same ? 0 : deltaUSD,
    canUpdate: !same,
    result: r,
  };
}

export function diffPackage(pkg: TripPackage, res: RecheckResponse): ItemDiff[] {
  const out: ItemDiff[] = [];
  for (const r of res.results) {
    const item = pkg.items[r.i];
    const q = item && itemQuote(item, pkg);
    if (q) out.push(diffItem(item, q, r));
  }
  return out;
}

const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/** "Sigue a USD 820", "Subió USD 40", "Bajó USD 25"... (`money` formatea en la moneda del usuario). */
export function diffLabel(d: ItemDiff, money: (usd: number) => string): string {
  switch (d.status) {
    case "igual":
      return `Sigue a ${money(d.newAmountUSD!)}`;
    case "subio":
      return `Subió ${money(d.deltaUSD)} (ahora ${money(d.newAmountUSD!)})`;
    case "bajo":
      return `Bajó ${money(-d.deltaUSD)} (ahora ${money(d.newAmountUSD!)})`;
    case "otro-dia":
      return `Sin precio para tu fecha; ${d.result.priceDate ? `el ${dm(d.result.priceDate)}` : "otro día"} sale ${money(d.newAmountUSD!)}`;
    default:
      return "Sin precio para tu fecha ahora; revisalo en el link";
  }
}

/** Viaje con los montos de ahora (solo los ítems con precio exacto que cambió). */
export function applyRecheck(pkg: TripPackage, diffs: ItemDiff[]): TripPackage {
  const byIndex = new Map(diffs.map((d) => [d.i, d]));
  let total = pkg.totalUSD;
  const items = pkg.items.map((item, i) => {
    const d = byIndex.get(i);
    const q = itemQuote(item, pkg);
    if (!d || !q || d.result.unitUSD == null || d.result.kind !== "exacto") return item;
    const quote: ItemQuote = { ...q, unitUSD: d.result.unitUSD, at: d.result.at, kind: "exacto", source: d.result.source ?? q.source, priceDate: null };
    if (!d.canUpdate) return { ...item, quote };
    total += d.newAmountUSD! - item.amountUSD;
    // El link guardado ya abre la búsqueda para todo el grupo: se mantiene.
    const label = item.label.replace(/USD\s?[\d.]+ por adulto/, `USD ${d.result.unitUSD} por adulto`);
    return { ...item, label, amountUSD: d.newAmountUSD!, quote };
  });
  return { ...pkg, items, totalUSD: Math.round(total) };
}
