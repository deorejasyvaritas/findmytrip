const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const monthName = (m: number) => MONTHS[m - 1];
export const monthShort = (m: number) => SHORT[m - 1];
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatMoney(usd: number, currency: "USD" | "ARS", rate: number): string {
  if (currency === "ARS") {
    return `$ ${Math.round(usd * rate).toLocaleString("es-AR")}`;
  }
  return `USD ${Math.round(usd).toLocaleString("es-AR")}`;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  // Acepta fechas con hora ("2026-12-10T23:55:00-03:00") y no rompe con datos vacíos.
  const d = new Date(`${String(iso ?? "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-AR", opts);
}

export const STYLE_LABEL = { low: "Económico", mid: "Confort", high: "Premium" } as const;

/** "7 jun – 14 jun" */
export const formatRange = (a: string, b: string) => `${formatDate(a)} – ${formatDate(b)}`;

/** "hace 5 min", "hace 2 h", "hace 3 días". */
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
