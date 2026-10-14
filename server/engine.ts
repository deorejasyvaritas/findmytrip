import type {
  CostBreakdown,
  Destination,
  ExploreRequest,
  ExtraDestination,
  ExploreResponse,
  FlightCalendar,
  FlightDay,
  MealPlan,
  MonthPrice,
  Party,
  RealPrice,
  StayOption,
  Style,
  Suggestion,
  When,
} from "../shared/types.ts";
import { flightLinks, stayLinks } from "../shared/links.ts";
import { DESTINATIONS, ORIGINS, getOrigin } from "./data/destinations.ts";
import { bagsCost, dailyUnits, fareUnits, headcount, occupancyFactor, roomsForParty } from "../shared/pricing.ts";
import { allInclusiveFor, allInclusiveUnits, boardPerPersonNight, dailyFactor, MEAL_PLAN_LABEL } from "../shared/meal-plan.ts";
import { longWeekends, type LongWeekend } from "./holidays.ts";
import { countryCodeOf } from "../shared/countries.ts";
export { headcount };

// ---------------------------------------------------------------------------
// Utilidades de fechas (todo en UTC para evitar corrimientos por huso horario)
// ---------------------------------------------------------------------------

export const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Año del próximo `month` (1-12) a partir de hoy. */
export function yearFor(month: number, today = new Date()): number {
  const current = today.getUTCMonth() + 1;
  return month < current ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
}

