// Precio "desde" de las rutas armadas. Solo con datos que ya tenemos gratis:
// el vuelo ida y vuelta más barato del mes que vieron usuarios de Aviasales
// (cheapestAnywhere: una llamada por origen y mes, cacheada en KV y compartida
// con "Ya sé a dónde") más el alojamiento promedio del catálogo y el estimado
// de micro o tren entre paradas. Nunca llama a Google.

import { ROUTES, haversineKm, routeHops, type CuratedRoute, type RouteQuote, type RoutesResponse } from "../shared/routes.ts";
import { groundEstimate } from "../shared/ground.ts";
import { edgeCached } from "./cache.ts";
import { getDestination } from "./data/destinations.ts";
import { lodgingNightly } from "./engine.ts";
import { cheapestAnywhere } from "./providers/flights.ts";

/** Si la primera y la última parada están más lejos que esto, el viaje vuelve desde otro aeropuerto. */
const OPEN_JAW_KM = 150;

/** Cotización de una ruta con los precios del mes (`fares`: ciudad IATA → USD ida y vuelta). */
export function quoteRoute(r: CuratedRoute, origin: string, month: string, fares: Map<string, number>): RouteQuote {
  const code = r.flyTo.codes.find((c) => c !== origin && (fares.get(c) ?? 0) > 0) ?? null;
  const monthNum = Number(month.slice(5, 7)) || 1;
  let lodging: number | null = 0;
  for (const s of r.stops) {
    const dest = getDestination(s.lodgingFrom ?? s.destinationId ?? "");
    if (!dest) {
      lodging = null;
      break;
    }
    // Habitación doble compartida: la mitad por persona.
    lodging += (lodgingNightly(dest, "mid", monthNum) / 2) * s.nights;
  }
  const hops = routeHops(r);
  const ground = hops
    .map((h, i) => (h.kind === "ground" ? groundEstimate(h.km, r.stops[i].country, r.stops[i + 1].country, h.from, h.to).perPerson : 0))
    .reduce((a, b) => a + b, 0);
  const first = r.stops[0];
  const last = r.stops[r.stops.length - 1];
  return {
    flightUSD: code ? fares.get(code)! : null,
    flightTo: code ? r.flyTo.name : null,
    lodgingUSD: lodging == null ? null : Math.round(lodging),
    groundUSD: Math.round(ground),
    internalFlights: hops.filter((h) => h.kind === "flight").length,
    openJaw: haversineKm(first.lat, first.lon, last.lat, last.lon) > OPEN_JAW_KM,
  };
}

/** Meses con precio: del actual a 11 meses adelante (más allá Aviasales casi no tiene datos). */
export function monthInRange(month: string, now = new Date()): boolean {
  const [y, m] = month.split("-").map(Number);
  const diff = (y - now.getUTCFullYear()) * 12 + (m - 1 - now.getUTCMonth());
  return diff >= 0 && diff <= 11;
}

export async function routeQuotes(token: string | undefined, origin: string, month: string): Promise<RoutesResponse> {
  const build = (fares: Map<string, number>): RoutesResponse => ({
    origin,
    month,
    quotes: Object.fromEntries(ROUTES.map((r) => [r.id, quoteRoute(r, origin, month, fares)])),
  });
  if (!token || !monthInRange(month)) return build(new Map());
  // Resultado armado en memoria / caché de borde (no gasta escrituras de KV);
  // los precios de base ya quedan en KV por cheapestAnywhere (tpc:origen-mes).
  const res = await edgeCached<RoutesResponse>(`rts1:${origin}-${month}`, 3 * 3600, async () => {
    const fares = await cheapestAnywhere(token, origin, month).catch(() => new Map<string, number>());
    // Sin datos (Travelpayouts no respondió): no lo guardamos para reintentar.
    return fares.size ? build(fares) : null;
  });
  return res ?? build(new Map());
}
