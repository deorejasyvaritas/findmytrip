import type { Destination, HotelQuote, RealHotel, Style } from "../../shared/types.ts";
import { cached, edgeCached, fetchJSON } from "../cache.ts";
import { addDays } from "../engine.ts";
import { nameMatches, nearDestination } from "./hotels.ts";
import { xoteloBadges } from "../../shared/hotel-badges.ts";
import type { RoomOccupancy } from "../../shared/pricing.ts";

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
  maragogi: "g644400",
  "porto-de-galinhas": "g303461",
  natal: "g303518",
  fortaleza: "g303293",
  "beto-carrero": "g1910072",
  gramado: "g303536",
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
  orlando: "g34515",
  "los-angeles": "g32655",
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
  /** Etiquetas de TripAdvisor: "All inclusive", "Breakfast included". */
  merchandising_labels?: string[];
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

export interface ListedHotel {
  key: string;
  name: string;
  url: string | null;
  image: string | null;
  type: string | null;
  rating: number | null;
  reviews: number | null;
  min: number | null;
  /** Coordenadas redondeadas (para mostrar la distancia a la parada). */
  lat?: number | null;
  lon?: number | null;
  /** Etiquetas compactas: a = all inclusive, b = desayuno (de `merchandising_labels`). */
  tags?: string;
}

/** Etiquetas de TripAdvisor guardadas en pocas letras (la lista va a KV). */
const compactTags = (labels: string[] | undefined) =>
  [labels?.some((l) => /all[\s-]?inclusive/i.test(l)) ? "a" : "", labels?.some((l) => /breakfast/i.test(l)) ? "b" : ""].join("");
const expandTags = (tags: string | undefined) => [tags?.includes("a") ? "All inclusive" : "", tags?.includes("b") ? "Breakfast included" : ""].filter(Boolean);

/** Hoteles de la ciudad (cambia poco: caché de 7 días). */
async function listHotels(dest: Destination, geo: string): Promise<ListedHotel[]> {
  const list = await cached<ListedHotel[]>(`xl2:${geo}`, 7 * 86400, async () => {
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
        lat: h.geo?.latitude != null ? Math.round(h.geo.latitude * 1000) / 1000 : null,
        lon: h.geo?.longitude != null ? Math.round(h.geo.longitude * 1000) / 1000 : null,
        ...(compactTags(h.merchandising_labels) && { tags: compactTags(h.merchandising_labels) }),
      }));
  });
  return list ?? [];
}

/**
 * Precio más barato por noche (con impuestos) entre los sitios que comparan.
 * Caché de borde, no KV: son 12 por búsqueda y gastaban la cuota diaria de
 * escrituras. La cotización completa sí va a KV (una sola escritura).
 */
async function bestRate(key: string, checkin: string, checkout: string, room?: RoomOccupancy): Promise<{ nightly: number; site: string } | null> {
  return edgeCached(`xr:${key}-${checkin}-${checkout}${occKey(room)}`, 12 * 3600, async () => {
    const r = await fetchJSON<XoteloResponse<{ rates?: XoteloRate[] }>>(
      `${API}/rates?${ratesParams(key, checkin, checkout, room)}`,
      "xotelo-rates",
      HEADERS,
    );
    return cheapestRate((r && !r.error ? r.result?.rates : null) ?? []);
  });
}

/**
 * Tarifa de un hotel para revisar un viaje guardado: caché de borde de 1 hora
 * (sin KV), un solo subpedido.
 */
export async function hotelRate(key: string, checkin: string, checkout: string, room?: RoomOccupancy): Promise<{ nightly: number; site: string } | null> {
  return edgeCached(`xr1h:${key}-${checkin}-${checkout}${occKey(room)}`, 3600, async () => {
    const r = await fetchJSON<XoteloResponse<{ rates?: XoteloRate[] }>>(
      `${API}/rates?${ratesParams(key, checkin, checkout, room)}`,
      "xotelo-rates",
      HEADERS,
    );
    return cheapestRate((r && !r.error ? r.result?.rates : null) ?? []);
  });
}

/**
 * Parámetros de /rates. Xotelo cotiza por defecto para 1 adulto: pasamos la
 * ocupación de una habitación (adultos y edades de los chicos) para que el
 * precio sea el de esa habitación con esa gente (una triple cuesta más).
 * Sin ocupación (viajes guardados antes del cambio) queda como estaba.
 */
function ratesParams(key: string, checkin: string, checkout: string, room?: RoomOccupancy): URLSearchParams {
  const p = new URLSearchParams({ hotel_key: key, chk_in: checkin, chk_out: checkout, currency: "USD" });
  if (room) {
    p.set("rooms", "1");
    p.set("adults", String(Math.max(1, room.adults)));
    // Xotelo: bebés de 0 a 1 van como 0.
    if (room.childAges.length) p.set("age_of_children", room.childAges.map((a) => (a < 2 ? 0 : a)).join(","));
  }
  return p;
}

