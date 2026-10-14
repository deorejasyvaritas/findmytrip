// "Fechas flexibles" en "Ya sé a dónde": en vez de un día exacto, una ventana
// (por ejemplo, la segunda quincena de julio). El servidor elige el día de
// salida más barato con los precios por día que ya tenemos en caché.

export interface DateWindow {
  from: string;
  to: string;
}

/** Un día de la ventana con el precio visto (por adulto) del vuelo o los vuelos que dependen de la fecha. */
export interface WindowDay {
  date: string;
  price: number;
}

export interface TripWindow extends DateWindow {
  /** Días con precio real visto, ordenados por fecha. */
  days: WindowDay[];
  /** Día de salida usado para armar el viaje. */
  chosen: string;
  /** El usuario eligió ese día (si no, es el más barato). */
  pinned: boolean;
  /** Qué suma el precio de cada día. */
  basis: "ida y vuelta" | "ida + vuelta" | "solo ida";
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Ventana válida: fechas ISO, en orden y de hasta 31 días. */
export function validWindow(w: Partial<DateWindow> | null | undefined): w is DateWindow {
  if (!w?.from || !w.to || !ISO.test(w.from) || !ISO.test(w.to)) return false;
  const n = daysBetween(w.from, w.to);
  return n >= 0 && n < MAX_DAYS;
}

/** Parámetro de URL: "2026-07-16_2026-07-31". */
export const windowToParam = (w: DateWindow) => `${w.from}_${w.to}`;

export function windowFromParam(raw: string | null | undefined): DateWindow | null {
  if (!raw) return null;
  const [from, to] = raw.split("_");
  const w = { from, to };
  return validWindow(w) ? w : null;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Atajos: primera quincena, segunda quincena y todo el mes. */
export function quickWindows(year: number, month: number): { label: string; window: DateWindow }[] {
  const name = MONTHS[month - 1];
  const end = lastDay(year, month);
  return [
    { label: `Primera quincena de ${name}`, window: { from: iso(year, month, 1), to: iso(year, month, 15) } },
    { label: `Segunda quincena de ${name}`, window: { from: iso(year, month, 16), to: iso(year, month, end) } },
    { label: `Todo ${name}`, window: { from: iso(year, month, 1), to: iso(year, month, end) } },
  ];
}

/** "segunda quincena de julio (16 al 31 jul)" o "del 3 al 20 ago". */
export function describeWindow(w: DateWindow): string {
  const y = Number(w.from.slice(0, 4));
  const m = Number(w.from.slice(5, 7));
  const quick = w.from.slice(0, 7) === w.to.slice(0, 7) ? quickWindows(y, m).find((q) => q.window.from === w.from && q.window.to === w.to) : null;
  const d = (s: string) => `${Number(s.slice(8, 10))} ${SHORT[Number(s.slice(5, 7)) - 1]}`;
  const range = `${Number(w.from.slice(8, 10))}${w.from.slice(0, 7) === w.to.slice(0, 7) ? "" : ` ${SHORT[m - 1]}`} al ${d(w.to)}`;
  return quick ? `${quick.label.toLowerCase()} (${range})` : `del ${range}`;
}

/** Meses (YYYY-MM) que toca la ventana. */
export function windowMonths(w: DateWindow, shiftDays = 0): string[] {
  const a = addDaysIso(w.from, shiftDays).slice(0, 7);
  const b = addDaysIso(w.to, shiftDays).slice(0, 7);
  return a === b ? [a] : [a, b];
}

/**
 * Día más barato de la ventana. `out` es el precio por día de salida del primer
 * vuelo; `back` (opcional), el del vuelo de vuelta por día, que sale `nights`
 * días después. Con vuelta, solo cuentan los días que tienen las dos puntas;
 * si ninguno las tiene, se usa solo la ida. Empates: el día más temprano.
 */
export function pickWindowDay(
  w: DateWindow,
  out: [string, number][],
  back: [string, number][] | null = null,
  nights = 0,
): { chosen: string | null; days: WindowDay[]; combined: boolean } {
  const inWindow = (d: string) => d >= w.from && d <= w.to;
  const outDays = out.filter(([d]) => inWindow(d));
  let days: WindowDay[] = [];
  let combined = false;
  if (back?.length) {
    const backBy = new Map(back);
    days = outDays.flatMap(([d, p]) => {
      const b = backBy.get(addDaysIso(d, nights));
      return b != null ? [{ date: d, price: p + b }] : [];
    });
    combined = days.length > 0;
  }
  if (!days.length) days = outDays.map(([date, price]) => ({ date, price }));
  days.sort((a, b) => a.date.localeCompare(b.date));
  const best = days.reduce<WindowDay | null>((acc, d) => (!acc || d.price < acc.price ? d : acc), null);
  return { chosen: best?.date ?? null, days, combined };
}

/** Fechas de "Ya sé a dónde" en la URL: depart y, con ventana, `win` (y `dia` si el usuario eligió el día). */
export interface TripDates {
  depart: string;
  window: DateWindow | null;
  /** Día elegido por el usuario dentro de la ventana. */
  pinned: string | null;
}

export function tripDatesToParams(d: TripDates): Record<string, string> {
  if (!d.window) return { depart: d.depart };
  const out: Record<string, string> = { depart: d.window.from, win: windowToParam(d.window) };
  if (d.pinned && d.pinned >= d.window.from && d.pinned <= d.window.to) out.dia = d.pinned;
  return out;
}

export function tripDatesFromParams(params: URLSearchParams): TripDates {
  const window = windowFromParam(params.get("win"));
  const depart = params.get("depart") ?? "";
  const dia = params.get("dia");
  const pinned = window && dia && ISO.test(dia) && dia >= window.from && dia <= window.to ? dia : null;
  return { depart: window ? window.from : depart, window, pinned };
}
