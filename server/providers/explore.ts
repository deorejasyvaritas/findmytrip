import type { Destination, ExtraDestination, RealPrice } from "../../shared/types.ts";
import { cached } from "../cache.ts";
import { googleSearch } from "../google-budget.ts";
import { DESTINATIONS } from "../data/destinations.ts";
import { addDays } from "../engine.ts";
import { offersFor } from "../escapes.ts";
import { radarMonthFares } from "../radar.ts";
import { airportsFor, cheapestAnywhereMonths } from "./flights.ts";

// Precios reales para la búsqueda inicial ("¿a dónde me alcanza?").
// 1) Google Travel Explore (SerpApi): una sola búsqueda trae vuelo + hotel
//    reales de decenas de destinos con fechas concretas.
// 2) Travelpayouts: precios de vuelos vistos en los últimos días, para los
//    destinos que Google no devolvió.

// Aeropuertos de cada destino del catálogo (para cruzar con lo que devuelve Google).
const EXTRA_AIRPORTS: Record<string, string[]> = {
  rio: ["GIG", "SDU"],
  "puerto-madryn": ["PMY", "REL"],
  "punta-del-este": ["PDP", "MVD"],
  salta: ["SLA", "JUJ"],
  iguazu: ["IGR", "IGU"],
  galapagos: ["GPS", "SCY"],
  "costa-rica": ["SJO", "LIR"],
  cdmx: ["MEX", "NLU"],
  miami: ["MIA", "FLL"],
  "nueva-york": ["JFK", "EWR", "LGA"],
  roma: ["FCO", "CIA"],
  lisboa: ["LIS", "OPO"],
  paris: ["CDG", "ORY"],
  croacia: ["DBV", "SPU", "ZAG"],
  tailandia: ["BKK", "DMK", "HKT"],
  japon: ["HND", "NRT", "KIX"],
  marruecos: ["RAK", "CMN"],
  cancun: ["CUN", "TQO"],
};

const BY_AIRPORT = new Map<string, Destination>();
for (const d of DESTINATIONS) {
  for (const code of [d.iata, ...airportsFor(d.iata).split(","), ...(EXTRA_AIRPORTS[d.id] ?? [])]) {
    if (!BY_AIRPORT.has(code)) BY_AIRPORT.set(code, d);
  }
}

interface GoogleExploreDestination {
  name?: string;
  country?: string;
  destination_airport?: { code?: string };
  start_date?: string;
  end_date?: string;
  flight_price?: number | string;
  hotel_price?: number | string;
  airline?: string;
  link?: string;
  flight_duration?: number;
  number_of_stops?: number;
  thumbnail?: string;
}
interface GoogleExploreResponse {
  destinations?: GoogleExploreDestination[];
  error?: string;
}

const num = (v: number | string | undefined): number | undefined => {
  if (typeof v === "number") return v > 0 ? Math.round(v) : undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return n > 0 ? Math.round(n) : undefined;
  }
  return undefined;
};

async function googleExploreRaw(apiKey: string, origin: string, month: number | null): Promise<GoogleExploreDestination[]> {
  const run = async (departure: string) => {
    const params = new URLSearchParams({
      engine: "google_travel_explore",
      departure_id: departure,
      currency: "USD",
      hl: "es",
      gl: "ar",
      adults: "1", // precio por persona
    });
    if (month) params.set("month", String(month));
    // googleSearch revisa el presupuesto del mes (si quedan pocas, no busca) y anota la búsqueda.
    const r = await googleSearch<GoogleExploreResponse>(apiKey, params, "serpapi-explore");
    if (!r?.destinations?.length) return null;
    // Guardamos solo los campos que usamos: la respuesta completa es pesada.
    return r.destinations.map((d) => ({
      name: d.name,
      country: d.country,
      destination_airport: { code: d.destination_airport?.code },
      start_date: d.start_date,
      end_date: d.end_date,
      flight_price: d.flight_price,
      hotel_price: d.hotel_price,
      airline: d.airline,
      link: d.link,
      flight_duration: d.flight_duration,
      number_of_stops: d.number_of_stops,
      thumbnail: d.thumbnail,
    }));
  };
  const data = await cached<GoogleExploreDestination[]>(`gx2:${origin}-${month ?? "flex"}`, 24 * 3600, async () => {
    const airports = airportsFor(origin);
    return (await run(airports)) ?? (airports.includes(",") ? await run(airports.split(",")[0]) : null);
  });
  return data ?? [];
}