const occKey = (room?: RoomOccupancy) => (room ? `-o${room.adults}${room.childAges.length ? `k${room.childAges.join(".")}` : ""}` : "");

function cheapestRate(rates: XoteloRate[]): { nightly: number; site: string } | null {
  let best: { nightly: number; site: string } | null = null;
  for (const x of rates) {
    if (!x.rate || x.rate <= 0) continue;
    const nightly = Math.round(x.rate + (x.tax ?? 0));
    if (!best || nightly < best.nightly) best = { nightly, site: x.name ?? x.code ?? "" };
  }
  return best;
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

/** Opciones de la cotización: ocupación por habitación y qué hoteles preferir en la muestra. */
export interface XoteloOptions {
  room?: RoomOccupancy;
  /** all = sumar a la muestra resorts con all inclusive; breakfast = con desayuno; beach = con playa en el nombre. */
  prefer?: "all" | "breakfast" | "beach" | null;
}

export async function xoteloHotels(dest: Destination, checkin: string, nights: number, opts: XoteloOptions = {}): Promise<HotelQuote | null> {
  if (!TA_GEO[dest.id]) return null;
  const pref = opts.prefer ? `-${opts.prefer}` : "";
  return cached<HotelQuote>(`xq2:${dest.id}-${checkin}-${nights}${occKey(opts.room)}${pref}`, 12 * 3600, () => xoteloQuote(dest, checkin, nights, opts));
}

const toReal = (h: ListedHotel, rate: { nightly: number; site: string }, nights: number): RealHotel => ({
  name: h.name,
  key: h.key,
  nightlyUSD: rate.nightly,
  totalUSD: rate.nightly * nights,
  rating: h.rating,
  reviews: h.reviews,
  stars: null,
  type: h.type,
  thumbnail: h.image,
  link: h.url,
  site: rate.site || null,
  tripadvisorUrl: h.url,
  lat: h.lat ?? null,
  lon: h.lon ?? null,
  ...xoteloBadges(expandTags(h.tags), h.type, h.name),
});

/** Muestra de 12 hoteles: si se pide un régimen o playa, primero los que lo tienen (repartidos por precio). */
export function sample(list: ListedHotel[], prefer: XoteloOptions["prefer"], n = 12): ListedHotel[] {
  if (!prefer) return spread(list, n);
  const match = (h: ListedHotel) =>
    prefer === "all"
      ? Boolean(h.tags?.includes("a") || (h.type && /all[\s-]?inclusive/i.test(h.type)))
      : prefer === "breakfast"
        ? Boolean(h.tags?.includes("b") || h.tags?.includes("a"))
        : xoteloBadges([], null, h.name).beach !== null;
  const good = spread(list.filter(match), Math.ceil((n * 2) / 3));
  const rest = spread(list.filter((h) => !good.includes(h)), n - good.length);
  return [...good, ...rest];
}

async function xoteloQuote(dest: Destination, checkin: string, nights: number, opts: XoteloOptions): Promise<HotelQuote | null> {
  const geo = TA_GEO[dest.id];
  const checkout = addDays(checkin, nights);
  const listed = sample(await listHotels(dest, geo), opts.prefer ?? null);
  if (!listed.length) return null;

  const priced = await Promise.all(listed.map(async (h) => ({ h, rate: await bestRate(h.key, checkin, checkout, opts.room).catch(() => null) })));
  const hotels: RealHotel[] = priced
    .filter((p) => p.rate)
    .map(({ h, rate }) => toReal(h, rate!, nights))
    .sort((a, b) => a.nightlyUSD - b.nightlyUSD);
  if (hotels.length < 3) return null;

  const prices = hotels.map((h) => h.nightlyUSD);
  const tiers: Record<Style, number> = { low: percentile(prices, 0.15), mid: percentile(prices, 0.5), high: percentile(prices, 0.85) };
  return { checkin, checkout, hotels, tiers, source: "xotelo" };
}

/**
 * Buscar un hotel por nombre dentro de la lista de la ciudad (sin cuota: la
 * lista ya está en caché y el /search de Xotelo es pago). Cotiza hasta 3 que
 * coincidan, con la ocupación del grupo.
 */
export async function xoteloHotelByName(dest: Destination, name: string, checkin: string, nights: number, room?: RoomOccupancy): Promise<RealHotel[]> {
  const geo = TA_GEO[dest.id];
  if (!geo) return [];
  const checkout = addDays(checkin, nights);
  const found = (await listHotels(dest, geo)).filter((h) => nameMatches(name, h.name)).slice(0, 3);
  const priced = await Promise.all(found.map(async (h) => ({ h, rate: await bestRate(h.key, checkin, checkout, room).catch(() => null) })));
  // Sin precio para esas fechas no se muestra: no inventamos un monto.
  return priced.filter((p) => p.rate).map(({ h, rate }) => toReal(h, rate!, nights));
}
