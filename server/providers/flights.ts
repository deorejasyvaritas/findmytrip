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

interface CalendarItem {
  price: number;
  depart: string;
  ret?: string;
  airline?: string;
  transfers?: number;
}

/** Cuántas noches de diferencia aceptamos si no hay precio para la estadía exacta. */
const NIGHTS_TOLERANCE = 2;

/** Precios reales de Aviasales para un mes, de tres fuentes de la Data API (todas gratis). */
async function aviasalesMonth(token: string, origin: string, dest: string, month: string, nights: number): Promise<CalendarItem[]> {
  const [forDates, calendar, matrix] = await Promise.all([
    tp<{ success: boolean; data: PricesForDatesItem[] }>(
      token,
      "/aviasales/v3/prices_for_dates",
      { origin, destination: dest, departure_at: month, one_way: "false", currency: "usd", sorting: "price", limit: "1000" },
      3 * 3600,
    ),
    // Más barato por día de salida para una estadía de `nights` días.
    tp<{ success: boolean; data: Record<string, { price: number; airline?: string; transfers?: number; departure_at?: string; return_at?: string }> }>(
      token,
      "/v1/prices/calendar",
      { origin, destination: dest, depart_date: month, calendar_type: "departure_date", length: String(nights), currency: "usd" },
      3 * 3600,
    ),
    // Matriz del mes: todas las combinaciones vistas, de cualquier duración.
    tp<{ success: boolean; data: { value: number; depart_date: string; return_date?: string; number_of_changes?: number; gate?: string }[] }>(
      token,
      "/v2/prices/month-matrix",
      { origin, destination: dest, month: `${month}-01`, currency: "usd", show_to_affiliates: "true" },
      3 * 3600,
    ),
  ]);

  const out: CalendarItem[] = [];
  if (forDates?.success && Array.isArray(forDates.data)) {
    for (const i of forDates.data) {
      if (i?.price && i.departure_at) out.push({ price: i.price, depart: i.departure_at, ret: i.return_at, airline: i.airline, transfers: i.transfers });
    }
  }
  if (calendar?.success && calendar.data && !Array.isArray(calendar.data)) {
    for (const [date, i] of Object.entries(calendar.data)) {
      if (i?.price) out.push({ price: i.price, depart: i.departure_at ?? date, ret: i.return_at, airline: i.airline, transfers: i.transfers });
    }
  }
  if (matrix?.success && Array.isArray(matrix.data)) {
    for (const i of matrix.data) {
      if (i?.value && i.depart_date) out.push({ price: i.value, depart: i.depart_date, ret: i.return_date, transfers: i.number_of_changes });
    }
  }
  return out;
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
  const items = await aviasalesMonth(token, origin, dest.iata, month, nights);
  if (!items.length) return estimated;

  // Por día de salida: primero la estadía exacta; si no hay, la más parecida (hasta 2 noches de diferencia).
  const byDay = new Map<string, { day: FlightDay; off: number }>();
  for (const item of items) {
    const date = item.depart.slice(0, 10);
    if (!date.startsWith(month)) continue;
    const returnDate = item.ret?.slice(0, 10) ?? addDays(date, nights);
    const stay = Math.round((Date.parse(returnDate) - Date.parse(date)) / 86400000);
    const off = Math.abs(stay - nights);
    if (off > NIGHTS_TOLERANCE) continue;
    const prev = byDay.get(date);
    const price = Math.round(item.price);
    if (!prev || off < prev.off || (off === prev.off && price < prev.day.priceUSD)) {
      byDay.set(date, {
        off,
        day: { date, returnDate, priceUSD: price, source: "visto", airline: item.airline, stops: item.transfers },
      });
    }
  }
  if (!byDay.size) return estimated;

  const days = estimated.days.map((d) => byDay.get(d.date)?.day ?? d);
  const cheapest = days.reduce<FlightDay | null>((acc, d) => {
    // Preferimos precios reales al elegir el día más barato.
    if (!acc) return d;
    if (d.source !== acc.source) return d.source === "visto" ? d : acc;
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
