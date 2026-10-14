// Links de cada hotel en el selector de "Ya sé a dónde": TripAdvisor, sitio
// oficial (o una búsqueda para encontrarlo) y el mapa. Sin servicios pagos.

import type { RealHotel } from "./types.ts";

export interface HotelLinks {
  tripadvisor: string;
  /** Sitio oficial si la fuente lo da; si no, una búsqueda en Google. */
  official: string;
  officialIsSearch: boolean;
  maps: string;
}

const isTripadvisor = (url: string | null | undefined): url is string => Boolean(url && /^https:\/\/(www\.)?tripadvisor\./.test(url));
const isHttp = (url: string | null | undefined): url is string => Boolean(url && /^https?:\/\//.test(url));

export function hotelLinks(h: Pick<RealHotel, "name" | "link" | "tripadvisorUrl" | "officialUrl">, city: string): HotelLinks {
  const where = [h.name, city].filter(Boolean).join(" ");
  const ta = h.tripadvisorUrl ?? (isTripadvisor(h.link) ? h.link : null);
  const tripadvisor = isTripadvisor(ta) ? ta : `https://www.tripadvisor.com/Search?${new URLSearchParams({ q: where })}`;
  const officialUrl = isHttp(h.officialUrl) && !isTripadvisor(h.officialUrl) ? h.officialUrl : null;
  const official = officialUrl ?? `https://www.google.com/search?${new URLSearchParams({ q: `${where} sitio oficial` })}`;
  // Con nombre y ciudad, Google Maps abre la ficha del hotel (no solo un pin).
  const maps = `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: where })}`;
  return { tripadvisor, official, officialIsSearch: !officialUrl, maps };
}

/** Distancia en km (aprox.) entre el hotel y la parada; null si no hay coordenadas. */
export function hotelDistanceKm(h: Pick<RealHotel, "lat" | "lon">, lat: number, lon: number): number | null {
  if (h.lat == null || h.lon == null) return null;
  const rad = Math.PI / 180;
  const a = Math.sin(((h.lat - lat) * rad) / 2) ** 2 + Math.cos(lat * rad) * Math.cos(h.lat * rad) * Math.sin(((h.lon - lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
