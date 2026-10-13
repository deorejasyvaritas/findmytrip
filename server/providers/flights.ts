import type { Destination, FlightCalendar, FlightDay, FlightOffer, FlightQuote } from "../../shared/types.ts";
import { cached, fetchJSON, peek } from "../cache.ts";
import { addDays, estimatedCalendar } from "../engine.ts";

// ---------------------------------------------------------------------------
// Travelpayouts (Aviasales Data API) — gratis con token.
// Son precios reales encontrados por usuarios de Aviasales en los últimos días.
// Ideal para explorar y armar calendarios sin gastar cuota.
// ---------------------------------------------------------------------------

const TP = "https://api.travelpayouts.com";

async function tp<T>(token: string, path: string, params: Record<string, string>, ttl: number): Promise<T | null> {
  const qs = new URLSearchParams(params).toString();
  return cached<T>(`tp:${path}?${qs}`, ttl, () =>
    fetchJSON<T>(`${TP}${path}?${qs}`, "travelpayouts", { headers: { "X-Access-Token": token } }),
  );
}

interface PricesForDatesItem {
  price: number;
  airline: string;
  departure_at: string;
  return_at?: string;
  transfers: number;
}

/** Calendario del mes: precio real donde hay datos, estimado (marcado) en el resto. */
export async function flightCalendar(
  token: string | undefined,
  origin: string,
  dest: Destination,
  month: string,
  nights: number,
): Promise<FlightCalendar> {
  const estimated = estimatedCalendar(origin, dest, month, nights);
  if (!token) return estimated;
  const data = await tp<{ success: boolean; data: PricesForDatesItem[] }>(
    token,
    "/aviasales/v3/prices_for_dates",
    {
      origin,
      destination: dest.iata,
      departure_at: month,
      one_way: "false",
      currency: "usd",
      sorting: "price",
      limit: "1000",
    },
    3 * 3600,
  );
  if (!data?.success || !data.data?.length) return estimated;

  // El más barato por día de salida, para la misma cantidad de noches.
  const byDay = new Map<string, FlightDay>();
  for (const item of data.data) {
    const date = item.departure_at.slice(0, 10);
    const returnDate = item.return_at?.slice(0, 10) ?? addDays(date, nights);
    const stay = (Date.parse(returnDate) - Date.parse(date)) / 86400000;
    if (stay !== nights) continue; // solo viajes de exactamente las noches pedidas
    const prev = byDay.get(date);
    if (!prev || item.price < prev.priceUSD) {
      byDay.set(date, {
        date,
        returnDate,
        priceUSD: Math.round(item.price),
        source: "en vivo",
        airline: item.airline,
        stops: item.transfers,
      });
    }
  }
  if (!byDay.size) return estimated;

  const days = estimated.days.map((d) => byDay.get(d.date) ?? d);
  const cheapest = days.reduce<FlightDay | null>((acc, d) => {
    // Preferimos precios reales al elegir el día más barato.
    if (!acc) return d;
    if (d.source !== acc.source) return d.source === "en vivo" ? d : acc;
    return d.priceUSD < acc.priceUSD ? d : acc;
  }, null);
  return { ...estimated, days, cheapest, live: true };
}

/** Precio real más barato del mes desde `origin` hacia cualquier destino (por IATA de ciudad). */
export async function cheapestAnywhere(token: string, origin: string, month: string): Promise<Map<string, number>> {
  // Guardamos solo destino -> precio: la respuesta cruda es grande y procesarla
  // en cada búsqueda gasta CPU (el plan gratuito de Workers da 10 ms por pedido).
  const compact = await cached<Record<string, number>>(`tpc:${origin}-${month}`, 6 * 3600, async () => {
    const qs = new URLSearchParams({ origin, destination: "-", depart_date: month, return_date: month, currency: "usd" });
    const data = await fetchJSON<{ success: boolean; data: Record<string, Record<string, { price: number }>> }>(
      `${TP}/v1/prices/cheap?${qs}`,
      "travelpayouts",
      { headers: { "X-Access-Token": token } },
    );
    if (!data?.success || !data.data) return null;
    const out: Record<string, number> = {};
    for (const [iata, offers] of Object.entries(data.data)) {
      const prices = Object.values(offers).map((o) => o.price);
      if (prices.length) out[iata] = Math.round(Math.min(...prices));
    }
    return out;
  });
  return new Map(Object.entries(compact ?? {}));
}

