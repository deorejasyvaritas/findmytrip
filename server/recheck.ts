import type { Destination } from "../shared/types.ts";
import type { RecheckItem, RecheckResult } from "../shared/recheck.ts";
import { MAX_RECHECK_FLIGHTS, MAX_RECHECK_HOTELS } from "../shared/recheck.ts";
import { googleFlights, monthDays } from "./providers/flights.ts";
import { hotelRate } from "./providers/xotelo.ts";
import { canUseGoogle } from "./google-budget.ts";
import { nearestDay, refreshLeg } from "./trip.ts";

// "Revisar precios" de un viaje guardado. Por ítem, a lo sumo:
// - Vuelo: Aviasales para el día exacto (caché de borde de 2 min, sin KV); si no
//   hay, Google Flights solo si el usuario lo pidió y queda cuota; si no, el día
//   más cercano del mes (Aviasales, caché de 6 h).
// - Hotel: la tarifa de ese hotel en Xotelo (caché de borde de 1 h, sin KV).
// Con 5 vuelos y 3 hoteles quedan menos de 20 subpedidos.

export interface RecheckKeys {
  token?: string;
  marker?: string;
  serpKey?: string;
}

const gap = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));

export async function recheckItems(keys: RecheckKeys, items: RecheckItem[], useGoogle: boolean): Promise<RecheckResult[]> {
  const flights = items.filter((x) => x.type === "flight").slice(0, MAX_RECHECK_FLIGHTS);
  const hotels = items.filter((x) => x.type === "hotel").slice(0, MAX_RECHECK_HOTELS);
  const google = useGoogle && keys.serpKey && (await canUseGoogle(keys.serpKey)) ? keys.serpKey : undefined;
  return Promise.all([...flights, ...hotels].map((x) => (x.type === "flight" ? flight(keys, x, google) : hotel(x))));
}

async function flight(keys: RecheckKeys, x: Extract<RecheckItem, { type: "flight" }>, google: string | undefined): Promise<RecheckResult> {
  const now = new Date().toISOString();
  const none: RecheckResult = { i: x.i, unitUSD: null, kind: null, source: null, at: now };
  const exact = await refreshLeg(keys.token, keys.marker, x.from, x.to, x.depart, x.ret).catch(() => null);
  if (exact?.price != null) return { i: x.i, unitUSD: exact.price, kind: "exacto", source: "aviasales", link: exact.link, at: now };

  if (google) {
    const q = await googleFlights(google, x.from, { iata: x.to } as Destination, x.depart, x.ret).catch(() => null);
    if (q?.lowestUSD) return { i: x.i, unitUSD: q.lowestUSD, kind: "exacto", source: "google", link: q.url, at: q.fetchedAt ?? now };
  }

  if (!keys.token) return none;
  const nights = x.ret ? gap(x.ret, x.depart) : null;
  const days = await monthDays(keys.token, x.from, x.to, x.depart.slice(0, 7), nights).catch(() => []);
  const day = nearestDay(days, x.depart);
  if (!day || gap(day[0], x.depart) > 7) return none;
  return day[0] === x.depart
    ? { i: x.i, unitUSD: day[1], kind: "exacto", source: "aviasales", at: now }
    : { i: x.i, unitUSD: day[1], kind: "cercano", source: "aviasales", priceDate: day[0], at: now };
}

async function hotel(x: Extract<RecheckItem, { type: "hotel" }>): Promise<RecheckResult> {
  const at = new Date().toISOString();
  const r = await hotelRate(x.key, x.checkin, x.checkout).catch(() => null);
  return r ? { i: x.i, unitUSD: r.nightly, kind: "exacto", source: "xotelo", at } : { i: x.i, unitUSD: null, kind: null, source: null, at };
}
