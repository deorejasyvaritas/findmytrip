import type { Destination, HotelQuote, RealHotel, Style } from "../../shared/types.ts";
import { cached } from "../cache.ts";
import { googleSearch } from "../google-budget.ts";
import { addDays } from "../engine.ts";
import { googleBadges, normalizeCheckIn } from "../../shared/hotel-badges.ts";
import type { RoomOccupancy } from "../../shared/pricing.ts";

// SerpApi (Google Hotels) — 250 búsquedas/mes gratis. Precios reales por
// fecha. Se consulta solo a pedido y con caché de 24 h.

export interface GoogleHotelProperty {
  name?: string;
  type?: string;
  link?: string;
  rate_per_night?: { extracted_lowest?: number };
  total_rate?: { extracted_lowest?: number };
  overall_rating?: number;
  reviews?: number;
  extracted_hotel_class?: number;
  hotel_class?: string;
  images?: { thumbnail?: string }[];
  gps_coordinates?: { latitude?: number; longitude?: number };
  /** "Free breakfast", "All-inclusive available", "Beach access"... (o en español con hl=es). */
  amenities?: string[];
  check_in_time?: string;
}

/** Con una búsqueda por nombre, Google puede devolver directo la ficha del hotel (sin `properties`). */
interface GoogleHotelsResponse extends GoogleHotelProperty {
  properties?: GoogleHotelProperty[];
  error?: string;
}

/** Ocupación de una habitación para SerpApi: adultos, chicos y sus edades. */
function occupancyParams(o: RoomOccupancy): Record<string, string> {
  const ages = o.childAges.map((a) => Math.max(1, a)); // SerpApi pide edades de 1 a 17
  return {
    adults: String(Math.min(6, Math.max(1, o.adults))),
    ...(ages.length && { children: String(ages.length), children_ages: ages.join(",") }),
  };
}
const occKey = (o: RoomOccupancy) => `${o.adults}${o.childAges.length ? `k${o.childAges.join(".")}` : ""}`;

/** Distancia aproximada en km entre dos puntos. */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Radio alrededor del destino dentro del que aceptamos hoteles. */
const MAX_HOTEL_KM = 80;

// Ciudad base para buscar hoteles cuando el destino es un país o una región
// (coincide con las coordenadas del catálogo).
const HOTEL_CITY: Record<string, string> = {
  croacia: "Dubrovnik",
  tailandia: "Bangkok",
  japon: "Tokio",
  "costa-rica": "San José",
  marruecos: "Marrakech",
  colonia: "Montevideo",
  iguazu: "Puerto Iguazú",
  galapagos: "Puerto Ayora, Galápagos",
};

/** Texto de búsqueda sin ambigüedad ("Aruba, Aruba" hacía que Google trajera hoteles de Argentina). */
export function hotelQuery(dest: Destination): string {
  const city = HOTEL_CITY[dest.id] ?? dest.name.split(" y ")[0];
  return city === dest.country ? `hoteles en ${city}` : `hoteles en ${city}, ${dest.country}`;
}

