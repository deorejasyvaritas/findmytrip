import type { Destination, HotelQuote, RealHotel, Style } from "../../shared/types.ts";
import { cached, fetchJSON } from "../cache.ts";
import { addDays } from "../engine.ts";
import { nearDestination } from "./hotels.ts";

// Xotelo: precios reales de hoteles comparando Booking.com, Agoda, Expedia,
// Hotels.com, Trip.com y más (datos de TripAdvisor). Gratis, sin clave y sin
// cuota: es lo más parecido a Aviasales para hoteles.

const API = "https://data.xotelo.com/api";
const HEADERS = { headers: { "User-Agent": "FindMyTrip/1.0 (viajes personales)", Accept: "application/json" } };

// Código de ubicación de TripAdvisor (gNNNN) de la ciudad base de cada destino.
export const TA_GEO: Record<string, string> = {
  bariloche: "g312848",
  mendoza: "g312781",
  salta: "g312822",
  iguazu: "g312806",
  ushuaia: "g312855",
  calafate: "g312851",
  "puerto-madryn": "g312832",
  "san-martin": "g312843",
  rio: "g303506",
  florianopolis: "g303576",
  salvador: "g303272",
  maceio: "g303216",
  "punta-del-este": "g294066",
  colonia: "g294323",
  santiago: "g294305",
  atacama: "g303681",
  cusco: "g294314",
  lima: "g294316",
  cartagena: "g297476",
  medellin: "g297478",
  "san-andres": "g297482",
  uyuni: "g317033",
  galapagos: "g297533",
  "punta-cana": "g147293",
  cancun: "g150807",
  "costa-rica": "g309293",
  aruba: "g147247",
  cdmx: "g150800",
  miami: "g34438",
  "nueva-york": "g60763",
  madrid: "g187514",
  roma: "g187791",
  lisboa: "g189158",
  barcelona: "g187497",
  paris: "g187147",
  grecia: "g189400",
  croacia: "g295371",
  tailandia: "g293916",
  japon: "g298184",
  marruecos: "g293734",
};

interface XoteloListItem {
  key?: string;
  name?: string;
  url?: string;
  image?: string;
  accommodation_type?: string;
  review_summary?: { rating?: number; count?: number };
  price_ranges?: { minimum?: number; maximum?: number };
  geo?: { latitude?: number; longitude?: number };
}
interface XoteloRate {
  code?: string;
  name?: string;
  rate?: number | null;
  tax?: number | null;
}
interface XoteloResponse<T> {
  error?: { message?: string } | null;
  result?: T | null;
}

interface ListedHotel {
  key: string;
  name: string;
  url: string | null;
  image: string | null;
  type: string | null;
  rating: number | null;
  reviews: number | null;
  min: number | null;
}

/** Hoteles de la ciudad (cambia poco: caché de 7 días). */
async function listHotels(dest: Destination, geo: string): Promise<ListedHotel[]> {
  const list = await cached<ListedHotel[]>(`xl:${geo}`, 7 * 86400, async () => {
    const r = await fetchJSON<XoteloResponse<{ list?: XoteloListItem[] }>>(
      `${API}/list?${new URLSearchParams({ location_key: geo, limit: "60", sort: "best_value" })}`,
      "xotelo-list",
      HEADERS,
    );
    const items = r && !r.error ? r.result?.list : null;
    if (!items?.length) return null;
    return items
      .filter((h) => h.key && h.name && nearDestination(dest, { gps_coordinates: h.geo }))
      .map((h) => ({
        key: h.key!,
        name: h.name!,
        url: h.url ? (h.url.startsWith("http") ? h.url : `https://www.tripadvisor.com${h.url}`) : null,
        image: h.image ?? null,
        type: h.accommodation_type ?? null,
        rating: h.review_summary?.rating ?? null,
        reviews: h.review_summary?.count ?? null,
        min: h.price_ranges?.minimum ?? null,
      }));
  });
  return list ?? [];
}

/** Precio más barato por noche (con impuestos) entre los sitios que comparan. */
async function bestRate(key: string, checkin: string, checkout: string): Promise<{ nightly: number; site: string } | null> {
  return cached(`xr:${key}-${checkin}-${checkout}`, 12 * 3600, async () => {
    const r = await fetchJSON<XoteloResponse<{ rates?: XoteloRate[] }>>(
      `${API}/rates?${new URLSearchParams({ hotel_key: key, chk_in: checkin, chk_out: checkout, currency: "USD" })}`,
      "xotelo-rates",
      HEADERS,
    );
    const rates = (r && !r.error ? r.result?.rates : null) ?? [];
    let best: { nightly: number; site: string } | null = null;
    for (const x of rates) {
      if (!x.rate || x.rate <= 0) continue;
      const nightly = Math.round(x.rate + (x.tax ?? 0));
      if (!best || nightly < best.nightly) best = { nightly, site: x.name ?? x.code ?? "" };
    }
    return best;
  });
}

/** Elige hasta `n` hoteles repartidos entre baratos, medios y caros. */
export function spread<T extends { min: number | null; rating: number | null }>(hotels: T[], n: number): T[] {
  const good = hotels.filter((h) => (h.rating ?? 0) >= 3.5);
  const pool = (good.length >= n ? good : hotels).slice().sort((a, b) => (a.min ?? 1e9) - (b.min ?? 1e9));
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];

export async function xoteloHotels(dest: Destination, checkin: string, nights: number): Promise<HotelQuote | null> {
  const geo = TA_GEO[dest.id];
  if (!geo) return null;
  const checkout = addDays(checkin, nights);
  const listed = spread(await listHotels(dest, geo), 12);
  if (!listed.length) return null;

  const priced = await Promise.all(listed.map(async (h) => ({ h, rate: await bestRate(h.key, checkin, checkout).catch(() => null) })));
  const hotels: RealHotel[] = priced
    .filter((p) => p.rate)
    .map(({ h, rate }) => ({
      name: h.name,
      nightlyUSD: rate!.nightly,
      totalUSD: rate!.nightly * nights,
      rating: h.rating,
      reviews: h.reviews,
      stars: null,
      type: h.type,
      thumbnail: h.image,
      link: h.url,
      site: rate!.site || null,
    }))
    .sort((a, b) => a.nightlyUSD - b.nightlyUSD);
  if (hotels.length < 3) return null;

  const prices = hotels.map((h) => h.nightlyUSD);
  const tiers: Record<Style, number> = { low: percentile(prices, 0.15), mid: percentile(prices, 0.5), high: percentile(prices, 0.85) };
  return { checkin, checkout, hotels, tiers, source: "xotelo" };
}
