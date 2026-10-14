// Traslado aeropuerto–hotel de cada parada que llega o sale en avión.
// No hay una API gratis con precios de traslados: es un estimado (auto
// privado, por vehículo de hasta 3 personas) con la misma tabla de niveles de
// precio de shared/ground.ts, siempre marcado "Estimado" y con link para ver
// el precio exacto. Se puede quitar del total.

import type { Party, TripLeg, TripPlan } from "./types.ts";
import { TRANSFER, fareFor, round5 } from "./ground.ts";
import { addDaysIso } from "./trip-window.ts";

export interface AirportTransfer {
  /** Aeropuerto (IATA de ciudad) y distancia aproximada a la parada. */
  airport: string;
  km: number;
  /** ida = aeropuerto al hotel (llegada), vuelta = hotel al aeropuerto (salida). */
  ways: ("ida" | "vuelta")[];
  /** Precio estimado por trayecto y por vehículo, en USD. */
  perWayUSD: number;
  /** Ver el precio exacto (Welcome Pickups, link de afiliado si hay). */
  link: string | null;
}

/** Personas que caben en un auto con valijas. */
export const SEATS_PER_CAR = 3;

/** Por tierra se recorre más que en línea recta. */
const ROAD_FACTOR = 1.3;

export function transferPerWay(country: string, straightKm: number): number {
  const t = TRANSFER[fareFor(country).level];
  return round5(Math.max(t.min, Math.round(straightKm * ROAD_FACTOR) * t.perKm));
}

/** Autos que necesita el grupo (los bebés van a upa). */
export const transferCars = (p: Party) => Math.max(1, Math.ceil((p.adults + p.childAges.filter((a) => a >= 2).length) / SEATS_PER_CAR));

/** Total del traslado de una parada para el grupo (todos los trayectos). */
export const transferCost = (t: AirportTransfer, p: Party) => t.perWayUSD * t.ways.length * transferCars(p);

/**
 * Traslados del viaje: una parada tiene "ida" si se llega en avión y "vuelta"
 * si se va en avión (un ida y vuelta al mismo aeropuerto cuenta las dos para
 * la primera y la última parada).
 */
export function planTransfers(
  plan: Pick<TripPlan, "stops" | "legs">,
  link: (airport: string) => string | null = () => null,
): (AirportTransfer | null)[] {
  const n = plan.stops.length;
  const flight = (l: TripLeg | undefined) => l?.kind === "flight";
  const out = plan.legs.find((l) => l.role === "out");
  const back = plan.legs.find((l) => l.role === "back");
  const roundTrip = Boolean(out?.returnDate);
  return plan.stops.map((st, i) => {
    if (!st.airport) return null;
    const before = i === 0 ? out : plan.legs.find((l) => l.role === "between" && l.after === i - 1);
    const after = i === n - 1 ? (roundTrip ? out : back) : plan.legs.find((l) => l.role === "between" && l.after === i);
    const ways: AirportTransfer["ways"] = [];
    if (flight(before)) ways.push("ida");
    if (flight(after)) ways.push("vuelta");
    if (!ways.length) return null;
    return { airport: st.airport.city, km: st.airport.km, ways, perWayUSD: transferPerWay(st.country, st.airport.km), link: link(st.airport.city) };
  });
}

/** Horas antes del vuelo para salir del hotel: 3 h internacional, 2 h de cabotaje. */
export const PICKUP_HOURS = { international: 3, domestic: 2 } as const;

/** "YYYY-MM-DDTHH:MM" menos `hours` horas. */
export function minusHours(local: string, hours: number): string {
  const [date, time] = local.split("T");
  let [h, m] = (time ?? "00:00").split(":").map(Number);
  let d = date;
  h -= hours;
  while (h < 0) {
    h += 24;
    d = addDaysIso(d, -1);
  }
  return `${d}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
}

/** Horario de cada trayecto: ida = llegada del vuelo; vuelta = salida del vuelo menos el margen. */
export function transferTimes(arriveAt: string | null, departAt: string | null, international: boolean): { ida: string | null; vuelta: string | null } {
  return {
    ida: arriveAt,
    vuelta: departAt && departAt.length >= 16 ? minusHours(departAt, international ? PICKUP_HOURS.international : PICKUP_HOURS.domestic) : null,
  };
}

/** Partes del total del viaje y qué se suma (los estimados opcionales se pueden quitar). */
export interface TripTotals {
  flights: number;
  stays: number;
  ground: number;
  transfers: number;
  bags: number;
}

export function tripTotal(t: TripTotals, on: { ground: boolean; transfers: boolean; bags: boolean }): number {
  return t.flights + t.stays + (on.ground ? t.ground : 0) + (on.transfers ? t.transfers : 0) + (on.bags ? t.bags : 0);
}

/** Suma de los traslados del viaje para el grupo (sin las paradas que el usuario quitó). */
export function transfersTotal(list: (AirportTransfer | null | undefined)[], party: Party, removed: Record<number, boolean> = {}): number {
  return list.reduce((s, t, i) => s + (t && !removed[i] ? transferCost(t, party) : 0), 0);
}
