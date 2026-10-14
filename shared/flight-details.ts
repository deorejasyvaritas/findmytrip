// Detalle de cada vuelo, como lo muestra una agencia: hora de salida, hora de
// llegada (con "+1" si llega otro día), escalas, aerolínea, duración y qué
// equipaje incluye la tarifa cuando la fuente lo dice.
//
// Límites de los datos (gratis):
// - Google Flights (SerpApi) trae hora de salida y de llegada local de cada
//   tramo y, a veces, notas de equipaje: se muestran tal cual.
// - Aviasales (Data API) trae la salida con su huso horario y la duración, no
//   la llegada. La llegada se calcula solo si el aeropuerto de destino está en
//   un huso fijo (sin horario de verano) que conocemos; si no, mostramos la
//   duración y no inventamos la hora.

import type { Bags, FlightResult, Party, Region } from "./types.ts";
import { bagsCost } from "./pricing.ts";

export interface FlightSegment {
  from: string;
  to: string;
  /** Salida, hora local: "YYYY-MM-DDTHH:MM". */
  departAt: string;
  /** Llegada, hora local, solo si la fuente la da o se puede calcular sin dudas. */
  arriveAt: string | null;
  durationMin: number | null;
  stops: number | null;
  airline: string | null;
  /** Lo que dice la fuente sobre el equipaje de esta tarifa (texto tal cual). */
  bags?: string[];
}

/** Vuelo elegido para un tramo: ida y, si es ida y vuelta, la vuelta. */
export interface FlightInfo {
  out: FlightSegment;
  back?: FlightSegment | null;
  flightNumber?: string | null;
}

// Husos horarios fijos (sin horario de verano, vigentes en 2026), por código
// IATA de ciudad o aeropuerto. Solo los que usamos para calcular la llegada.
const OFFSETS: Record<string, number> = {};
const zone = (h: number, codes: string) => codes.split(" ").forEach((c) => (OFFSETS[c] = h));
// Argentina, Uruguay, Paraguay y Brasil (salvo Amazonas y Noronha).
zone(
  -3,
  "BUE EZE AEP COR MDZ BRC ROS SLA IGR USH FTE TUC NQN MDQ REL CRD PSS JUJ SDE RES CTC RGL BHI UAQ VDM CPC LUQ RSA EQS " +
    "MVD PDP ASU " +
    "RIO GIG SDU SAO GRU CGH VCP REC MCZ SSA NAT FOR JPA AJU FLN POA CWB BHZ CNF BSB IGU BPS VIX NVT JJD IOS THE SLZ BEL CGB",
);
zone(-4, "AUA CUR SJU PUJ SDQ LRM LPB VVI CCS MAO BGI");
zone(-5, "LIM CUZ AQP BOG MDE CTG ADZ SMR CLO UIO GYE PTY CUN MBJ KIN");
zone(-6, "MEX PVR GDL SJO LIR");
zone(-7, "SJD");
zone(7, "BKK HKT");
zone(9, "TYO NRT HND");

export const fixedOffset = (code: string): number | null => OFFSETS[code] ?? null;

const pad = (n: number) => String(n).padStart(2, "0");

/** Hora local "YYYY-MM-DDTHH:MM" (sin segundos ni huso) de lo que venga. */
export const localStamp = (iso: string): string => iso.replace(" ", "T").slice(0, 16);

/**
 * Llegada en hora local del destino a partir de la salida (con su huso, como
 * la da Aviasales: "2026-07-18T03:00:00-03:00") y la duración. Null si falta
 * el huso de la salida o el destino no tiene un huso fijo conocido.
 */
