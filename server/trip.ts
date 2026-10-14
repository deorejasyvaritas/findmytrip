import type { Destination, FlightQuote, FlightResult, GeoPlace, LegOption, TripLeg, TripPlan, TripPlanRequest } from "../shared/types.ts";
import { edgeCached, fetchJSON } from "./cache.ts";
import { DESTINATIONS } from "./data/destinations.ts";
import AIRPORTS from "./data/airports.json";
import { groundEstimate } from "../shared/ground.ts";
import { addDays } from "./engine.ts";
import { cheapestAnywhere, googleFlights, monthDays, type DayPrice } from "./providers/flights.ts";
import { canUseGoogle } from "./google-budget.ts";
import { searchFlights } from "./search.ts";
import { aviasalesSearchUrl } from "../shared/links.ts";
import { arrivalFromDuration, infoFromResult, localStamp, type FlightInfo } from "../shared/flight-details.ts";
import { pickWindowDay, validWindow, windowMonths, type TripWindow } from "../shared/trip-window.ts";
import { planTransfers } from "../shared/transfers.ts";
import { directPartnerLink } from "./partner-links.ts";

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

/** Aeropuertos que sirven para la parada: hasta 1,6 veces la distancia del más cercano (máximo 300 km). */
export function airportOptions(near: NearAirport[]): NearAirport[] {
  if (!near.length) return [];
  const limit = Math.max(near[0].km * 1.6, near[0].km + 40);
  return near.filter((a) => a.km <= Math.min(limit, 300));
}

/** Entre los aeropuertos cercanos (hasta 1,6 veces la distancia del más cercano), el de vuelo más barato. */
export function pickAirport(near: NearAirport[], fares: Map<string, number>): NearAirport | null {
  if (!near.length) return null;
  const options = airportOptions(near);
  const priced = options.filter((a) => fares.has(a.city)).sort((a, b) => fares.get(a.city)! - fares.get(b.city)!);
  return priced[0] ?? options[0] ?? near[0];
}


/** Ciudad del catálogo más cercana: sirve para estimar el alojamiento de lugares fuera del catálogo. */
export function nearestCatalog(lat: number, lon: number): { dest: Destination; km: number } {
  return DESTINATIONS.map((dest) => ({ dest, km: distanceKm(lat, lon, dest.lat, dest.lon) })).sort((a, b) => a.km - b.km)[0];
}

type LegPrice = Pick<
  TripLeg,
  "from" | "to" | "price" | "priceKind" | "priceDate" | "priceAt" | "priceSource" | "airline" | "stops" | "link" | "flight" | "options" | "strip"
>;

/** Cuántos vuelos alternativos del mismo día mandamos por tramo ("Cambiar vuelo"). */
export const MAX_LEG_OPTIONS = 8;