// ---------------------------------------------------------------------------
// SerpApi (Google Flights) — 250 búsquedas/mes gratis. Se usa solo a pedido
// ("confirmar precio") y con caché de 12 h para cuidar la cuota.
// ---------------------------------------------------------------------------

// Google Flights trabaja con aeropuertos, no con códigos de ciudad.
const CITY_AIRPORTS: Record<string, string> = {
  BUE: "EZE,AEP",
  RIO: "GIG,SDU",
  NYC: "JFK,EWR,LGA",
  PAR: "CDG,ORY",
  ROM: "FCO,CIA",
  TYO: "HND,NRT",
  MIL: "MXP,LIN",
  LON: "LHR,LGW",
  SAO: "GRU,CGH",
};
export const airportsFor = (code: string) => CITY_AIRPORTS[code] ?? code;

interface GoogleFlight {
  price?: number;
  total_duration?: number;
  layovers?: unknown[];
  flights?: { airline?: string; departure_airport?: { time?: string } }[];
}
interface GoogleFlightsResponse {
  best_flights?: GoogleFlight[];
  other_flights?: GoogleFlight[];
  price_insights?: { lowest_price?: number; price_level?: string; typical_price_range?: number[] };
  search_metadata?: { google_flights_url?: string };
  error?: string;
}

export async function googleFlights(
  apiKey: string,
  origin: string,
  dest: Destination,
  depart: string,
  ret: string,
  cacheOnly = false,
): Promise<FlightQuote | null> {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: airportsFor(origin),
    arrival_id: airportsFor(dest.iata),
    outbound_date: depart,
    return_date: ret,
    type: "1",
    adults: "1", // precio por persona
    currency: "USD",
    hl: "es",
    gl: "ar",
    api_key: apiKey,
  });
  const key = `gf:${origin}-${dest.iata}-${depart}-${ret}`;
  const data = cacheOnly
    ? await peek<GoogleFlightsResponse>(key)
    : await cached<GoogleFlightsResponse>(key, 12 * 3600, async () => {
        const r = await fetchJSON<GoogleFlightsResponse>(`https://serpapi.com/search.json?${params}`, "serpapi-flights");
        return r && !r.error ? r : null;
      });
  if (!data) return null;

  const toOffer = (f: GoogleFlight): FlightOffer | null =>
    f.price
      ? {
          priceUSD: Math.round(f.price),
          airlines: [...new Set((f.flights ?? []).map((s) => s.airline).filter(Boolean) as string[])],
          stops: f.layovers?.length ?? Math.max(0, (f.flights?.length ?? 1) - 1),
          durationMin: f.total_duration ?? null,
          departTime: f.flights?.[0]?.departure_airport?.time ?? null,
        }
      : null;
  const offers = [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
    .map(toOffer)
    .filter((o): o is FlightOffer => o != null)
    .sort((a, b) => a.priceUSD - b.priceUSD)
    .slice(0, 6);
  if (!offers.length) return null;

  const range = data.price_insights?.typical_price_range;
  return {
    depart,
    returnDate: ret,
    offers,
    lowestUSD: offers[0].priceUSD,
    typicalRangeUSD: range?.length === 2 ? [Math.round(range[0]), Math.round(range[1])] : null,
    priceLevel: data.price_insights?.price_level ?? null,
    url: data.search_metadata?.google_flights_url ?? null,
  };
}
