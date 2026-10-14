// Qué es cada precio y qué tan viejo es, en pocas palabras. Nunca decimos
// "en vivo": todo lo que mostramos sale de una consulta (con caché) y el
// precio final es el del sitio donde se paga.

import type { PriceKind, QuoteSource } from "./types.ts";

export interface PriceStamp {
  kind?: PriceKind | null;
  source?: QuoteSource | null;
  /** Cuándo se vio el precio (ISO). */
  at?: string | null;
  /** Día de salida del precio cuando no es el pedido. */
  priceDate?: string | null;
}

/** Pasado este tiempo avisamos antes de comprar que conviene revisar el precio. */
export const FRESH_HOURS = 6;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`.trim();

/** Fecha en Argentina (UTC-3, sin horario de verano). */
const arDay = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

/** "recién", "hace 5 min", "hace 3 h", "hace 2 días". */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** Horas desde que se vio el precio (Infinity si no se sabe). */
export function ageHours(at: string | null | undefined, now = Date.now()): number {
  const t = at ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? Infinity : Math.max(0, (now - t) / 3600_000);
}

/** Etiqueta corta del precio: "Precio de hoy", "Visto hace 3 h", "Precio de otro día (12 dic)"... */
export function priceLabel(s: PriceStamp, now = Date.now()): string {
  switch (s.kind) {
    case "manual":
      return "Precio que cargaste";
    case "estimado":
      return "Estimado";
    case "mes":
      return s.priceDate ? `Mínimo del mes (${dayMonth(s.priceDate)})` : "Referencia del mes";
    case "cercano":
      return s.priceDate ? `Precio de otro día (${dayMonth(s.priceDate)})` : "Precio de otro día";
  }
  if (s.source === "estimado") return "Estimado";
  const h = ageHours(s.at, now);
  if (s.source === "aviasales") {
    // La Data API de Aviasales trae lo que vio la gente en los últimos días.
    return h <= FRESH_HOURS ? "Visto en los últimos días" : `Visto ${ago(s.at!, now)}`;
  }
  if (!Number.isFinite(h)) return s.source === "google" ? "Precio de Google Flights" : "Precio visto";
  if (h < 12 && arDay(Date.parse(s.at!)) === arDay(now)) return "Precio de hoy";
  return `Visto ${ago(s.at!, now)}`;
}

/** Antes de comprar: hay que avisar si el precio no es del día pedido o ya tiene unas horas. */
export function needsCheck(s: PriceStamp, now = Date.now()): boolean {
  if (s.kind === "manual") return false;
  if (s.kind && s.kind !== "exacto") return true;
  if (s.source === "estimado") return true;
  return ageHours(s.at, now) > FRESH_HOURS;
}

/** Aviso de una línea antes de comprar (null si el precio es exacto y reciente). */
export function staleNote(s: PriceStamp, now = Date.now()): string | null {
  if (!needsCheck(s, now)) return null;
  const tail = "puede cambiar al reservar.";
  if (s.kind === "estimado" || s.source === "estimado") return `Es un precio estimado; ${tail}`;
  if (s.kind === "mes") return `Es el mínimo del mes, no de tu fecha; ${tail}`;
  if (s.kind === "cercano") return `Este precio es de otro día${s.priceDate ? ` (${dayMonth(s.priceDate)})` : ""}; ${tail}`;
  const when = s.at ? ago(s.at, now) : "";
  return when ? `Este precio es de ${when}; ${tail}` : `No sabemos cuándo se vio este precio; ${tail}`;
}