/** Vuelos del día como opciones: el más barato primero, sin repetir aerolínea + horario. */
export function legOptions(results: FlightResult[]): LegOption[] {
  const seen = new Set<string>();
  const out: LegOption[] = [];
  for (const r of [...results].sort((a, b) => a.price - b.price)) {
    const key = `${r.airline}-${r.departAt}-${r.returnAt ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ price: r.price, airline: r.airline, link: r.link, source: "aviasales", flight: infoFromResult(r) });
    if (out.length >= MAX_LEG_OPTIONS) break;
  }
  return out;
}

/** Detalle del vuelo de una oferta de Google Flights (horarios locales de Google). */
export function googleInfo(from: string, to: string, offer: FlightQuote["offers"][number]): FlightInfo | null {
  if (!offer.departTime) return null;
  return {
    out: {
      from,
      to,
      departAt: localStamp(offer.departTime),
      arriveAt: offer.arriveTime ? localStamp(offer.arriveTime) : null,
      durationMin: offer.durationMin,
      stops: offer.stops,
      airline: offer.airlines[0] ?? null,
      ...(offer.bags?.length ? { bags: offer.bags } : {}),
    },
    back: null,
  };
}

const gapDays = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000));

/** Día con precio más cercano a `date` (si empatan, el más barato). */
export function nearestDay(days: DayPrice[], date: string): DayPrice | null {
  let best: DayPrice | null = null;
  for (const d of days) {
    const g = gapDays(d[0], date);
    if (!best || g < gapDays(best[0], date) || (g === gapDays(best[0], date) && d[1] < best[1])) best = d;
  }
  return best;
}

/** Hasta cuántos días de distancia el precio del mes cuenta como "cercano" (más allá, es lo más barato del mes). */
const NEAR_IN_MONTH = 7;

export interface LegPriceInput {
  token?: string;
  googleKey?: string;
  marker?: string;
  from: string;
  to: string;
  date: string;
  back: string | null;
  /** Ciudad de salida del viaje: para la referencia del mes de ida y vuelta (cheapestAnywhere). */
  origin?: string;
  fares?: Map<string, number>;
  /** Otros aeropuertos cercanos a cada punta, por si el elegido no tiene ningún precio. */
  altFrom?: string[];
  altTo?: string[];
}

/**
 * Precio de un tramo (solo ida o ida y vuelta), en este orden:
 * 1. Aviasales para el día exacto.
 * 2. Google Flights de hoy (si queda cuota del mes; primero lo que ya está en caché).
 * 3. Aviasales en un día vecino (±3).
 * 4. Aviasales en el mes: el día con precio más cercano (hasta 7 días) o lo más barato del mes.
 * 5. Si el aeropuerto elegido no tiene nada, el mes de Aviasales en los aeropuertos cercanos
 *    (solo esa consulta, para no pasar el límite de subpedidos del plan gratis de Workers).
 */
export async function priceLeg(p: LegPriceInput): Promise<LegPrice> {
  const own = await aviasalesLeg(p, p.from, p.to, true);
  if (own.price != null) return own;
  const combos = [
    ...(p.altFrom ?? []).filter((a) => a !== p.from).map((a) => [a, p.to] as const),
    ...(p.altTo ?? []).filter((a) => a !== p.to).map((a) => [p.from, a] as const),
  ].slice(0, 2);
  for (const [f, t] of combos) {
    const alt = await aviasalesLeg(p, f, t, false);
    if (alt.price != null) return alt;
  }
  return own;
}

async function aviasalesLeg(p: LegPriceInput, from: string, to: string, primary: boolean): Promise<LegPrice> {
  const none: LegPrice = { from, to, price: null, priceKind: null, priceDate: null, priceSource: null, airline: null, stops: null, link: null };
  const r = p.token && primary ? await searchFlights(p.token, { origin: from, destination: to, depart: p.date, ret: p.back }, p.marker).catch(() => null) : null;
  const best = r?.results[0];
  const strip = r?.strip.length ? r.strip : undefined;
  if (best) {
    return {
      from,
      to,
      price: best.price,
      priceKind: "exacto",
      priceDate: null,
      priceSource: "aviasales",
      airline: best.airline,
      stops: best.stops,
      link: best.link,
      flight: infoFromResult(best),
      options: legOptions(r!.results),
      strip,
    };
  }

  if (primary && p.googleKey) {
    const dest = { iata: to } as Destination;
    const google =
      (await googleFlights(p.googleKey, from, dest, p.date, p.back, true).catch(() => null)) ??
      ((await canUseGoogle(p.googleKey)) ? await googleFlights(p.googleKey, from, dest, p.date, p.back).catch(() => null) : null);
    if (google?.lowestUSD) {
      const options: LegOption[] = google.offers.flatMap((o) => {
        const flight = googleInfo(from, to, o);
        return flight ? [{ price: o.priceUSD, airline: o.airlines[0] ?? null, link: google.url, source: "google" as const, flight }] : [];
      });
      return {
        from,
        to,
        price: google.lowestUSD,
        priceKind: "exacto",
        priceDate: null,
        priceAt: google.fetchedAt ?? null,
        priceSource: "google",
        airline: null,
        stops: google.offers[0]?.stops ?? null,
        link: google.url,
        // Solo ida: Google trae horarios de cada vuelo. Ida y vuelta: solo los de la ida.
        flight: google.offers[0] ? googleInfo(from, to, google.offers[0]) : null,
        options: options.length > 1 ? options : undefined,
        strip,
      };
    }
  }

  const near = r?.strip.length ? [...r.strip].sort((a, b) => gapDays(a.date, p.date) - gapDays(b.date, p.date) || a.price - b.price)[0] : null;
  if (near) return { ...none, price: near.price, priceKind: "cercano", priceDate: near.date, priceSource: "aviasales", strip };

  if (p.token) {
    const nights = p.back ? gapDays(p.back, p.date) : null;
    const days = await monthDays(p.token, from, to, p.date.slice(0, 7), nights).catch(() => [] as DayPrice[]);
    const day = nearestDay(days, p.date);
    if (day && day[0] === p.date) return { ...none, price: day[1], priceKind: "exacto", priceSource: "aviasales" };
    if (day && gapDays(day[0], p.date) <= NEAR_IN_MONTH) {
      return { ...none, price: day[1], priceKind: "cercano", priceDate: day[0], priceSource: "aviasales" };
    }
    if (days.length) {
      const min = days.reduce((a, b) => (b[1] < a[1] ? b : a));
      return { ...none, price: min[1], priceKind: "mes", priceDate: min[0], priceSource: "aviasales" };
    }
  }

  const month = p.back && from === p.origin ? (p.fares?.get(to) ?? null) : null;
  if (month) return { ...none, price: month, priceKind: "mes", priceSource: "aviasales" };
  return none;
}

interface TPItem {
  price?: number;
  airline?: string;
  departure_at?: string;
  return_at?: string;
  transfers?: number;
  return_transfers?: number;
  duration_to?: number;
  duration_back?: number;
  duration?: number;
  origin_airport?: string;
  destination_airport?: string;
  link?: string;
}

/**
 * Vuelve a mirar en Aviasales solo el día exacto, sin la caché de 3 h: cuando
 * alguien busca esa ruta en Aviasales, el precio suele aparecer en la Data API
 * a los pocos minutos. Caché de 2 minutos en el borde (Cache API), sin KV.
 */
export async function refreshLeg(
  token: string | undefined,
  marker: string | undefined,
  from: string,
  to: string,
  date: string,
  back: string | null,
): Promise<LegPrice> {
  const none: LegPrice = { from, to, price: null, priceKind: null, priceDate: null, priceSource: null, airline: null, stops: null, link: null };
  if (!token) return none;
  const qs = new URLSearchParams({
    origin: from,
    destination: to,
    departure_at: date,
    one_way: back ? "false" : "true",
    currency: "usd",
    sorting: "price",
    limit: "30",
  });
  if (back) qs.set("return_at", back);
  const data = await edgeFetch<{ success: boolean; data: TPItem[] }>(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${qs}`, token);
  const items = data?.success && Array.isArray(data.data) ? data.data : [];
  const best = items
    .filter((i) => i.price && i.departure_at?.slice(0, 10) === date && (back ? i.return_at?.slice(0, 10) === back : !i.return_at))
    .sort((a, b) => a.price! - b.price!)[0];
  if (!best) return none;
  const link = best.link ? `https://www.aviasales.com${best.link}${marker ? `${best.link.includes("?") ? "&" : "?"}marker=${marker}` : ""}` : null;
  return {
    from,
    to,
    price: Math.round(best.price!),
    priceKind: "exacto",
    priceDate: null,
    priceSource: "aviasales",
    airline: best.airline ?? null,
    stops: best.transfers ?? null,
    link,
    flight: tpInfo(best, from, to),
  };
}

