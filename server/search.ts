import type { FlightResult, FlightSearch, LegResult, MultiSearch, Place } from "../shared/types.ts";
import { cached, edgeCached, fetchJSON } from "./cache.ts";
import { addDays } from "./engine.ts";

// Buscador completo (estilo Despegar) con datos gratis:
// - Lugares: autocompletar de Travelpayouts (sin clave).
// - Vuelos: precios reales que vieron usuarios de Aviasales en los últimos días
//   (Data API). No es precio en vivo: cada resultado tiene link a Aviasales para
//   confirmarlo en tiempo real.

const TP = "https://api.travelpayouts.com";

interface TPPlace {
  type?: string;
  code?: string;
  name?: string;
  city_name?: string;
  country_name?: string;
  main_airport_name?: string | null;
}

/** Ciudades y aeropuertos que coinciden con lo que se escribe (caché de 30 días por texto). */
export async function searchPlaces(term: string): Promise<Place[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];
  const list = await edgeCached<Place[]>(`places:${q}`, 30 * 86400, async () => {
    const qs = new URLSearchParams({ term: q, locale: "es" });
    qs.append("types[]", "city");
    qs.append("types[]", "airport");
    const r = await fetchJSON<TPPlace[]>(`https://autocomplete.travelpayouts.com/places2?${qs}`, "places");
    if (!Array.isArray(r)) return null;
    return r
      .filter((p) => p.code && p.name)
      .slice(0, 8)
      .map((p) => ({
        code: p.code!,
        name: p.name!,
        type: p.type === "airport" ? "airport" : "city",
        city: p.city_name ?? null,
        country: p.country_name ?? "",
        airport: p.type === "airport" ? p.name! : (p.main_airport_name ?? null),
      }));
  });
  return list ?? [];
}

interface TPTicket {
  origin: string;
  destination: string;
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline?: string;
  flight_number?: string | number;
  departure_at: string;
  return_at?: string;
  transfers?: number;
  return_transfers?: number;
  duration?: number;
  duration_to?: number;
  duration_back?: number;
  link?: string;
}

async function tickets(
  token: string,
  p: { origin: string; destination: string; departure: string; ret?: string; roundTrip: boolean; direct?: boolean },
): Promise<TPTicket[]> {
  const params: Record<string, string> = {
    origin: p.origin,
    destination: p.destination,
    departure_at: p.departure,
    one_way: p.roundTrip ? "false" : "true",
    currency: "usd",
    sorting: "price",
    limit: "200",
  };
  if (p.ret) params.return_at = p.ret;
  if (p.direct) params.direct = "true";
  const qs = new URLSearchParams(params);
  const data = await cached<TPTicket[]>(`srch:${qs}`, 3 * 3600, async () => {
    const r = await fetchJSON<{ success: boolean; data: TPTicket[] }>(`${TP}/aviasales/v3/prices_for_dates?${qs}`, "travelpayouts", {
      headers: { "X-Access-Token": token },
    });
    return r?.success && Array.isArray(r.data) ? r.data : null;
  });
  return data ?? [];
}

const aviasalesLink = (path: string | undefined, marker: string | undefined) =>
  path ? `https://www.aviasales.com${path}${marker ? `${path.includes("?") ? "&" : "?"}marker=${marker}` : ""}` : null;

function toResult(t: TPTicket, marker?: string): FlightResult {
  return {
    price: Math.round(t.price),
    airline: t.airline ?? null,
    flightNumber: t.flight_number != null ? `${t.airline ?? ""}${t.flight_number}` : null,
    origin: t.origin_airport ?? t.origin,
    destination: t.destination_airport ?? t.destination,
    departAt: t.departure_at,
    returnAt: t.return_at ?? null,
    stops: t.transfers ?? null,
    returnStops: t.return_at ? (t.return_transfers ?? null) : null,
    durationOut: t.duration_to ?? (t.return_at ? null : (t.duration ?? null)),
    durationBack: t.duration_back ?? null,
    link: aviasalesLink(t.link, marker),
  };
}

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Vuelos para fechas exactas, más una franja de precios ±3 días para comparar. */
export async function searchFlights(token: string | undefined, s: FlightSearch, marker?: string) {
  if (!token) return { results: [] as FlightResult[], strip: [] as { date: string; price: number }[], live: false };
  const nights = s.ret ? nightsBetween(s.depart, s.ret) : null;
  const months = [...new Set([addDays(s.depart, -3).slice(0, 7), addDays(s.depart, 3).slice(0, 7)])];

  const [exact, ...monthly] = await Promise.all([
    tickets(token, { origin: s.origin, destination: s.destination, departure: s.depart, ret: s.ret ?? undefined, roundTrip: Boolean(s.ret), direct: s.direct }),
    // El mes completo (cualquier vuelta) para armar la franja de días vecinos.
    ...months.map((m) => tickets(token, { origin: s.origin, destination: s.destination, departure: m, roundTrip: Boolean(s.ret) })),
  ]);

  // Mismo vuelo puede venir repetido: nos quedamos con el más barato por combinación.
  const seen = new Map<string, FlightResult>();
  for (const t of exact) {
    if (t.departure_at.slice(0, 10) !== s.depart) continue;
    if (s.ret && t.return_at?.slice(0, 10) !== s.ret) continue;
    const r = toResult(t, marker);
    const key = `${r.flightNumber}-${r.departAt}-${r.returnAt}`;
    const prev = seen.get(key);
    if (!prev || r.price < prev.price) seen.set(key, r);
  }
  const results = [...seen.values()].sort((a, b) => a.price - b.price);

  // Franja ±3 días con la misma cantidad de noches (o solo ida).
  const byDay = new Map<string, number>();
  for (const t of monthly.flat()) {
    const d = t.departure_at.slice(0, 10);
    if (Math.abs(nightsBetween(s.depart, d)) > 3) continue;
    if (nights != null && (!t.return_at || nightsBetween(d, t.return_at.slice(0, 10)) !== nights)) continue;
    const p = Math.round(t.price);
    if (!byDay.has(d) || p < byDay.get(d)!) byDay.set(d, p);
  }
  if (results.length) byDay.set(s.depart, Math.min(byDay.get(s.depart) ?? Infinity, results[0].price));
  const strip = Array.from({ length: 7 }, (_, i) => addDays(s.depart, i - 3))
    .map((date) => ({ date, price: byDay.get(date) ?? 0 }))
    .filter((d) => d.price > 0);

  return { results, strip, live: true };
}

/** Multidestino: el tramo más barato visto para cada fecha (solo ida). */
export async function searchMulti(token: string | undefined, s: MultiSearch, marker?: string): Promise<LegResult[]> {
  return Promise.all(
    s.legs.map(async (leg) => {
      if (!token) return { ...leg, options: [] };
      const list = await tickets(token, { origin: leg.origin, destination: leg.destination, departure: leg.date, roundTrip: false });
      const options = list
        .filter((t) => t.departure_at.slice(0, 10) === leg.date)
        .map((t) => toResult(t, marker))
        .sort((a, b) => a.price - b.price)
        .slice(0, 5);
      return { ...leg, options };
    }),
  );
}