/** Descarta hoteles que Google devuelve lejos del destino. */
export function nearDestination(dest: Destination, p: Pick<GoogleHotelProperty, "gps_coordinates">): boolean {
  const lat = p.gps_coordinates?.latitude;
  const lon = p.gps_coordinates?.longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  return distanceKm(dest.lat, dest.lon, lat, lon) <= MAX_HOTEL_KM;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

export async function googleHotels(
  apiKey: string,
  dest: Destination,
  checkin: string,
  nights: number,
  /** Ocupación de una habitación (el precio es por habitación). */
  room: RoomOccupancy,
): Promise<HotelQuote | null> {
  const checkout = addDays(checkin, nights);
  const params = new URLSearchParams({
    engine: "google_hotels",
    q: hotelQuery(dest),
    check_in_date: checkin,
    check_out_date: checkout,
    ...occupancyParams(room),
    currency: "USD",
    hl: "es",
    sort_by: "13", // mejor puntuación primero; después ordenamos por precio
    rating: "7", // 3.5+ estrellas de reseñas: evita opciones malas
  });
  // Guardamos la cotización ya armada, no la respuesta cruda (pesa mucho).
  return cached<HotelQuote>(`gh4:${dest.id}-${checkin}-${nights}-${occKey(room)}`, 24 * 3600, async () => {
    // googleSearch revisa el presupuesto del mes y anota la búsqueda.
    const data = await googleSearch<GoogleHotelsResponse>(apiKey, params, "serpapi-hotels");
    return data ? toHotelQuote(data, dest, checkin, checkout, nights) : null;
  });
}

/** Una propiedad de Google Hotels a nuestro formato compacto (sin la respuesta cruda). */
export function toRealHotel(p: GoogleHotelProperty, nights: number): RealHotel | null {
  if (!p.name || !p.rate_per_night?.extracted_lowest) return null;
  const nightly = Math.round(p.rate_per_night.extracted_lowest);
  const stars = p.extracted_hotel_class ?? (Number(/(\d)/.exec(p.hotel_class ?? "")?.[1]) || null);
  return {
    name: p.name,
    nightlyUSD: nightly,
    totalUSD: Math.round(p.total_rate?.extracted_lowest ?? nightly * nights),
    rating: p.overall_rating ?? null,
    reviews: p.reviews ?? null,
    stars,
    type: p.type ?? null,
    thumbnail: p.images?.[0]?.thumbnail ?? null,
    link: p.link ?? null,
    // En Google Hotels, `link` es el sitio oficial del hotel.
    officialUrl: p.link ?? null,
    lat: p.gps_coordinates?.latitude ?? null,
    lon: p.gps_coordinates?.longitude ?? null,
    ...googleBadges(p.amenities, p.name),
    checkIn: normalizeCheckIn(p.check_in_time),
  };
}

function toHotelQuote(data: GoogleHotelsResponse, dest: Destination, checkin: string, checkout: string, nights: number): HotelQuote | null {
  if (!data.properties?.length) return null;

  const hotels: RealHotel[] = data.properties
    .filter((p) => nearDestination(dest, p))
    .map((p) => toRealHotel(p, nights))
    .filter((h): h is RealHotel => h !== null)
    .sort((a, b) => a.nightlyUSD - b.nightlyUSD);
  if (!hotels.length) return null;

  const prices = hotels.map((h) => h.nightlyUSD);
  const tiers: Record<Style, number> = {
    low: percentile(prices, 0.15),
    mid: percentile(prices, 0.5),
    high: percentile(prices, 0.85),
  };
  return { checkin, checkout, hotels, tiers, source: "google" };
}

/** Normaliza un nombre para comparar ("Ecoporto" ~ "Hotel Ecoporto Porto de Galinhas"). */
export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Palabras genéricas que no sirven para reconocer un hotel por su nombre.
const STOPWORDS = new Set(["hotel", "hoteles", "pousada", "posada", "resort", "the", "del", "las", "los", "por", "and", "spa", "inn"]);

/** ¿El hotel coincide con lo que se buscó? Todas las palabras de 3+ letras del pedido están en el nombre. */
export function nameMatches(query: string, name: string): boolean {
  const words = normName(query)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const n = ` ${normName(name)} `;
  return words.length > 0 && words.every((w) => n.includes(w));
}

/**
 * Buscar un hotel por nombre en Google Hotels ("Brisa Maragogi"): una
 * búsqueda (con cuota) solo cuando el usuario la pide, con caché de 24 h.
 * Devuelve los que coinciden con el nombre y están cerca del lugar.
 */
export async function googleHotelByName(
  apiKey: string,
  name: string,
  place: Pick<Destination, "id" | "name" | "country" | "lat" | "lon">,
  checkin: string,
  nights: number,
  room: RoomOccupancy,
): Promise<RealHotel[] | null> {
  const checkout = addDays(checkin, nights);
  const q = `${name} ${place.name}, ${place.country}`;
  const params = new URLSearchParams({
    engine: "google_hotels",
    q,
    check_in_date: checkin,
    check_out_date: checkout,
    ...occupancyParams(room),
    currency: "USD",
    hl: "es",
  });
  const key = `ghn1:${normName(name).slice(0, 40)}-${place.lat.toFixed(1)},${place.lon.toFixed(1)}-${checkin}-${nights}-${occKey(room)}`;
  const r = await cached<{ hotels: RealHotel[] }>(key, 24 * 3600, async () => {
    const data = await googleSearch<GoogleHotelsResponse>(apiKey, params, "serpapi-hotel-name");
    if (!data) return null;
    // Ficha directa del hotel (Google la abre cuando el nombre es exacto) o lista.
    const props = data.properties?.length ? data.properties : data.name ? [data] : [];
    const near = props.filter((p) => !p.gps_coordinates || nearDestination(place as Destination, p));
    const hotels = near
      .map((p) => toRealHotel(p, nights))
      .filter((h): h is RealHotel => h !== null && nameMatches(name, h.name))
      .slice(0, 5);
    return { hotels };
  });
  return r?.hotels ?? null;
}
