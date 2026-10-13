import type { Destination, ExtraDestination, RealPrice } from "../../shared/types.ts";
import { cached, fetchJSON } from "../cache.ts";
import { DESTINATIONS } from "../data/destinations.ts";
import { airportsFor, cheapestAnywhere } from "./flights.ts";

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
      api_key: apiKey,
    });
    if (month) params.set("month", String(month));
    const r = await fetchJSON<GoogleExploreResponse>(`https://serpapi.com/search.json?${params}`, "serpapi-explore");
    return r && !r.error && r.destinations?.length ? r.destinations : null;
  };
  const data = await cached<GoogleExploreDestination[]>(`gx:${origin}-${month ?? "flex"}`, 12 * 3600, async () => {
    const airports = airportsFor(origin);
    return (await run(airports)) ?? (airports.includes(",") ? await run(airports.split(",")[0]) : null);
  });
  return data ?? [];
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
): Promise<RealPrices> {
  const wanted = new Set(months.map((m) => m.month));
  const byDest = new Map<string, RealPrice[]>();
  const extra: ExtraDestination[] = [];
  const push = (id: string, p: RealPrice) => byDest.set(id, [...(byDest.get(id) ?? []), p]);

  const [google, tp] = await Promise.all([
    keys.serpapi ? googleExploreRaw(keys.serpapi, origin, singleMonth) : Promise.resolve([]),
    keys.travelpayouts
      ? Promise.all(
          months.map(async ({ month, year }) => [
            month,
            await cheapestAnywhere(keys.travelpayouts!, origin, `${year}-${String(month).padStart(2, "0")}`),
          ] as const),
        )
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

  extra.sort((a, b) => a.flightPP - b.flightPP);
  return { forDest: (d) => byDest.get(d.id) ?? [], extra };
}
