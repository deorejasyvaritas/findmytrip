import type { RadarItem, RadarTier } from "./types.ts";

// Puntaje público del radar (0-100) y su etiqueta. Lo usan el barrido del
// servidor y el filtro por mes de la web, así que tiene que ser puro.
//
// - El descuento contra el precio habitual es lo que más pesa.
// - Ser el mínimo que vimos y venir bajando suman un poco.
// - Si "lo habitual" sale de nuestra estimación (no del historial real), el
//   puntaje no pasa de 85: no prometemos un "Ofertón" sin datos que lo respalden.

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