/** Los próximos 12 meses empezando por el que viene (o el actual si quedan días). */
export function upcomingMonths(today = new Date()): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = [];
  const start = today.getUTCDate() > 20 ? 1 : 0;
  for (let i = start; i < start + 12; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
    out.push({ month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estimaciones de precios
// ---------------------------------------------------------------------------

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Hash determinístico 0..1 para que las estimaciones no "salten" entre recargas. */
function noise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Vuelo ida y vuelta por persona, temporada media, desde `originCode`. */
export function baseFlightFrom(originCode: string, dest: Destination): number {
  const origin = getOrigin(originCode);
  const bue = ORIGINS[0];
  const ratio = distanceKm(origin, dest) / Math.max(distanceKm(bue, dest), 300);
  let price = dest.baseFlightUSD * Math.min(Math.max(Math.pow(ratio, 0.7), 0.45), 1.6);
  // Desde el interior, los vuelos internacionales suelen conectar en Buenos Aires.
  if (origin.code !== "BUE" && dest.region !== "Argentina") price += 70;
  return Math.round(price);
}

export function isSameCity(originCode: string, dest: Destination): boolean {
  return dest.iata === originCode || (originCode === "BRC" && dest.id === "bariloche");
}

export function flightEstimate(originCode: string, dest: Destination, month: number): number {
  return Math.round(baseFlightFrom(originCode, dest) * dest.season[month - 1]);
}

/** Estimación diaria con efecto de día de semana y anticipación. */
export function flightEstimateForDate(originCode: string, dest: Destination, iso: string, today = new Date()): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.getUTCMonth() + 1;
  const weekday = d.getUTCDay(); // 0 domingo
  const weekdayFactor = [1.08, 0.97, 0.92, 0.93, 1.02, 1.1, 1.0][weekday];
  const daysAhead = (d.getTime() - today.getTime()) / 86400000;
  const leadFactor = daysAhead < 14 ? 1.3 : daysAhead < 30 ? 1.12 : daysAhead > 240 ? 1.05 : 1;
  const jitter = 0.9 + noise(`${originCode}-${dest.id}-${iso}`) * 0.2;
  return Math.round(baseFlightFrom(originCode, dest) * dest.season[month - 1] * weekdayFactor * leadFactor * jitter);
}


export function lodgingNightly(dest: Destination, style: Style, month: number): number {
  // El alojamiento varía menos con la temporada que los vuelos.
  return Math.round(dest.lodgingUSD[style] * Math.sqrt(dest.season[month - 1]));
}

/** Acepta un número de adultos (compatibilidad) o el detalle del grupo. */
export const toParty = (p: Party | number): Party =>
  typeof p === "number" ? { adults: Math.max(1, p), childAges: [], bags: "cabin" } : p;

export function tripCost(
  originCode: string,
  dest: Destination,
  month: number,
  nights: number,
  who: Party | number,
  style: Style,
  flightOverride?: number,
  /** Precio real por noche del hotel más accesible (Google). */
  hotelNightOverride?: number,
  /** Comidas y paseos son una estimación: por defecto van aparte del total. */
  includeDaily = false,
  /** Régimen (shared/meal-plan.ts). All inclusive donde no hay = solo alojamiento. */
  mealPlan: MealPlan = "room",
): CostBreakdown {
  const party = toParty(who);
  const flightPP = flightOverride ?? flightEstimate(originCode, dest, month);
  const flights = Math.round(flightPP * fareUnits(party));
  const bags = bagsCost(party, dest.region);
  const lodgingPart = lodgingCost(dest, style, month, nights, party, mealPlan, hotelNightOverride);
  const plan = lodgingPart.mealPlan;
  const daily = Math.round(dest.dailyUSD[style] * (nights + 1) * dailyUnits(party) * dailyFactor(plan));
  const lodging = lodgingPart.total;
  const total = Math.round(flights + bags + lodging + (includeDaily ? daily : 0));
  return {
    flights,
    bags,
    lodging,
    daily,
    dailyIncluded: includeDaily,
    total,
    perPerson: Math.round(total / headcount(party)),
    ...(plan !== "room" && { mealPlan: plan }),
  };
}

/**
 * Alojamiento de toda la estadía según el régimen. All inclusive: tarifa por
 * persona del destino (estimado; el precio real de un hotel puede ser solo
 * alojamiento). Desayuno y media pensión: la habitación más las comidas que se
 * pagan en el hotel. Habitaciones triples: recargo estimado por ocupación.
 */
export function lodgingCost(
  dest: Destination,
  style: Style,
  month: number,
  nights: number,
  who: Party | number,
  mealPlan: MealPlan = "room",
  /** Precio real por noche del hotel más accesible (Google): se ignora con all inclusive. */
  hotelNightOverride?: number,
): { total: number; nightly: number; mealPlan: MealPlan; estimate: boolean } {
  const party = toParty(who);
  const ai = mealPlan === "all" ? allInclusiveFor(dest) : null;
  if (ai) {
    const perNight = Math.round(ai.perPersonNight[style] * Math.sqrt(dest.season[month - 1]) * allInclusiveUnits(party));
    return { total: perNight * nights, nightly: perNight, mealPlan: "all", estimate: true };
  }
  const plan: MealPlan = mealPlan === "all" ? "room" : mealPlan;
  // Google da el precio de entrada; para otros estilos escalamos con la relación del catálogo.
  const room = hotelNightOverride
    ? Math.round(hotelNightOverride * (dest.lodgingUSD[style] / dest.lodgingUSD.low))
    : lodgingNightly(dest, style, month);
  const board = boardPerPersonNight(dest, style, plan) * dailyUnits(party);
  const perNight = Math.round(room * roomsForParty(party) * occupancyFactor(party) + board);
  return { total: perNight * nights, nightly: perNight, mealPlan: plan, estimate: !hotelNightOverride || board > 0 };
}

/** Texto para el alojamiento estimado ("Estimado all inclusive"). */
export const lodgingEstimateLabel = (plan: MealPlan | undefined) =>
  plan === "all" ? "Estimado all inclusive" : plan && plan !== "room" ? `Estimado, ${MEAL_PLAN_LABEL[plan].toLowerCase()}` : "Estimado";

/** Meses a considerar y fechas límite según lo que eligió el usuario. */
export function resolveWhen(
  req: { when?: When; month?: number | null; year?: number; nights: number; longWeekendsOnly?: boolean },
  today = new Date(),
): { months: { month: number; year: number }[]; from?: string; to?: string; nights: number; weekends?: LongWeekend[] } {
  const when: When =
    req.when ?? (req.month ? { kind: "months", months: [{ month: req.month, year: req.year ?? yearFor(req.month, today) }] } : { kind: "flexible" });
  const plain = resolvePlain(when, Math.max(1, req.nights), today);
  if (!req.longWeekendsOnly || when.kind === "exact") return plain;

  // "Fines de semana largos": los próximos 4 que caen dentro de lo elegido
  // (meses o ventana). Se sale la noche anterior o durante el finde.
  const fits = (w: LongWeekend) =>
    plain.from
      ? w.to >= plain.from && addDays(w.from, -1) <= (plain.to ?? plain.from)
      : when.kind === "months"
        ? plain.months.some((m) => [addDays(w.from, -1), w.to].some((d) => Number(d.slice(5, 7)) === m.month && Number(d.slice(0, 4)) === m.year))
        : true;
  const weekends = longWeekends(toISO(today), 8, 300).filter(fits).slice(0, LONG_WEEKENDS);
  const months: { month: number; year: number }[] = [];
  for (const w of weekends) {
    for (const d of [addDays(w.from, -1), addDays(w.to, -1)]) {
      const m = { month: Number(d.slice(5, 7)), year: Number(d.slice(0, 4)) };
      if (!months.some((x) => x.month === m.month && x.year === m.year)) months.push(m);
    }
  }
  const longest = Math.max(1, ...weekends.map((w) => w.days));
  return { months, nights: Math.min(plain.nights, longest), weekends };
}

function resolvePlain(
  when: When,
  nights: number,
  today: Date,
): { months: { month: number; year: number }[]; from?: string; to?: string; nights: number } {
  if (when.kind === "months" && when.months.length) return { months: when.months, nights };
  if (when.kind === "window" || when.kind === "exact") {
    const from = when.kind === "window" ? when.from : when.depart;
    const to = when.kind === "window" ? when.to : when.depart;
    const n = when.kind === "exact" ? Math.max(1, Math.round((Date.parse(when.ret) - Date.parse(when.depart)) / 86400000)) : nights;
    const months: { month: number; year: number }[] = [];
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    while (toISO(d).slice(0, 7) <= to.slice(0, 7) && months.length < 12) {
      months.push({ month: d.getUTCMonth() + 1, year: d.getUTCFullYear() });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return { months, from, to, nights: n };
  }
  return { months: upcomingMonths(today), nights };
}

// ---------------------------------------------------------------------------
// Fines de semana largos
// ---------------------------------------------------------------------------

/** Cuántos fines de semana largos se consideran. */
export const LONG_WEEKENDS = 4;
/** Escapada corta: destinos a no más de estas horas de vuelo (como en escapes.ts). */
export const LONG_WEEKEND_MAX_HOURS = 6;
/** Los fines largos se llenan: la estimación sin precio real sube ~10 %. */
const HOLIDAY_DEMAND = 1.1;

interface TripOption {
  month: number;
  year: number;
  nights: number;
  live?: RealPrice;
  /** Vuelo por persona estimado para esta opción (si no hay precio real). */
  flightPP?: number;
  depart?: string;
  ret?: string;
  weekend?: LongWeekend;
}

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

/**
 * La mejor salida para un fin de semana largo: el precio real más barato que
 * sale entre el día anterior y el anteúltimo día libre (y vuelve a tiempo);
 * si no hay, una estimación volviendo el último día.
 */
export function weekendOption(
  originCode: string,
  dest: Destination,
  w: LongWeekend,
  real: RealPrice[],
  wantedNights: number,
  directOnly = false,
  today = new Date(),
): TripOption {
  const first = addDays(w.from, -1);
  const lastDepart = addDays(w.to, -1);
  const fits = real.filter(
    (p) =>
      p.depart &&
      p.depart >= first &&
      p.depart <= lastDepart &&
      (!p.ret || p.ret <= w.to) &&
      (!directOnly || p.source !== "google" || (p.stops ?? 0) === 0),
  );
  const best = fits.reduce<RealPrice | null>((a, b) => (!a || b.flightPP < a.flightPP ? b : a), null);
  if (best?.depart) {
    const nights = best.ret ? nightsBetween(best.depart, best.ret) : Math.max(1, Math.min(wantedNights, w.days));
    return {
      month: Number(best.depart.slice(5, 7)),
      year: Number(best.depart.slice(0, 4)),
      nights,
      live: best,
      depart: best.depart,
      ret: best.ret ?? addDays(best.depart, nights),
      weekend: w,
    };
  }
  const nights = Math.max(1, Math.min(wantedNights, w.days));
  const depart = addDays(w.to, -nights);
  return {
    month: Number(depart.slice(5, 7)),
    year: Number(depart.slice(0, 4)),
    nights,
    flightPP: Math.round(flightEstimateForDate(originCode, dest, depart, today) * HOLIDAY_DEMAND),
    depart,
    ret: w.to,
    weekend: w,
  };
}

// ---------------------------------------------------------------------------
// Explorador: "¿a dónde me alcanza?"
// ---------------------------------------------------------------------------

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
export const monthName = (m: number) => MONTHS[m - 1];

export function explore(
  req: ExploreRequest,
  /** Precios reales conocidos por destino (Google / Aviasales). */
  real?: { forDest: (dest: Destination) => RealPrice[]; extra?: ExtraDestination[] },
  today = new Date(),
): ExploreResponse {
  const party = req.party ?? toParty(req.travelers);
  const window = resolveWhen(req, today);
  const nights = window.nights;
  const budget = Math.max(1, req.budgetUSD);
  const exclude = new Set(req.exclude ?? []);
  const known = new Set(req.known ?? []);
  const knownRegions = new Set(
    DESTINATIONS.filter((d) => known.has(d.id)).map((d) => d.region),
  );
  const months = window.months;
  // Búsqueda por país ("Ya sé a dónde" > Brasil): van todos los destinos del
  // país, también los que se pasan del presupuesto (la app marca cuánto).
  const countries = req.countries?.length ? new Set(req.countries.map((c) => c.toUpperCase())) : null;

  const candidates = DESTINATIONS.filter(
    (d) =>
      !exclude.has(d.id) &&
      !isSameCity(req.origin, d) &&
      (!req.regions?.length || req.regions.includes(d.region)) &&
      (!countries || countries.has(countryCodeOf(d.country) ?? "")) &&
      (req.maxFlightHours == null || d.flightHours <= req.maxFlightHours) &&
      // All inclusive: solo destinos donde se consigue.
      (req.mealPlan !== "all" || allInclusiveFor(d) !== null),
  );

  const scored: Suggestion[] = [];
  for (const dest of candidates) {
    let best: Suggestion | null = null;
    // En Argentina se paga en pesos al oficial: el presupuesto en pesos rinde más.
    const destBudget = dest.region === "Argentina" && req.domesticBudgetUSD ? Math.max(1, req.domesticBudgetUSD) : budget;
    // Si hay precios reales para este destino, solo consideramos esos meses.
    const realKnown = real?.forDest(dest) ?? [];
    const google = realKnown.filter((p) => p.source === "google");
    // Con ventana o fechas exactas, solo sirven precios reales con fecha dentro
    // del rango: los mínimos mensuales de Aviasales (sin fecha, de cualquier
    // estadía) no son el precio de esas fechas, así que ahí se estima.
    const inRange = (p: RealPrice) =>
      !window.from || (Boolean(p.depart) && p.depart! >= window.from && p.depart! <= (window.to ?? window.from));
    // Un precio real con fechas solo sirve si la estadía se parece a la pedida
    // (±2 noches): un viaje de 6 noches no es el precio de uno de 10.
    const lengthOk = (p: RealPrice) => !(p.depart && p.ret) || Math.abs(nightsBetween(p.depart, p.ret) - nights) <= 2;
    const googleInRange = google.filter((p) => inRange(p) && lengthOk(p));
    // "Solo directos": descartamos lo que Google sabe que tiene escalas. Si
    // Google solo ve vuelos con escalas a ese destino, el destino no va.
    const googleOk = req.directOnly ? googleInRange.filter((p) => (p.stops ?? 0) === 0) : googleInRange;
    if (googleInRange.length && !googleOk.length) continue;
    const realList = googleOk.length ? googleOk : realKnown.filter((p) => p.source !== "google" && inRange(p) && lengthOk(p));
    let options: TripOption[];
    if (window.weekends) {
      if (dest.flightHours > LONG_WEEKEND_MAX_HOURS) continue;
      options = window.weekends.map((w) => weekendOption(req.origin, dest, w, realKnown, req.nights, req.directOnly, today));
    } else {
      options = realList.length
        ? realList.flatMap((p) => {
            const m = months.find((x) => x.month === p.month);
            // Si el precio real trae fechas, las noches son las de esas fechas.
            const n = p.depart && p.ret ? nightsBetween(p.depart, p.ret) : nights;
            return m ? [{ ...m, nights: n, live: p }] : [];
          })
        : months.map((m) => ({ ...m, nights }));
    }
    for (const opt of options) {
      const { month, year, live } = opt;
      // Tope de vuelo por persona (precio real si lo hay; si no, el estimado).
      if (req.maxFlightPP && (live?.flightPP ?? opt.flightPP ?? flightEstimate(req.origin, dest, month)) > req.maxFlightPP) continue;
      const direct = live?.stops === 0;
      const cost = tripCost(
        req.origin,
        dest,
        month,
        opt.nights,
        party,
        req.style,
        live?.flightPP ?? opt.flightPP,
        live?.hotelNight,
        req.includeDaily,
        req.mealPlan,
      );
      const ratio = cost.total / destBudget;
      if (ratio > 1.15 && !countries) continue;

      const reasons: string[] = [];
      let score = 0;

      const matches = req.interests.filter((i) => dest.tags.includes(i));
      if (req.interests.length) {
        score += Math.min(40, (matches.length / Math.min(req.interests.length, 3)) * 40);
        if (matches.length) reasons.push(`Tiene lo que buscás: ${matches.join(", ")}`);
      } else {
        score += 20;
      }

      if (ratio <= 1) {
        score += 30 - Math.abs(0.8 - ratio) * 20;
        const left = destBudget - cost.total;
        if (ratio < 0.7 && !countries) reasons.push(`Te sobran ~USD ${left.toLocaleString("es-AR")} del presupuesto`);
      } else {
        score += 5;
        if (!countries) reasons.push(`Se pasa ~${Math.round((ratio - 1) * 100)}%: bajando el estilo o las noches entra`);
      }

      if (cost.mealPlan === "all") {
        reasons.push(
          allInclusiveFor(dest)?.availability === "común"
            ? "Muchos resorts all inclusive: comidas y bebidas incluidas (precio estimado)"
            : "Hay resorts all inclusive: comidas y bebidas incluidas (precio estimado)",
        );
      }
      if (dest.bestMonths.includes(month)) {
        score += 15;
        reasons.push(`${capitalize(monthName(month))} es buena época para ir`);
      }
      if (dest.season[month - 1] <= 0.9) {
        score += 5;
        reasons.push("Temporada baja: precios más bajos y menos gente");
      }

      // Destinos muy lejanos no rinden en viajes cortos.
      const travelDays = (dest.flightHours * 2) / 24;
      if (travelDays > opt.nights * 0.2) {
        score -= 15;
      }
      if (dest.hiddenGem) score += 5;
      if (live) score += 10; // preferimos lo que tiene precio real comprobado
      if (req.directOnly && direct) score += 10; // y si pidió directos, lo comprobado primero

      const fit: Suggestion["fit"] = ratio <= 0.85 ? "dentro" : ratio <= 1 ? "ajustado" : "estirando";
      const isAlternative =
        !known.has(dest.id) && (dest.hiddenGem === true || (knownRegions.size > 0 && !knownRegions.has(dest.region)));

      const s: Suggestion = {
        destination: dest,
        month,
        year,
        cost,
        score: Math.round(score),
        fit,
        reasons,
        isAlternative,
        flightSource: live?.source ?? "estimado",
        lodgingSource: live?.hotelNight && cost.mealPlan !== "all" ? "google" : "estimado",
        depart: opt.depart ?? live?.depart ?? (req.when?.kind === "exact" ? req.when.depart : undefined),
        ret: opt.ret ?? live?.ret ?? (req.when?.kind === "exact" ? req.when.ret : undefined),
        airline: live?.airline,
        link: live?.link,
        ...(direct && { direct }),
        ...(opt.weekend && { longWeekend: opt.weekend }),
        ...((opt.weekend || opt.nights !== nights) && { nights: opt.nights }),
      };
      if (!best || s.score > best.score || (s.score === best.score && s.cost.total < best.cost.total)) {
        best = s;
      }
    }
    if (best) scored.push(best);
  }

  scored.sort((a, b) => b.score - a.score || a.cost.total - b.cost.total);
  if (countries) {
    // Por país no hay "alternativas": se muestran todos los destinos del país.
    const extra = (real?.extra ?? [])
      .filter((e) => countries.has(countryCodeOf(e.country) ?? ""))
      .filter((e) => !window.from || (e.depart >= window.from && e.depart <= (window.to ?? window.from)))
      .slice(0, 8);
    return { suggestions: scored, alternatives: [], extra, considered: candidates.length };
  }
  // Las alternativas ("quizás no lo estabas considerando") salen de fuera del
  // top 6 y no se repiten en la lista principal.
  const topIds = new Set(scored.slice(0, 6).map((s) => s.destination.id));
  const alternatives = scored
    .filter((s) => s.isAlternative && !topIds.has(s.destination.id))
    .slice(0, 4);
  const altIds = new Set(alternatives.map((s) => s.destination.id));
  const suggestions = scored.filter((s) => !altIds.has(s.destination.id)).slice(0, 12);

  const extra = (real?.extra ?? [])
    .filter((e) => e.flightPP * fareUnits(party) <= budget)
    .filter((e) => !req.maxFlightPP || e.flightPP <= req.maxFlightPP)
    .filter((e) => !req.directOnly || (e.stops ?? 0) === 0)
    .filter((e) => !window.from || (e.depart >= window.from && e.depart <= (window.to ?? window.from)))
    .slice(0, 8);
  return { suggestions, alternatives, extra, considered: candidates.length };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Detalle de destino: precios por mes, calendario de vuelos y alojamiento
// ---------------------------------------------------------------------------

export function monthOverview(
  originCode: string,
  dest: Destination,
  nights: number,
  who: Party | number,
  style: Style,
  today = new Date(),
  mealPlan: MealPlan = "room",
): MonthPrice[] {
  const party = toParty(who);
  const rows = upcomingMonths(today).map(({ month, year }) => {
    const cost = tripCost(originCode, dest, month, nights, party, style, undefined, undefined, false, mealPlan);
    return {
      month,
      year,
      flightUSD: flightEstimate(originCode, dest, month),
      totalPerPersonUSD: cost.perPerson,
      best: false,
    };
  });
  // Marcamos los 3 meses más convenientes ponderando precio y clima.
  const ranked = [...rows].sort(
    (a, b) =>
      a.totalPerPersonUSD * (dest.bestMonths.includes(a.month) ? 0.85 : 1) -
      b.totalPerPersonUSD * (dest.bestMonths.includes(b.month) ? 0.85 : 1),
  );
  for (const r of ranked.slice(0, 3)) r.best = true;
  return rows;
}

export function estimatedCalendar(
  originCode: string,
  dest: Destination,
  month: string,
  nights: number,
  today = new Date(),
): FlightCalendar {
  const [y, m] = month.split("-").map(Number);
  const todayISO = toISO(today);
  const days: FlightDay[] = [];
  for (let day = 1; day <= daysInMonth(y, m); day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date <= todayISO) continue;
    days.push({
      date,
      returnDate: addDays(date, nights),
      priceUSD: flightEstimateForDate(originCode, dest, date, today),
      source: "estimado",
    });
  }
  const cheapest = days.reduce<FlightDay | null>((acc, d) => (!acc || d.priceUSD < acc.priceUSD ? d : acc), null);
  return { origin: originCode, destination: dest.iata, month, nights, days, cheapest, live: false };
}

const STAY_LABELS: Record<Style, { label: string; description: string }> = {
  low: { label: "Económico", description: "Hostel con privado, B&B o depto sencillo. Lo justo y bien ubicado." },
  mid: { label: "Confort", description: "Hotel 3-4★ o depto completo con buenas reseñas." },
  high: { label: "Premium", description: "Hotel 4-5★ o boutique con servicios y mejores vistas." },
};

export function stayOptions(
  dest: Destination,
  checkin: string,
  nights: number,
  /** Grupo (los chicos comparten habitación) o cantidad de adultos. */
  who: Party | number,
  /** Precio real por noche por estilo (hoteles reales, por habitación), si se consultó. */
  realTiers?: Record<Style, number>,
  /** Régimen: con all inclusive se usa la tarifa estimada por persona (los precios reales pueden ser solo alojamiento). */
  mealPlan: MealPlan = "room",
): StayOption[] {
  const party = toParty(who);
  const month = Number(checkin.slice(5, 7));
  const checkout = addDays(checkin, nights);
  const rooms = roomsForParty(party);
  const ai = mealPlan === "all" && allInclusiveFor(dest) !== null;
  return (["low", "mid", "high"] as Style[]).map((tier, i) => {
    const area = dest.areas[i % dest.areas.length];
    const links = stayLinks(`${area}, ${dest.name}`, checkin, checkout, party, rooms, mealPlan);
    const real = !ai && realTiers ? realTiers[tier] : null;
    if (real) {
      return {
        tier,
        label: STAY_LABELS[tier].label,
        description: STAY_LABELS[tier].description,
        nightlyUSD: real,
        totalUSD: real * nights * rooms,
        rooms,
        area,
        links,
        source: "real",
      };
    }
    const est = lodgingCost(dest, tier, month, nights, party, mealPlan);
    const labels = est.mealPlan === "all" ? AI_LABELS[tier] : STAY_LABELS[tier];
    return {
      tier,
      label: labels.label,
      description: labels.description,
      // Por habitación y noche (para mostrar y para revisar el precio); el total es de todo el grupo.
      nightlyUSD: Math.round(est.total / (nights * rooms)),
      totalUSD: est.total,
      rooms,
      area,
      links,
      source: "estimado",
      ...(est.mealPlan !== "room" && { mealPlan: est.mealPlan }),
    };
  });
}

const AI_LABELS: Record<Style, { label: string; description: string }> = {
  low: { label: "All inclusive 3★", description: "Resort sencillo con comidas y bebidas incluidas. Precio estimado." },
  mid: { label: "All inclusive 4★", description: "Resort 4★ con varios restaurantes, bebidas y actividades incluidas. Precio estimado." },
  high: { label: "All inclusive 5★", description: "Resort 5★ o adults only, restaurantes a la carta. Precio estimado." },
};

export { flightLinks };