export function arrivalFromDuration(departAt: string | null | undefined, durationMin: number | null | undefined, to: string): string | null {
  if (!departAt || !durationMin || durationMin <= 0) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(departAt)) return null;
  const off = fixedOffset(to);
  if (off == null) return null;
  const t = Date.parse(departAt);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + durationMin * 60000 + off * 3600000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`.trim();

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86400000);

/** Hora de llegada, "+1" si llega otro día y la frase "Llegás un día después, el 12 feb a las 01:50". */
export function arrivalInfo(departAt: string, arriveAt: string | null): { time: string; plus: number; note: string | null } | null {
  if (!arriveAt) return null;
  const plus = dayDiff(departAt, arriveAt);
  const time = arriveAt.slice(11, 16);
  if (!(plus > 0)) return { time, plus: 0, note: null };
  const when = plus === 1 ? "un día después" : plus === 2 ? "dos días después" : `${plus} días después`;
  return { time, plus, note: `Llegás ${when}, el ${dayMonth(arriveAt)} a las ${time}` };
}

/** "13 h 25 min" */
export const durationText = (min: number | null | undefined): string | null =>
  min ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : null;

export const stopsText = (n: number | null | undefined): string =>
  n == null ? "Escalas sin dato" : n === 0 ? "Directo" : n === 1 ? "1 escala" : `${n} escalas`;

/** Ida (y vuelta) de un resultado de Aviasales, con la llegada solo si se puede calcular. */
export function infoFromResult(r: FlightResult): FlightInfo {
  const out: FlightSegment = {
    from: r.origin,
    to: r.destination,
    departAt: localStamp(r.departAt),
    arriveAt: arrivalFromDuration(r.departAt, r.durationOut, r.destination),
    durationMin: r.durationOut,
    stops: r.stops,
    airline: r.airline,
  };
  const back: FlightSegment | null = r.returnAt
    ? {
        from: r.destination,
        to: r.origin,
        departAt: localStamp(r.returnAt),
        arriveAt: arrivalFromDuration(r.returnAt, r.durationBack, r.origin),
        durationMin: r.durationBack,
        stops: r.returnStops,
        airline: r.airline,
      }
    : null;
  return { out, back, flightNumber: r.flightNumber };
}

/** Notas de equipaje que trae Google ("Equipaje de mano incluido", "Valija con cargo"...). */
export function bagNotes(texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t || !/equipaje|valija|maleta|mano|bag|carry/i.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 2);
}

// Región para estimar el equipaje (shared/pricing.ts) según el país del destino.
const REGION_BY_COUNTRY: Record<string, Region> = {
  argentina: "Argentina",
  brasil: "Sudamérica",
  brazil: "Sudamérica",
  uruguay: "Sudamérica",
  chile: "Sudamérica",
  paraguay: "Sudamérica",
  bolivia: "Sudamérica",
  peru: "Sudamérica",
  colombia: "Sudamérica",
  ecuador: "Sudamérica",
  venezuela: "Sudamérica",
  mexico: "Caribe y Centroamérica",
  cuba: "Caribe y Centroamérica",
  aruba: "Caribe y Centroamérica",
  curazao: "Caribe y Centroamérica",
  panama: "Caribe y Centroamérica",
  "costa rica": "Caribe y Centroamérica",
  "republica dominicana": "Caribe y Centroamérica",
  jamaica: "Caribe y Centroamérica",
  "puerto rico": "Caribe y Centroamérica",
  "estados unidos": "Norteamérica",
  canada: "Norteamérica",
  japon: "Asia",
  china: "Asia",
  tailandia: "Asia",
  vietnam: "Asia",
  indonesia: "Asia",
  india: "Asia",
  marruecos: "África y Medio Oriente",
  egipto: "África y Medio Oriente",
  "emiratos arabes unidos": "África y Medio Oriente",
  turquia: "Europa",
  espana: "Europa",
  italia: "Europa",
  francia: "Europa",
  portugal: "Europa",
  alemania: "Europa",
  grecia: "Europa",
  croacia: "Europa",
  "reino unido": "Europa",
  "paises bajos": "Europa",
  suiza: "Europa",
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Región del país (para el equipaje); si no la conocemos, la de Sudamérica (valor intermedio). */
export function regionForCountry(country: string): Region {
  return REGION_BY_COUNTRY[norm(country)] ?? "Sudamérica";
}

/**
 * Equipaje elegido para el grupo en los vuelos del viaje (estimado): cada
 * tramo solo ida cuenta una vez, uno de ida y vuelta, dos.
 */
export function tripBagsCost(party: Party, legs: { country: string; roundTrip: boolean }[]): number {
  return legs.reduce((sum, l) => sum + (bagsCost(party, regionForCountry(l.country)) / 2) * (l.roundTrip ? 2 : 1), 0);
}

export const BAGS_SHORT: Record<Bags, string> = {
  personal: "solo mochila",
  cabin: "carry-on",
  checked1: "1 valija",
  checked2: "2 valijas",
};
