import type { Destination, HotelQuote, RealHotel, Style } from "../../shared/types.ts";
import { cached, fetchJSON } from "../cache.ts";
import { addDays } from "../engine.ts";

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
  images?: { thumbnail?: string }[];
  gps_coordinates?: { latitude?: number; longitude?: number };
}

interface GoogleHotelsResponse {
  properties?: GoogleHotelProperty[];
  error?: string;
}

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
  adults: number,
): Promise<HotelQuote | null> {
  const checkout = addDays(checkin, nights);
  const params = new URLSearchParams({
    engine: "google_hotels",
    q: hotelQuery(dest),
    check_in_date: checkin,
    check_out_date: checkout,
    adults: String(Math.min(adults, 6)),
    currency: "USD",
    hl: "es",
    sort_by: "13", // mejor puntuación primero; después ordenamos por precio
    rating: "7", // 3.5+ estrellas de reseñas: evita opciones malas
    api_key: apiKey,
  });
  const data = await cached<GoogleHotelsResponse>(`gh2:${dest.id}-${checkin}-${nights}-${adults}`, 24 * 3600, async () => {
    const r = await fetchJSON<GoogleHotelsResponse>(`https://serpapi.com/search.json?${params}`, "serpapi-hotels");
    return r && !r.error ? r : null;
  });
  if (!data?.properties?.length) return null;

  const hotels: RealHotel[] = data.properties
    .filter((p) => p.name && p.rate_per_night?.extracted_lowest && nearDestination(dest, p))
    .map((p) => {
      const nightly = Math.round(p.rate_per_night!.extracted_lowest!);
      return {
        name: p.name!,
        nightlyUSD: nightly,
        totalUSD: Math.round(p.total_rate?.extracted_lowest ?? nightly * nights),
        rating: p.overall_rating ?? null,
        reviews: p.reviews ?? null,
        stars: p.extracted_hotel_class ?? null,
        type: p.type ?? null,
        thumbnail: p.images?.[0]?.thumbnail ?? null,
        link: p.link ?? null,
      };
    })
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