/** Detalle del vuelo de una fila de la Data API (llegada solo si se puede calcular). */
function tpInfo(i: TPItem, from: string, to: string): FlightInfo | null {
  if (!i.departure_at) return null;
  const a = i.origin_airport ?? from;
  const b = i.destination_airport ?? to;
  const durOut = i.duration_to ?? (i.return_at ? null : (i.duration ?? null));
  return {
    out: {
      from: a,
      to: b,
      departAt: localStamp(i.departure_at),
      arriveAt: arrivalFromDuration(i.departure_at, durOut, b),
      durationMin: durOut,
      stops: i.transfers ?? null,
      airline: i.airline ?? null,
    },
    back: i.return_at
      ? {
          from: b,
          to: a,
          departAt: localStamp(i.return_at),
          arriveAt: arrivalFromDuration(i.return_at, i.duration_back, a),
          durationMin: i.duration_back ?? null,
          stops: i.return_transfers ?? null,
          airline: i.airline ?? null,
        }
      : null,
  };
}

async function edgeFetch<T>(url: string, token: string): Promise<T | null> {
  const edge = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const key = new Request(url);
  if (edge) {
    const hit = await edge.match(key).catch(() => undefined);
    if (hit) return (await hit.json().catch(() => null)) as T | null;
  }
  const data = await fetchJSON<T>(url, "travelpayouts-fresh", { headers: { "X-Access-Token": token } });
  if (data && edge) {
    const res = new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=120" } });
    await edge.put(key, res).catch(() => undefined);
  }
  return data;
}

/**
 * Fechas flexibles: el día de salida más barato de la ventana con los precios
 * por día del mes que ya están en caché (monthDays, sin Google). Ida y vuelta
 * al mismo aeropuerto: el precio de ida y vuelta con las noches del viaje. Si
 * no: ida más vuelta (la vuelta sale `nights` días después).
 */
export async function chooseWindowDay(
  token: string | undefined,
  req: Pick<TripPlanRequest, "origin" | "depart" | "window" | "pinned">,
  first: string,
  last: string,
  nights: number,
): Promise<TripWindow | null> {
  const w = req.window;
  if (!w || !validWindow(w)) return null;
  const same = first === last;
  const days = async (from: string, to: string, months: string[], n: number | null) =>
    token ? (await Promise.all(months.map((m) => monthDays(token, from, to, m, n).catch(() => [] as DayPrice[])))).flat() : [];
  const [out, back] = await Promise.all([
    days(req.origin, first, windowMonths(w), same ? nights : null),
    same ? Promise.resolve(null) : days(last, req.origin, windowMonths(w, nights), null),
  ]);
  const pick = pickWindowDay(w, out, back, nights);
  const pinned = Boolean(req.pinned) && req.depart >= w.from && req.depart <= w.to;
  return {
    ...w,
    days: pick.days,
    chosen: pinned ? req.depart : (pick.chosen ?? w.from),
    pinned,
    basis: same ? "ida y vuelta" : pick.combined ? "ida + vuelta" : "solo ida",
  };
}

