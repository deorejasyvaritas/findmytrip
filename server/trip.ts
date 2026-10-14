import type { Destination, GeoPlace, TripLeg, TripPlan, TripPlanRequest } from "../shared/types.ts";
import { edgeCached, fetchJSON } from "./cache.ts";
import { DESTINATIONS } from "./data/destinations.ts";
import AIRPORTS from "./data/airports.json";
import { groundEstimate } from "../shared/ground.ts";
import { addDays } from "./engine.ts";
import { cheapestAnywhere, googleFlights } from "./providers/flights.ts";
import { searchFlights } from "./search.ts";

// "Ya sé a dónde": un viaje con una o varias paradas en cualquier lugar del
// mundo (también pueblos sin aeropuerto, como Maragogi o Porto de Galinhas).
// - Lugares: geocodificación de Open-Meteo (gratis, sin clave).
// - Aeropuerto de cada parada: el más conveniente entre los cercanos (lista
//   pública de aeropuertos de Travelpayouts), priorizando el vuelo más barato.
// - Entre paradas cercanas: traslado por tierra; si están lejos, vuelo.

const toRad = Math.PI / 180;
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * toRad) / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(((lon2 - lon1) * toRad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

interface OpenMeteoPlace {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  population?: number;
  feature_code?: string;
}

/** Lugares que coinciden con el texto: primero los del catálogo, después cualquier ciudad o pueblo. */
export async function geocode(term: string): Promise<GeoPlace[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const catalog: GeoPlace[] = DESTINATIONS.filter((d) => norm(d.name).includes(norm(q)) || norm(d.country) === norm(q))
    .slice(0, 3)
    .map((d) => ({ name: d.name, region: null, country: d.country, lat: d.lat, lon: d.lon, destinationId: d.id }));
  const found =
    (await edgeCached<GeoPlace[]>(`geo:${norm(q)}`, 30 * 86400, async () => {
      const qs = new URLSearchParams({ name: q, count: "8", language: "es" });
      const r = await fetchJSON<{ results?: OpenMeteoPlace[] }>(`https://geocoding-api.open-meteo.com/v1/search?${qs}`, "geocoding");
      if (!r) return null;
      return (r.results ?? [])
        .filter((p) => !p.feature_code || p.feature_code.startsWith("PPL") || p.feature_code.startsWith("ADM"))
        .map((p) => ({ name: p.name, region: p.admin1 ?? null, country: p.country ?? "", lat: p.latitude, lon: p.longitude, destinationId: null }));
    })) ?? [];
  // Si un resultado es un destino del catálogo (misma zona), lo marcamos para ofrecer su ficha.
  const withCatalog = found.map((p) => {
    const d = DESTINATIONS.find((x) => distanceKm(x.lat, x.lon, p.lat, p.lon) < 40);
    return d ? { ...p, destinationId: d.id } : p;
  });
  const seen = new Set(catalog.map((c) => c.destinationId));
  return [...catalog, ...withCatalog.filter((p) => !p.destinationId || !seen.has(p.destinationId))].slice(0, 8);
}

type AirportRow = [code: string, city: string, lat: number, lon: number, name: string];

/**
 * Aeropuertos con vuelos comerciales: lista compacta incluida en el código
 * (server/data/airports.json, se regenera con `node scripts/airports.mjs`).
 * Antes se bajaba y parseaba la lista completa (2,4 MB): eso solo ya pasaba el
 * límite de CPU del plan gratuito.
 */
async function airports(): Promise<AirportRow[]> {
  return AIRPORTS as AirportRow[];
}

export interface NearAirport {
  code: string;
  city: string;
  name: string;
  km: number;
}

export function nearestAirports(list: AirportRow[], lat: number, lon: number, n = 4): NearAirport[] {
  return list
    .map(([code, city, la, lo, name]) => ({ code, city, name, km: Math.round(distanceKm(lat, lon, la, lo)) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/** Entre los aeropuertos cercanos (hasta 1,6 veces la distancia del más cercano), el de vuelo más barato. */
export function pickAirport(near: NearAirport[], fares: Map<string, number>): NearAirport | null {
  if (!near.length) return null;
  const limit = Math.max(near[0].km * 1.6, near[0].km + 40);
  const options = near.filter((a) => a.km <= Math.min(limit, 300));
  const priced = options.filter((a) => fares.has(a.city)).sort((a, b) => fares.get(a.city)! - fares.get(b.city)!);
  return priced[0] ?? options[0] ?? near[0];
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const aviasalesUrl = (from: string, to: string, depart: string, ret: string | null, adults: number, marker?: string) =>
  `https://www.aviasales.com/search/${from}${ddmm(depart)}${to}${ret ? ddmm(ret) : ""}${adults}${marker ? `?marker=${marker}` : ""}`;

/** Ciudad del catálogo más cercana: sirve para estimar el alojamiento de lugares fuera del catálogo. */
export function nearestCatalog(lat: number, lon: number): { dest: Destination; km: number } {
  return DESTINATIONS.map((dest) => ({ dest, km: distanceKm(lat, lon, dest.lat, dest.lon) })).sort((a, b) => a.km - b.km)[0];
}

export async function planTrip(token: string | undefined, req: TripPlanRequest, marker?: string, googleKey?: string): Promise<TripPlan> {
  const list = await airports();
  const fares = token ? await cheapestAnywhere(token, req.origin, req.depart.slice(0, 7)).catch(() => new Map<string, number>()) : new Map<string, number>();

  // Fechas de cada parada.
  let cursor = req.depart;
  const stops = req.stops.map((s) => {
    const checkin = cursor;
    cursor = addDays(cursor, s.nights);
    const airport = pickAirport(nearestAirports(list, s.lat, s.lon), fares);
    return { ...s, checkin, checkout: cursor, airport };
  });
  const ret = cursor;
  const first = stops[0].airport;
  const last = stops[stops.length - 1].airport;

  const cheapest = async (from: string, to: string, depart: string, back: string | null) => {
    if (!token) return { best: null, near: null };
    const r = await searchFlights(token, { origin: from, destination: to, depart, ret: back }, marker).catch(() => null);
    // El día con precio real más cercano a la fecha pedida (si empatan, el más barato).
    const gap = (d: string) => Math.abs(Date.parse(d) - Date.parse(depart));
    const near = r?.strip.length ? [...r.strip].sort((a, b) => gap(a.date) - gap(b.date) || a.price - b.price)[0] : null;
    return { best: r?.results[0] ?? null, near };
  };

  const legs: TripLeg[] = [];
  const flightLeg = async (from: string, to: string, date: string, back: string | null, label: string, role: TripLeg["role"], after: number | null = null): Promise<TripLeg> => {
    const { best, near } = await cheapest(from, to, date, back);
    // Sin precio visto para el día exacto: Google Flights de hoy (ida y vuelta, si hay búsquedas en el mes),
    // después el día vecino con precio real y, por último, la referencia del mes.
    const google =
      !best && back && googleKey
        ? await googleFlights(googleKey, from, { iata: to } as Destination, date, back).catch(() => null)
        : null;
    const month = back && from === req.origin ? (fares.get(to) ?? null) : null;
    const price = best?.price ?? google?.lowestUSD ?? near?.price ?? month;
    const priceKind = best || google ? "exacto" : near ? "cercano" : month ? "mes" : null;
    return {
      kind: "flight",
      role,
      after,
      priceKind,
      priceDate: priceKind === "cercano" ? near!.date : null,
      priceSource: google && !best ? "google" : price != null ? "aviasales" : null,
      label,
      from,
      to,
      date,
      returnDate: back,
      price: price ?? null,
      airline: best?.airline ?? null,
      stops: best?.stops ?? null,
      link: best?.link ?? (google?.url || aviasalesUrl(from, to, date, back, 1, marker)),
      liveUrl: aviasalesUrl(from, to, date, back, 1, marker),
      km: null,
      hours: null,
      mapsUrl: null,
    };
  };

  const sameAirport = first && last && first.city === last.city;
  if (first && last) {
    if (sameAirport) {
      legs.push(await flightLeg(req.origin, first.city, req.depart, ret, `Vuelo ida y vuelta ${req.origin}–${first.city}`, "out"));
    } else {
      legs.push(await flightLeg(req.origin, first.city, req.depart, null, `Vuelo de ida ${req.origin}–${first.city}`, "out"));
    }
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const straight = distanceKm(a.lat, a.lon, b.lat, b.lon);
    // Por ruta se recorre bastante más que en línea recta (~30 % en promedio).
    const km = Math.round(straight * 1.3);
    const byAir = straight > 500 && a.airport && b.airport && a.airport.city !== b.airport.city;
    if (byAir) {
      legs.push(await flightLeg(a.airport!.city, b.airport!.city, a.checkout, null, `Vuelo ${a.name}–${b.name}`, "between", i));
    } else {
      // ~70 km/h promedio más media hora de margen.
      legs.push({
        kind: "ground",
        role: "between",
        after: i,
        label: `${a.name} a ${b.name} por tierra`,
        from: a.name,
        to: b.name,
        date: a.checkout,
        returnDate: null,
        price: null,
        priceKind: null,
        priceDate: null,
        priceSource: null,
        airline: null,
        stops: null,
        link: null,
        liveUrl: null,
        km,
        hours: Math.round((km / 70 + 0.5) * 2) / 2,
        mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&travelmode=driving`,
        ground: groundEstimate(km, a.country, b.country, a.name, b.name),
      });
    }
  }

  if (first && last && !sameAirport) {
    legs.push(await flightLeg(last.city, req.origin, ret, null, `Vuelo de vuelta ${last.city}–${req.origin}`, "back"));
  }

  return {
    origin: req.origin,
    depart: req.depart,
    ret,
    stops: stops.map((s) => ({
      name: s.name,
      region: s.region ?? null,
      country: s.country,
      lat: s.lat,
      lon: s.lon,
      nights: s.nights,
      checkin: s.checkin,
      checkout: s.checkout,
      airport: s.airport,
    })),
    legs,
  };
}