/**
 * Mínimos reales del mes de Aviasales para hasta 6 meses, sin pasar el límite
 * de CPU: primero lo cacheado y la foto compacta del radar (si esa ciudad la
 * tiene); de Travelpayouts se baja como mucho un mes nuevo por búsqueda.
 */
async function travelpayoutsMonths(token: string, origin: string, months: { month: number; year: number }[]) {
  const keys = months.map(({ month, year }) => `${year}-${String(month).padStart(2, "0")}`);
  const radar = await radarMonthFares(origin, keys);
  const found = await cheapestAnywhereMonths(token, origin, keys, radar);
  return months.flatMap(({ month }, i) => {
    const prices = found.get(keys[i]);
    return prices ? [[month, prices] as const] : [];
  });
}

export interface RealPrices {
  /** Precios reales conocidos de un destino del catálogo (uno por mes). */
  forDest: (dest: Destination) => RealPrice[];
  /** Destinos que devolvió Google y no están en el catálogo. */
  extra: ExtraDestination[];
}

export async function realPrices(
  keys: { serpapi?: string; travelpayouts?: string },
  origin: string,
  months: { month: number; year: number }[],
  singleMonth: number | null,
  /** "Fines de semana largos": precios para esas fechas exactas (en vez del mínimo del mes). */
  weekends?: { from: string; to: string }[],
): Promise<RealPrices> {
  const wanted = new Set(months.map((m) => m.month));
  const byDest = new Map<string, RealPrice[]>();
  const extra: ExtraDestination[] = [];
  const push = (id: string, p: RealPrice) => byDest.set(id, [...(byDest.get(id) ?? []), p]);

  const [google, tp] = await Promise.all([
    keys.serpapi ? googleExploreRaw(keys.serpapi, origin, singleMonth) : Promise.resolve([]),
    keys.travelpayouts && weekends
      ? Promise.resolve([])
      : keys.travelpayouts
      ? travelpayoutsMonths(keys.travelpayouts, origin, months.slice(0, 6))
      : Promise.resolve([]),
  ]);

  for (const g of google) {
    const flight = num(g.flight_price);
    const start = g.start_date?.slice(0, 10);
    if (!flight || !start) continue;
    const month = Number(start.slice(5, 7));
    if (!wanted.has(month)) continue; // Google a veces ignora el mes pedido
    const price: RealPrice = {
      month,
      flightPP: flight,
      hotelNight: num(g.hotel_price),
      depart: start,
      ret: g.end_date?.slice(0, 10),
      airline: g.airline,
      link: g.link,
      source: "google",
    };
    if (typeof g.number_of_stops === "number") price.stops = g.number_of_stops;
    const dest = g.destination_airport?.code ? BY_AIRPORT.get(g.destination_airport.code) : undefined;
    if (dest) {
      push(dest.id, price);
    } else if (g.name) {
      extra.push({
        name: g.name,
        country: g.country ?? "",
        airport: g.destination_airport?.code ?? "",
        flightPP: flight,
        hotelNight: price.hotelNight ?? null,
        depart: start,
        ret: price.ret ?? null,
        airline: g.airline ?? null,
        link: g.link ?? null,
        thumbnail: g.thumbnail ?? null,
        stops: g.number_of_stops ?? null,
      });
    }
  }

  // Travelpayouts solo para los destinos sin precio de Google.
  const googleIds = new Set(byDest.keys());
  for (const [month, prices] of tp) {
    for (const dest of DESTINATIONS) {
      if (googleIds.has(dest.id)) continue;
      const flight = prices.get(dest.iata);
      if (flight) push(dest.id, { month, flightPP: flight, source: "aviasales" });
    }
  }

  // Fines de semana largos: lo que vieron en Aviasales saliendo la noche
  // anterior o el primer día libre y volviendo el último (mismo caché que /escapes).
  if (keys.travelpayouts && weekends?.length) {
    const lists = await Promise.all(
      weekends.flatMap((w) => [offersFor(keys.travelpayouts!, origin, addDays(w.from, -1), w.to), offersFor(keys.travelpayouts!, origin, w.from, w.to)]),
    );
    for (const list of lists) {
      for (const o of list) {
        const dest = BY_AIRPORT.get(o.code);
        if (!dest) continue;
        push(dest.id, { month: Number(o.depart.slice(5, 7)), flightPP: o.price, depart: o.depart, ret: o.ret, airline: o.airline, source: "aviasales" });
      }
    }
  }

  extra.sort((a, b) => a.flightPP - b.flightPP);
  return { forDest: (d) => byDest.get(d.id) ?? [], extra };
}
