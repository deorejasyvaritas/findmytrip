import type { Destination, FlightCalendar, FlightDay, FlightOffer, FlightQuote } from "../../shared/types.ts";
import { cached, fetchJSON, peek } from "../cache.ts";
import { addDays, estimatedCalendar } from "../engine.ts";
import { googleSearch } from "../google-budget.ts";

// ---------------------------------------------------------------------------
// Travelpayouts (Aviasales Data API) — gratis con token.
// Son precios reales encontrados por usuarios de Aviasales en los últimos días.
// Ideal para explorar y armar calendarios sin gastar cuota.
// ---------------------------------------------------------------------------

const TP = "https://api.travelpayouts.com";

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
  // Guardamos en KV solo lo que usamos (el más barato por par de fechas), no las
  // respuestas crudas: prices_for_dates trae hasta 1000 filas y releerlas gasta CPU.
  const items = await cached<CalendarItem[]>(`avm1:${origin}-${dest}-${month}-${nights}`, 3 * 3600, async () => {
    const out = await aviasalesMonthRaw(token, origin, dest, month, nights);
    if (!out) return null; // Travelpayouts no respondió: no guardamos nada.
    const best = new Map<string, CalendarItem>();
    for (const i of out) {
      const k = `${i.depart.slice(0, 10)}_${i.ret?.slice(0, 10) ?? ""}`;
      const prev = best.get(k);
      if (!prev || i.price < prev.price) best.set(k, i);
    }
    // Lista vacía también se guarda: evita repetir la búsqueda en rutas sin datos.
    return [...best.values()];
  });
  return items ?? [];
}

const tpFetch = <T,>(token: string, path: string, params: Record<string, string>) =>
  fetchJSON<T>(`${TP}${path}?${new URLSearchParams(params)}`, "travelpayouts", { headers: { "X-Access-Token": token } });

