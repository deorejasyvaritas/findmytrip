import type {
  CostBreakdown,
  Destination,
  ExploreRequest,
  ExtraDestination,
  ExploreResponse,
  FlightCalendar,
  FlightDay,
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
import { bagsCost, dailyUnits, fareUnits, headcount, roomsForParty } from "../shared/pricing.ts";
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

export const roomsFor = (travelers: number) => Math.max(1, Math.ceil(travelers / 2));

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
): CostBreakdown {
  const party = toParty(who);
  const flightPP = flightOverride ?? flightEstimate(originCode, dest, month);
  const flights = Math.round(flightPP * fareUnits(party));
  const bags = bagsCost(party, dest.region);
  // Google da el precio de entrada; para otros estilos escalamos con la relación del catálogo.
  const nightly = hotelNightOverride
    ? Math.round(hotelNightOverride * (dest.lodgingUSD[style] / dest.lodgingUSD.low))
    : lodgingNightly(dest, style, month);
  const lodging = nightly * nights * roomsForParty(party);
  const daily = Math.round(dest.dailyUSD[style] * (nights + 1) * dailyUnits(party));
  const total = Math.round(flights + bags + lodging + (includeDaily ? daily : 0));
  return { flights, bags, lodging, daily, dailyIncluded: includeDaily, total, perPerson: Math.round(total / headcount(party)) };
}

/** Meses a considerar y fechas límite según lo que eligió el usuario. */
export function resolveWhen(
  req: { when?: When; month?: number | null; year?: number; nights: number },
  today = new Date(),
): { months: { month: number; year: number }[]; from?: string; to?: string; nights: number } {
  const when: When =
    req.when ?? (req.month ? { kind: "months", months: [{ month: req.month, year: req.year ?? yearFor(req.month, today) }] } : { kind: "flexible" });
  const nights = Math.max(1, req.nights);
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

  const candidates = DESTINATIONS.filter(
    (d) =>
      !exclude.has(d.id) &&
      !isSameCity(req.origin, d) &&
      (!req.regions?.length || req.regions.includes(d.region)) &&
      (req.maxFlightHours == null || d.flightHours <= req.maxFlightHours),
  );

  const scored: Suggestion[] = [];
  for (const dest of candidates) {
    let best: Suggestion | null = null;
    // Si hay precios reales para este destino, solo consideramos esos meses.
    const realKnown = real?.forDest(dest) ?? [];
    const google = realKnown.filter((p) => p.source === "google");
    // Con ventana o fechas exactas, solo sirven precios reales dentro del rango.
    const inRange = (p: RealPrice) =>
      !window.from || !p.depart || (p.depart >= window.from && p.depart <= (window.to ?? window.from));
    const googleInRange = google.filter(inRange);
    // "Solo directos": descartamos lo que Google sabe que tiene escalas. Si
    // Google solo ve vuelos con escalas a ese destino, el destino no va.
    const googleOk = req.directOnly ? googleInRange.filter((p) => (p.stops ?? 0) === 0) : googleInRange;
    if (googleInRange.length && !googleOk.length) continue;
    const realList = googleOk.length ? googleOk : realKnown.filter((p) => p.source !== "google");
    const options = realList.length
      ? realList.flatMap((p) => {
          const m = months.find((x) => x.month === p.month);
          return m ? [{ ...m, live: p }] : [];
        })
      : months.map((m) => ({ ...m, live: undefined as RealPrice | undefined }));
    for (const { month, year, live } of options) {
      // Tope de vuelo por persona (precio real si lo hay; si no, el estimado).
      if (req.maxFlightPP && (live?.flightPP ?? flightEstimate(req.origin, dest, month)) > req.maxFlightPP) continue;
      const direct = live?.stops === 0;
      const cost = tripCost(req.origin, dest, month, nights, party, req.style, live?.flightPP, live?.hotelNight, req.includeDaily);
      const ratio = cost.total / budget;
      if (ratio > 1.15) continue;

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
        const left = budget - cost.total;
        if (ratio < 0.7) reasons.push(`Te sobran ~USD ${left.toLocaleString("es-AR")} del presupuesto`);
      } else {
        score += 5;
        reasons.push(`Se pasa ~${Math.round((ratio - 1) * 100)}%: bajando el estilo o las noches entra`);
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
      if (travelDays > nights * 0.2) {
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
        lodgingSource: live?.hotelNight ? "google" : "estimado",
        depart: live?.depart ?? (req.when?.kind === "exact" ? req.when.depart : undefined),
        ret: live?.ret ?? (req.when?.kind === "exact" ? req.when.ret : undefined),
        airline: live?.airline,
        link: live?.link,
        ...(direct && { direct }),
      };
      if (!best || s.score > best.score || (s.score === best.score && s.cost.total < best.cost.total)) {
        best = s;
      }
    }
    if (best) scored.push(best);
  }

  scored.sort((a, b) => b.score - a.score || a.cost.total - b.cost.total);
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
  travelers: number,
  style: Style,
  today = new Date(),
): MonthPrice[] {
  const rows = upcomingMonths(today).map(({ month, year }) => {
    const cost = tripCost(originCode, dest, month, nights, travelers, style);
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
  travelers: number,
  /** Precio real por noche por estilo (Google Hotels), si se consultó. */
  realTiers?: Record<Style, number>,
): StayOption[] {
  const month = Number(checkin.slice(5, 7));
  const checkout = addDays(checkin, nights);
  const rooms = roomsFor(travelers);
  return (["low", "mid", "high"] as Style[]).map((tier, i) => {
    const nightlyUSD = realTiers?.[tier] ?? lodgingNightly(dest, tier, month);
    const area = dest.areas[i % dest.areas.length];
    return {
      tier,
      label: STAY_LABELS[tier].label,
      description: STAY_LABELS[tier].description,
      nightlyUSD,
      totalUSD: nightlyUSD * nights * rooms,
      rooms,
      area,
      links: stayLinks(`${area}, ${dest.name}`, checkin, checkout, travelers, rooms),
      source: realTiers ? "en vivo" : "estimado",
    };
  });
}

export { flightLinks };
