// Búsqueda por país ("Ya sé a dónde" > Brasil): la URL de /buscar?tipo=pais,
// el pedido a /api/explore y cómo se ordenan y marcan los resultados.
// Lógica pura, sin fetch, para usarla en la app y en los tests.

import type { ExploreRequest, Interest, MealPlan, Party, Style, Suggestion } from "./types.ts";
import { DEFAULT_PARTY, headcount, partyFromParams, partyToParams } from "./pricing.ts";
import { addDaysIso, tripDatesFromParams, tripDatesToParams, type TripDates } from "./trip-window.ts";
import { countryByCode, countryCodeOf } from "./countries.ts";
import { MEAL_PLANS } from "./meal-plan.ts";
import { routeStopParam, type CuratedRoute, type RouteStop } from "./routes.ts";
import { priceLabel } from "./price-age.ts";

export type CountrySort = "barato" | "epoca";

export interface CountrySearch {
  /** ISO alfa-2 ("BR"). */
  country: string;
  /** Salida en el formato de los formularios: "BUE|Buenos Aires (BUE)". */
  from: string;
  dates: TripDates;
  nights: number;
  party: Party;
  /** Presupuesto total del grupo en USD (opcional). */
  budget: number | null;
  meal: MealPlan | null;
  interests: Interest[];
  sort: CountrySort;
}

const INTERESTS: Interest[] = ["playa", "montaña", "ciudad", "gastronomía", "aventura", "nieve", "cultura", "naturaleza", "relax", "noche", "compras", "parques"];

export function countrySearchToParams(s: CountrySearch): URLSearchParams {
  const q = new URLSearchParams({
    tipo: "pais",
    pais: s.country,
    from: s.from,
    ...tripDatesToParams(s.dates),
    noches: String(s.nights),
    ...partyToParams(s.party),
  });
  if (s.budget) q.set("presu", String(Math.round(s.budget)));
  if (s.meal && s.meal !== "room") q.set("regimen", s.meal);
  if (s.interests.length) q.set("int", s.interests.join(","));
  if (s.sort !== "barato") q.set("orden", s.sort);
  return q;
}

/** null si falta el país, la salida o la fecha. */
export function countrySearchFromParams(params: URLSearchParams): CountrySearch | null {
  const country = countryByCode(params.get("pais"));
  const from = params.get("from");
  const dates = tripDatesFromParams(params);
  if (!country || !from || !dates.depart) return null;
  const nights = Math.min(30, Math.max(1, Math.round(Number(params.get("noches")) || 7)));
  const budget = Number(params.get("presu"));
  const meal = params.get("regimen") as MealPlan | null;
  return {
    country: country.code,
    from,
    dates,
    nights,
    party: partyFromParams(params, DEFAULT_PARTY),
    budget: Number.isFinite(budget) && budget > 0 ? budget : null,
    meal: meal && MEAL_PLANS.includes(meal) && meal !== "room" ? meal : null,
    interests: (params.get("int") ?? "")
      .split(",")
      .filter((i): i is Interest => (INTERESTS as string[]).includes(i)),
    sort: params.get("orden") === "epoca" ? "epoca" : "barato",
  };
}

/** Sin presupuesto pedimos igual todo el país: un tope que no corta nada. */
const NO_BUDGET = 1_000_000;

/** Pedido a /api/explore para los destinos del país (mismas fechas, grupo y régimen). */
export function countryExploreRequest(s: CountrySearch, style: Style): ExploreRequest {
  const origin = s.from.split("|")[0] || "BUE";
  const w = s.dates.window;
  const depart = s.dates.pinned ?? s.dates.depart;
  const month = Number((w ? w.from : depart).slice(5, 7));
  const year = Number((w ? w.from : depart).slice(0, 4));
  return {
    origin,
    budgetUSD: s.budget ?? NO_BUDGET,
    travelers: headcount(s.party),
    nights: s.nights,
    month,
    year,
    style,
    interests: s.interests,
    party: s.party,
    when: w && !s.dates.pinned ? { kind: "window", from: w.from, to: w.to } : { kind: "exact", depart, ret: addDaysIso(depart, s.nights) },
    ...(s.meal ? { mealPlan: s.meal } : {}),
    countries: [s.country],
  };
}