async function aviasalesMonthRaw(token: string, origin: string, dest: string, month: string, nights: number): Promise<CalendarItem[] | null> {
  const [forDates, calendar, matrix] = await Promise.all([
    tpFetch<{ success: boolean; data: PricesForDatesItem[] }>(
      token,
      "/aviasales/v3/prices_for_dates",
      { origin, destination: dest, departure_at: month, one_way: "false", currency: "usd", sorting: "price", limit: "1000" },
    ),
    // Más barato por día de salida para una estadía de `nights` días.
    tpFetch<{ success: boolean; data: Record<string, { price: number; airline?: string; transfers?: number; departure_at?: string; return_at?: string }> }>(
      token,
      "/v1/prices/calendar",
      { origin, destination: dest, depart_date: month, calendar_type: "departure_date", length: String(nights), currency: "usd" },
    ),
    // Matriz del mes: todas las combinaciones vistas, de cualquier duración.
    tpFetch<{ success: boolean; data: { value: number; depart_date: string; return_date?: string; number_of_changes?: number; gate?: string }[] }>(
      token,
      "/v2/prices/month-matrix",
      { origin, destination: dest, month: `${month}-01`, currency: "usd", show_to_affiliates: "true" },
    ),
  ]);
  if (!forDates && !calendar && !matrix) return null;

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

/** [día, precio] más barato por día de salida, ordenado por fecha. */
export type DayPrice = [date: string, price: number];

/**
 * Más barato por día de salida en todo el mes, para una ruta (solo ida si
 * `nights` es null; si no, ida y vuelta de esa cantidad de noches, ±2).
 * Junta dos fuentes gratis de la Data API: prices_for_dates del mes y
 * grouped_prices agrupado por día. En KV queda solo una lista corta
 * [día, precio] por ruta y mes (una escritura por ruta y mes cada 6 h).
 */
export async function monthDays(token: string, origin: string, destination: string, month: string, nights: number | null): Promise<DayPrice[]> {
  const list = await cached<DayPrice[]>(`tpd:${origin}-${destination}-${month}-${nights ?? "ow"}`, 6 * 3600, async () => {
    const headers = { headers: { "X-Access-Token": token } };
    const forDates = new URLSearchParams({
      origin,
      destination,
      departure_at: month,
      one_way: nights == null ? "true" : "false",
      currency: "usd",
      sorting: "price",
      limit: "1000",
    });
    const grouped = new URLSearchParams({ origin, destination, departure_at: month, group_by: "departure_at", currency: "usd" });
    type Item = { price?: number; departure_at?: string; return_at?: string };
    const [a, b] = await Promise.all([
      fetchJSON<{ success: boolean; data: Item[] }>(`${TP}/aviasales/v3/prices_for_dates?${forDates}`, "travelpayouts", headers),
      fetchJSON<{ success: boolean; data: Record<string, Item> }>(`${TP}/aviasales/v3/grouped_prices?${grouped}`, "travelpayouts", headers),
    ]);
    if (!a?.success && !b?.success) return null;
    const items = [...(Array.isArray(a?.data) ? a!.data : []), ...(b?.data && !Array.isArray(b.data) ? Object.values(b.data) : [])];
    return bestPerDay(items, month, nights);
  });
  return list ?? [];
}

/** Lo más barato por día, descartando lo que no es del tipo pedido (solo ida o la estadía buscada). */
export function bestPerDay(items: { price?: number; departure_at?: string; return_at?: string }[], month: string, nights: number | null): DayPrice[] {
  const byDay = new Map<string, number>();
  for (const i of items) {
    if (!i?.price || !i.departure_at) continue;
    const day = i.departure_at.slice(0, 10);
    if (!day.startsWith(month)) continue;
    if (nights == null) {
      if (i.return_at) continue;
    } else {
      if (!i.return_at) continue;
      const stay = Math.round((Date.parse(i.return_at.slice(0, 10)) - Date.parse(day)) / 86400000);
      if (Math.abs(stay - nights) > NIGHTS_TOLERANCE) continue;
    }
    const p = Math.round(i.price);
    if (!byDay.has(day) || p < byDay.get(day)!) byDay.set(day, p);
  }
  return [...byDay.entries()].sort((x, y) => x[0].localeCompare(y[0]));
}

/**
 * Ida y vuelta más barata del mes para una sola ruta (respuesta chica: un solo
 * destino, no el mundo entero). Para lugares que necesitan pocas rutas, como
 * "Cruzá y volá", sin el costo de CPU de bajar todos los destinos.
 */
export async function routeCheapest(token: string, origin: string, destination: string, month: string): Promise<number | null> {
  const r = await cached<{ p: number | null }>(`tpr:${origin}-${destination}-${month}`, 6 * 3600, async () => {
    const qs = new URLSearchParams({ origin, destination, depart_date: month, currency: "usd" });
    const data = await fetchJSON<{ success: boolean; data: Record<string, Record<string, { price: number }>> }>(
      `${TP}/v1/prices/cheap?${qs}`,
      "travelpayouts",
      { headers: { "X-Access-Token": token } },
    );
    if (!data?.success || !data.data) return null;
    const prices = Object.values(data.data[destination] ?? {}).map((o) => o.price);
    return { p: prices.length ? Math.round(Math.min(...prices)) : null };
  });
  return r?.p ?? null;
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

/** Cuántos meses sin caché puede bajar una búsqueda (cada respuesta cruda pesa ~100 KB de JSON). */
export const MAX_UNCACHED_MONTHS = 1;

/**
 * Precios reales del mes (destino -> precio) para varios meses, cuidando el
 * límite de CPU del plan gratuito: parsear la respuesta cruda de
 * /v1/prices/cheap (todos los destinos) cuesta ~1 ms por mes, y seis de golpe
 * más el resto de la búsqueda pasaban los 10 ms.
 * 1) lo ya resumido en KV (tpc:), 2) la foto compacta del radar para esa
 * ciudad (`fallback`), 3) baja de Travelpayouts como mucho `maxFetch` meses.
 * Los meses que quedan afuera no aparecen en el resultado: la búsqueda los
 * estima (y los marca como estimados).
 */
export async function cheapestAnywhereMonths(
  token: string,
  origin: string,
  months: string[],
  fallback: Record<string, Map<string, number>> = {},
  maxFetch = MAX_UNCACHED_MONTHS,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const hits = await Promise.all(months.map((m) => peek<Record<string, number>>(`tpc:${origin}-${m}`)));
  const missing: string[] = [];
  months.forEach((m, i) => {
    const hit = hits[i];
    if (hit) out.set(m, new Map(Object.entries(hit)));
    else if (fallback[m]?.size) out.set(m, fallback[m]);
    else missing.push(m);
  });
  const fetched = await Promise.all(missing.slice(0, Math.max(0, maxFetch)).map(async (m) => [m, await cheapestAnywhere(token, origin, m)] as const));
  for (const [m, prices] of fetched) if (prices.size) out.set(m, prices);
  return out;
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
  ret: string | null,
  cacheOnly = false,
): Promise<FlightQuote | null> {
  const params = new URLSearchParams({
    engine: "google_flights",
    departure_id: airportsFor(origin),
    arrival_id: airportsFor(dest.iata),
    outbound_date: depart,
    // type 1 = ida y vuelta, 2 = solo ida (sin return_date).
    ...(ret ? { return_date: ret, type: "1" } : { type: "2" }),
    adults: "1", // precio por persona
    currency: "USD",
    hl: "es",
    gl: "ar",
  });
  if (!ret) return googleOneWay(apiKey, params, origin, dest.iata, depart, cacheOnly);
  // Guardamos la cotización ya armada (no la respuesta cruda de SerpApi, que pesa mucho).
  const key = `gf2:${origin}-${dest.iata}-${depart}-${ret}`;
  if (cacheOnly) return peek<FlightQuote>(key);
  return cached<FlightQuote>(key, 12 * 3600, async () => {
    // googleSearch revisa el presupuesto del mes y anota la búsqueda.
    const data = await googleSearch<GoogleFlightsResponse>(apiKey, params, "serpapi-flights");
    return data ? toQuote(data, depart, ret, 6) : null;
  });
}

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

function toQuote(data: GoogleFlightsResponse, depart: string, ret: string | null, max: number): FlightQuote | null {
  const offers = [...(data.best_flights ?? []), ...(data.other_flights ?? [])]
    .map(toOffer)
    .filter((o): o is FlightOffer => o != null)
    .sort((a, b) => a.priceUSD - b.priceUSD)
    .slice(0, max);
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
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Google Flights solo ida (type=2). Guarda en caché la cotización ya armada y
 * recortada (3 ofertas), no la respuesta cruda: ocupa poco en KV.
 */
async function googleOneWay(
  apiKey: string,
  params: URLSearchParams,
  origin: string,
  dest: string,
  depart: string,
  cacheOnly: boolean,
): Promise<FlightQuote | null> {
  const key = `gf1:${origin}-${dest}-${depart}`;
  if (cacheOnly) return peek<FlightQuote>(key);
  return cached<FlightQuote>(key, 12 * 3600, async () => {
    const r = await googleSearch<GoogleFlightsResponse>(apiKey, params, "serpapi-flights");
    return r ? toQuote(r, depart, null, 3) : null;
  });
}
