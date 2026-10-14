import type { RadarItem, RadarTier } from "./types.ts";

// Puntaje público del radar (0-100) y su etiqueta. Lo usan el barrido del
// servidor y el filtro por mes de la web, así que tiene que ser puro.
//
// - El descuento contra el precio habitual es lo que más pesa.
// - Ser el mínimo que vimos y venir bajando suman un poco.
// - Si "lo habitual" sale de nuestra estimación (no del historial real), el
//   puntaje no pasa de 85: no prometemos un "Ofertón" sin datos que lo respalden.
// - "Lo habitual" se compara con el mismo viaje: mismo destino, mismo mes de
//   salida y una estadía parecida (±2 noches). Si no hay suficientes datos así,
//   se usa la estimación (y queda marcada como "estimado").

/** Tope para ofertas comparadas contra un precio estimado. */
export const ESTIMATED_CAP = 85;
/** Descuento mínimo (%) para llamarlo "Ofertón". */
export const OFERTON_DISCOUNT = 30;

type ScoreInput = Pick<RadarItem, "discountPct" | "isMinimum" | "trend" | "baseline">;

export function radarScore({ discountPct, isMinimum, trend, baseline }: ScoreInput): number {
  const raw = 40 + discountPct * 1.5 + (isMinimum ? 10 : 0) + (trend === "down" ? 4 : 0);
  const capped = baseline === "estimado" ? Math.min(ESTIMATED_CAP, raw) : raw;
  return Math.max(0, Math.min(100, Math.round(capped)));
}

export function radarTier(score: number, discountPct: number): RadarTier | null {
  if (score >= 90) return discountPct >= OFERTON_DISCOUNT ? "Ofertón" : "Excelente";
  if (score >= 80) return "Muy buena";
  if (score >= 65) return "Buena";
  return null;
}

/** Agrega puntaje y etiqueta a un ítem del radar (recalculados con sus datos actuales). */
export function withRadarScore<T extends ScoreInput>(item: T): T & { radarScore: number; tier: RadarTier | null } {
  const score = radarScore(item);
  return { ...item, radarScore: score, tier: radarTier(score, item.discountPct) };
}

/** Observación previa de una ruta en un mes: [precio, noches (-1 si no se sabe), día (días desde 1970)]. */
export type BaselineObs = [p: number, n: number, day: number];
/** Observaciones comparables necesarias para hablar de "precio habitual" real. */
export const MIN_COMPARABLES = 3;
/** Diferencia de noches aceptada para comparar dos viajes. */
export const NIGHTS_WINDOW = 2;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Baseline {
  typical: number;
  baseline: RadarItem["baseline"];
  /** Cuántas observaciones comparables respaldan el precio habitual. */
  comparables: number;
  /** Precio más bajo entre las comparables (null si no alcanzan). */
  lowest: number | null;
}

/**
 * Precio habitual "del mismo viaje": mediana de lo visto antes para el mismo
 * destino y mes (`past` ya viene filtrado así) con una estadía de ±2 noches.
 * Con menos de 3 observaciones así, usa `estimate` y lo marca como estimado.
 */
export function likeForLikeBaseline(past: BaselineObs[], nights: number | null, estimate: number): Baseline {
  const comps = nights == null || nights < 0 ? [] : past.filter(([, n]) => n >= 0 && Math.abs(n - nights) <= NIGHTS_WINDOW).map(([p]) => p);
  if (comps.length >= MIN_COMPARABLES) {
    return { typical: Math.round(median(comps)), baseline: "historial", comparables: comps.length, lowest: Math.min(...comps) };
  }
  return { typical: Math.round(estimate), baseline: "estimado", comparables: comps.length, lowest: null };
}
