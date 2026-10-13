// Feriados nacionales de Argentina (Ley 27.399) y fines de semana largos.
// Los "días no laborables con fines turísticos" (puentes) se fijan por decreto
// cada año: se cargan a mano en PUENTES.

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

/** Trasladables: martes o miércoles pasan al lunes anterior; jueves o viernes, al lunes siguiente. */
function movable(date: string): string {
  const w = dow(date);
  if (w === 2) return shift(date, -1);
  if (w === 3) return shift(date, -2);
  if (w === 4) return shift(date, 4);
  if (w === 5) return shift(date, 3);
  return date;
}

/** Puentes turísticos por decreto (agregar cuando se publiquen). */
export const PUENTES: Record<string, string> = {};

export function holidays(y: number): Record<string, string> {
  const e = easter(y);
  const out: Record<string, string> = {
    [iso(y, 1, 1)]: "Año Nuevo",
    [shift(e, -48)]: "Carnaval",
    [shift(e, -47)]: "Carnaval",
    [iso(y, 3, 24)]: "Día de la Memoria",
    [iso(y, 4, 2)]: "Malvinas",
    [shift(e, -2)]: "Viernes Santo",
    [iso(y, 5, 1)]: "Día del Trabajador",
    [iso(y, 5, 25)]: "Revolución de Mayo",
    [movable(iso(y, 6, 17))]: "Paso a la Inmortalidad de Güemes",
    [iso(y, 6, 20)]: "Día de la Bandera",
    [iso(y, 7, 9)]: "Día de la Independencia",
    [movable(iso(y, 8, 17))]: "Paso a la Inmortalidad de San Martín",
    [movable(iso(y, 10, 12))]: "Día del Respeto a la Diversidad Cultural",
    [movable(iso(y, 11, 20))]: "Día de la Soberanía Nacional",
    [iso(y, 12, 8)]: "Inmaculada Concepción",
    [iso(y, 12, 25)]: "Navidad",
  };
  for (const [d, name] of Object.entries(PUENTES)) if (d.startsWith(String(y))) out[d] = name;
  return out;
}

export interface LongWeekend {
  from: string; // primer día libre
  to: string; // último día libre
  days: number;
  reason: string;
}

/** Próximos fines de semana largos (3 días o más sin trabajar) desde `today`. */
export function longWeekends(today: string, count = 4, horizonDays = 240): LongWeekend[] {
  const y = Number(today.slice(0, 4));
  const hol = { ...holidays(y), ...holidays(y + 1) };
  const off = (d: string) => dow(d) === 0 || dow(d) === 6 || d in hol;
  const out: LongWeekend[] = [];
  let d = shift(today, 1);
  const end = shift(today, horizonDays);
  while (d <= end && out.length < count) {
    if (!off(d)) {
      d = shift(d, 1);
      continue;
    }
    let to = d;
    const reasons = new Set<string>();
    while (off(to)) {
      if (hol[to]) reasons.add(hol[to]);
      to = shift(to, 1);
    }
    to = shift(to, -1);
    const days = Math.round((Date.parse(to) - Date.parse(d)) / 86400000) + 1;
    if (days >= 3 && reasons.size) out.push({ from: d, to, days, reason: [...reasons].join(" y ") });
    d = shift(to, 1);
  }
  return out;
}
