import type { Destination, FlightCalendar, FlightDay } from "../../shared/types.ts";
import { addDays, estimatedCalendar } from "../engine.ts";

// Proveedor de precios en vivo: Travelpayouts (Aviasales Data API).
// Devuelve precios encontrados por usuarios en las últimas 48 hs (cacheados por
// Aviasales). Si no hay token o la API falla, usamos estimaciones.

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN?.trim();
const BASE = "https://api.travelpayouts.com";
const TTL_MS = 60 * 60 * 1000;

export const liveFlightsEnabled = Boolean(TOKEN);

const cache = new Map<string, { at: number; value: unknown }>();

async function getJSON<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!TOKEN) return null;
  const qs = new URLSearchParams({ ...params, token: TOKEN }).toString();
  const key = `${path}?${qs}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { "Accept-Encoding": "gzip" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[travelpayouts] ${res.status} en ${path}`);
      return null;
    }
    const value = (await res.json()) as T;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn(`[travelpayouts] error en ${path}:`, (err as Error).message);
    return null;
  }
}

interface PricesForDatesItem {
  price: number;
  airline: string;
  departure_at: string;
  return_at?: string;
  transfers: number;
}

/** Calendario del mes: precio en vivo donde haya datos, estimado en el resto. */
export async function flightCalendar(
  origin: string,
  dest: Destination,
  month: string,
  nights: number,
): Promise<FlightCalendar> {
  const estimated = estimatedCalendar(origin, dest, month, nights);
  const data = await getJSON<{ success: boolean; data: PricesForDatesItem[] }>(
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
  );
  if (!data?.success || !data.data?.length) return estimated;

  // Nos quedamos con el más barato por día de salida, preferentemente con una
  // estadía parecida a la pedida (±3 noches).
  const byDay = new Map<string, FlightDay>();
  for (const item of data.data) {
    const date = item.departure_at.slice(0, 10);
    const returnDate = item.return_at?.slice(0, 10) ?? addDays(date, nights);
    const stay = (Date.parse(returnDate) - Date.parse(date)) / 86400000;
    if (Math.abs(stay - nights) > 3) continue;
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
  const cheapest = days.reduce<FlightDay | null>((acc, d) => (!acc || d.priceUSD < acc.priceUSD ? d : acc), null);
  return { ...estimated, days, cheapest, live: true };
}

/** Precio más barato del mes desde `origin` hacia cualquier destino (por código IATA). */
export async function cheapestAnywhere(origin: string, month: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const data = await getJSON<{ success: boolean; data: Record<string, Record<string, { price: number }>> }>(
    "/v1/prices/cheap",
    { origin, destination: "-", depart_date: month, return_date: month, currency: "usd" },
  );
  if (!data?.success || !data.data) return out;
  for (const [iata, offers] of Object.entries(data.data)) {
    const prices = Object.values(offers).map((o) => o.price);
    if (prices.length) out.set(iata, Math.round(Math.min(...prices)));
  }
  return out;
}
