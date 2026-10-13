import type { Destination, HotelQuote, RealHotel, Style } from "../../shared/types.ts";
import { cached, fetchJSON } from "../cache.ts";
import { addDays } from "../engine.ts";

// SerpApi (Google Hotels) — 250 búsquedas/mes gratis. Precios reales por
// fecha. Se consulta solo a pedido y con caché de 24 h.

interface GoogleHotelProperty {
  name?: string;
  type?: string;
  link?: string;
  rate_per_night?: { extracted_lowest?: number };
  total_rate?: { extracted_lowest?: number };
  overall_rating?: number;
  reviews?: number;
  extracted_hotel_class?: number;
  images?: { thumbnail?: string }[];
}

interface GoogleHotelsResponse {
  properties?: GoogleHotelProperty[];
  error?: string;
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
    q: `${dest.name}, ${dest.country}`,
    check_in_date: checkin,
    check_out_date: checkout,
    adults: String(Math.min(adults, 6)),
    currency: "USD",
    hl: "es",
    gl: "ar",
    sort_by: "13", // mejor puntuación primero; después ordenamos por precio
    rating: "7", // 3.5+ estrellas de reseñas: evita opciones malas
    api_key: apiKey,
  });
  const data = await cached<GoogleHotelsResponse>(`gh:${dest.id}-${checkin}-${nights}-${adults}`, 24 * 3600, async () => {
    const r = await fetchJSON<GoogleHotelsResponse>(`https://serpapi.com/search.json?${params}`, "serpapi-hotels");
    return r && !r.error ? r : null;
  });
  if (!data?.properties?.length) return null;

  const hotels: RealHotel[] = data.properties
    .filter((p) => p.name && p.rate_per_night?.extracted_lowest)
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
  return { checkin, checkout, hotels, tiers };
}
