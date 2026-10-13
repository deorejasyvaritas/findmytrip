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
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-AR", opts);
}

export const STYLE_LABEL = { low: "Económico", mid: "Confort", high: "Premium" } as const;

/** "7 jun – 14 jun" */
export const formatRange = (a: string, b: string) => `${formatDate(a)} – ${formatDate(b)}`;