export async function planTrip(
  token: string | undefined,
  req: TripPlanRequest,
  marker?: string,
  googleKey?: string,
  trs?: string,
): Promise<TripPlan> {
  const list = await airports();
  const month = (req.window && validWindow(req.window) ? req.window.from : req.depart).slice(0, 7);
  const fares = token ? await cheapestAnywhere(token, req.origin, month).catch(() => new Map<string, number>()) : new Map<string, number>();

  // Aeropuerto de cada parada (no depende del día).
  const placed = req.stops.map((s) => {
    const near = nearestAirports(list, s.lat, s.lon);
    const airport = pickAirport(near, fares);
    // Otros aeropuertos de la zona, por si el elegido no tiene precios.
    const alternates = [...new Set(airportOptions(near).map((a) => a.city))].filter((c) => c !== airport?.city).slice(0, 2);
    return { ...s, airport, alternates };
  });

  // Fechas flexibles: elegimos el día de salida antes de poner fechas a cada parada.
  const totalNights = req.stops.reduce((n, s) => n + s.nights, 0);
  const a0 = placed[0].airport;
  const aN = placed[placed.length - 1].airport;
  const window = a0 && aN ? await chooseWindowDay(token, req, a0.city, aN.city, totalNights) : null;
  const depart = window?.chosen ?? (req.window && validWindow(req.window) && !req.pinned ? req.window.from : req.depart);

  // Fechas de cada parada.
  let cursor = depart;
  const stops = placed.map((s) => {
    const checkin = cursor;
    cursor = addDays(cursor, s.nights);
    return { ...s, checkin, checkout: cursor };
  });
  const ret = cursor;
  const first = stops[0].airport;
  const last = stops[stops.length - 1].airport;

  const legs: TripLeg[] = [];
  const flightLeg = async (
    from: string,
    to: string,
    date: string,
    back: string | null,
    label: (from: string, to: string) => string,
    role: TripLeg["role"],
    after: number | null = null,
    alt: { from?: string[]; to?: string[] } = {},
  ): Promise<TripLeg> => {
    const p = await priceLeg({ token, googleKey, marker, from, to, date, back, origin: req.origin, fares, altFrom: alt.from, altTo: alt.to });
    // Precio por adulto: el cliente cambia los pasajeros del link por los del grupo (aviasalesForParty).
    const liveUrl = aviasalesSearchUrl({ from: p.from, to: p.to, depart: date, ret: back, party: 1, marker });
    return {
      kind: "flight",
      role,
      after,
      ...p,
      label: label(p.from, p.to),
      date,
      returnDate: back,
      link: p.link || liveUrl,
      liveUrl,
      km: null,
      hours: null,
      mapsUrl: null,
    };
  };

  const firstStop = stops[0];
  const lastStop = stops[stops.length - 1];
  const sameAirport = first && last && first.city === last.city;
  if (first && last) {
    if (sameAirport) {
      legs.push(await flightLeg(req.origin, first.city, depart, ret, (f, t) => `Vuelo ida y vuelta ${f}–${t}`, "out", null, { to: firstStop.alternates }));
    } else {
      legs.push(await flightLeg(req.origin, first.city, depart, null, (f, t) => `Vuelo de ida ${f}–${t}`, "out", null, { to: firstStop.alternates }));
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
      legs.push(
        await flightLeg(a.airport!.city, b.airport!.city, a.checkout, null, () => `Vuelo ${a.name}–${b.name}`, "between", i, { from: a.alternates, to: b.alternates }),
      );
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
    legs.push(await flightLeg(last.city, req.origin, ret, null, (f, t) => `Vuelo de vuelta ${f}–${t}`, "back", null, { from: lastStop.alternates }));
  }

  const outStops = stops.map((s) => ({
      name: s.name,
      region: s.region ?? null,
      country: s.country,
      lat: s.lat,
      lon: s.lon,
      nights: s.nights,
      checkin: s.checkin,
      checkout: s.checkout,
      airport: s.airport,
    }));
  // Traslado aeropuerto–hotel (estimado) con link para ver el precio exacto.
  const pickups = marker && trs ? directPartnerLink("https://www.welcomepickups.com/", marker, trs) : null;
  const transfers = planTransfers({ stops: outStops, legs }, () => pickups ?? "https://www.welcomepickups.com/");
  return {
    origin: req.origin,
    depart,
    ret,
    stops: outStops.map((s, i) => ({ ...s, transfer: transfers[i] })),
    legs,
    window,
  };
}
