import type { RadarItem } from "../../shared/types.ts";

// Banner del inicio: mosaico de tres fotos con precios del radar.
// Lógica pura (sin React) para poder probarla: elige la oferta del día para la
// foto grande y dos destinos más, de regiones distintas si se puede.
// Nunca inventa precios: sin radar, las fotos van sin monto.

export interface HeroTile {
  destinationId: string;
  name: string;
  /** Ida y vuelta por persona visto por el radar (USD). Sin radar: no hay. */
  priceUSD?: number;
  depart?: string;
  ret?: string;
  /** Mes de la oferta (YYYY-MM) para abrir la ficha en ese mes. */
  month?: string;
  /** Más barato que lo habitual con historial real: lleva "Hoy conviene". */
  deal: boolean;
}

export interface HeroPickOptions {
  photos: Record<string, string>;
  regionOf: (id: string) => string | undefined;
  /** Destinos del catálogo para cuando no hay radar (en orden de preferencia). */
  fallbackIds: string[];
  nameOf: (id: string) => string | undefined;
  /** Hoy (YYYY-MM-DD): se descartan ofertas con salida pasada. */
  today?: string;
}

/** Destinos lindos de foto para el banner cuando el radar no trae datos. */
export const HERO_FALLBACK = ["florianopolis", "bariloche", "cusco", "madrid", "cartagena", "rio"];

const ratio = (i: RadarItem) => (i.typicalUSD > 0 ? i.priceUSD / i.typicalUSD : 1);

/** La oferta del día: mayor descuento real (con historial); si no hay, la más barata frente a su habitual. */
export function bestDeal(items: RadarItem[]): RadarItem | null {
  const real = items.filter((i) => i.baseline === "historial" && i.discountPct > 0);
  if (real.length) {
    return real.reduce((a, b) => (b.discountPct > a.discountPct || (b.discountPct === a.discountPct && b.priceUSD < a.priceUSD) ? b : a));
  }
  if (!items.length) return null;
  return items.reduce((a, b) => (ratio(b) < ratio(a) || (ratio(b) === ratio(a) && b.priceUSD < a.priceUSD) ? b : a));
}

/** Elige `n` de la lista en orden, priorizando regiones que todavía no están. */
function varied<T>(pool: T[], taken: Set<string>, regionOf: (t: T) => string | undefined, n: number): T[] {
  const out: T[] = [];
  const rest = [...pool];
  while (out.length < n && rest.length) {
    const idx = rest.findIndex((t) => !taken.has(regionOf(t) ?? ""));
    const [pick] = rest.splice(idx >= 0 ? idx : 0, 1);
    out.push(pick);
    taken.add(regionOf(pick) ?? "");
  }
  return out;
}

export function pickHeroTiles(items: RadarItem[] | null | undefined, opts: HeroPickOptions): HeroTile[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const usable = (items ?? []).filter(
    (i) => opts.photos[i.destinationId] && i.priceUSD > 0 && (!i.depart || i.depart >= today),
  );

  if (usable.length >= 3) {
    const big = bestDeal(usable)!;
    // El resto, de mejor a peor oferta (descuento real primero, después lo más barato frente a lo habitual).
    const rest = usable
      .filter((i) => i.destinationId !== big.destinationId)
      .sort((a, b) => b.score - a.score || ratio(a) - ratio(b) || a.priceUSD - b.priceUSD);
    const taken = new Set([opts.regionOf(big.destinationId) ?? ""]);
    const others = varied(rest, taken, (i) => opts.regionOf(i.destinationId), 2);
    return [big, ...others].map((i, k) => ({
      destinationId: i.destinationId,
      name: i.name,
      priceUSD: i.priceUSD,
      depart: i.depart,
      ret: i.ret,
      month: i.depart?.slice(0, 7),
      deal: k === 0 && i.baseline === "historial" && i.discountPct > 0,
    }));
  }

  // Sin radar (o con muy pocos destinos con foto): fotos del catálogo, sin precios.
  const ids = opts.fallbackIds.filter((id) => opts.photos[id] && opts.nameOf(id));
  const picks = varied(ids, new Set(), opts.regionOf, 3);
  if (picks.length < 3) return [];
  return picks.map((id) => ({ destinationId: id, name: opts.nameOf(id)!, deal: false }));
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "10 al 17 dic" o "28 nov al 5 dic". */
export function shortRange(depart: string, ret: string): string {
  const d = (iso: string) => Number(iso.slice(8, 10));
  const m = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
  return depart.slice(0, 7) === ret.slice(0, 7) ? `${d(depart)} al ${d(ret)} ${m(ret)}` : `${d(depart)} ${m(depart)} al ${d(ret)} ${m(ret)}`;
}

/** Link a la ficha del destino, en el mes y la fecha de la oferta si los hay. */
export function tileHref(t: HeroTile): string {
  if (!t.month) return `/destino/${t.destinationId}`;
  const q = new URLSearchParams({ month: t.month });
  if (t.depart && t.ret) {
    q.set("depart", t.depart);
    q.set("nights", String(Math.max(1, Math.round((Date.parse(t.ret) - Date.parse(t.depart)) / 86400000))));
  }
  return `/destino/${t.destinationId}?${q}`;
}