export interface CountryOption {
  s: Suggestion;
  /** Cuánto se pasa del presupuesto (USD), o null si entra o no hay presupuesto. */
  over: number | null;
  goodSeason: boolean;
}

/**
 * Ordena los destinos del país: primero los que entran en el presupuesto y
 * después los que se pasan (cada grupo, por precio o por época). Con
 * intereses, solo los destinos que tienen alguno.
 */
export function rankCountry(
  list: Suggestion[],
  opts: { sort: CountrySort; budget: number | null; interests: Interest[] },
): { within: CountryOption[]; over: CountryOption[] } {
  const rows: CountryOption[] = list
    .filter((s) => !opts.interests.length || opts.interests.some((i) => s.destination.tags.includes(i)))
    .map((s) => ({
      s,
      over: opts.budget && s.cost.total > opts.budget ? Math.round(s.cost.total - opts.budget) : null,
      goodSeason: s.destination.bestMonths.includes(s.month),
    }));
  const cmp = (a: CountryOption, b: CountryOption) =>
    opts.sort === "epoca"
      ? Number(b.goodSeason) - Number(a.goodSeason) || a.s.cost.total - b.s.cost.total
      : a.s.cost.total - b.s.cost.total;
  return { within: rows.filter((r) => r.over == null).sort(cmp), over: rows.filter((r) => r.over != null).sort(cmp) };
}

/** Etiqueta honesta del precio del vuelo de una tarjeta (shared/price-age.ts). */
export function suggestionFlightLabel(s: Suggestion, requestedDepart: string | null): string {
  if (s.flightSource === "estimado") return priceLabel({ kind: "estimado" });
  if (s.flightSource === "google") return priceLabel({ source: "google" });
  // Aviasales: lo que vio la gente en los últimos días.
  if (!s.depart) return priceLabel({ kind: "mes", source: "aviasales" });
  if (requestedDepart && s.depart !== requestedDepart) return priceLabel({ kind: "cercano", source: "aviasales", priceDate: s.depart });
  return "Visto en los últimos días";
}

/** Rutas armadas que pasan entera o mayormente (la mitad de las paradas o más) por el país. */
export function countryRoutes(code: string, list: CuratedRoute[]): CuratedRoute[] {
  const inCountry = (s: RouteStop) => countryCodeOf(s.country) === code;
  return list
    .filter((r) => r.stops.filter(inCountry).length * 2 >= r.stops.length)
    .sort((a, b) => b.stops.filter(inCountry).length / b.stops.length - a.stops.filter(inCountry).length / a.stops.length);
}

/**
 * Reparte las noches pedidas entre las paradas de la ruta, en proporción a las
 * de la ruta (al menos 1 por parada). Si piden menos noches que paradas, se
 * deja la ruta como está.
 */
export function scaleRouteNights(r: CuratedRoute, total: number): RouteStop[] {
  const base = r.stops.reduce((n, s) => n + s.nights, 0);
  if (total < r.stops.length || total === base) return r.stops;
  const raw = r.stops.map((s) => (s.nights * total) / base);
  const out = raw.map((x) => Math.max(1, Math.floor(x)));
  // Lo que falta, a las paradas con más resto.
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  for (let i = out.length - 1; left < 0 && i >= 0; i--) {
    while (left < 0 && out[i] > 1) (out[i]--, left++);
  }
  return r.stops.map((s, i) => ({ ...s, nights: out[i] }));
}

/** "Ya sé a dónde" con paradas, las mismas fechas, salida y grupo de la búsqueda por país. */
export function tripParamsFor(s: CountrySearch, stops: { name: string; region?: string | null; country: string; lat: number; lon: number; nights: number; destinationId?: string | null }[]): URLSearchParams {
  const q = new URLSearchParams({ tipo: "viaje", from: s.from, ...tripDatesToParams(s.dates), ...partyToParams(s.party) });
  for (const st of stops) q.append("stop", routeStopParam({ name: st.name, region: st.region ?? "", country: st.country, lat: st.lat, lon: st.lon, nights: st.nights, destinationId: st.destinationId ?? undefined }));
  return q;
}
