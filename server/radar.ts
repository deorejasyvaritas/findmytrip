import { likeForLikeBaseline, withRadarScore, type BaselineObs } from "../shared/radar-score.ts";
import type { Destination, RadarItem, RadarMonth, RadarSnapshot } from "../shared/types.ts";
import { fetchJSON, loadJSON, trySaveJSON } from "./cache.ts";
import { DESTINATIONS } from "./data/destinations.ts";
import { flightEstimate, isSameCity, upcomingMonths } from "./engine.ts";
import { airportsFor } from "./providers/flights.ts";

// Radar de ofertas: varias veces por día revisa los precios reales
// (Travelpayouts) desde tu ciudad hacia todo el catálogo, guarda el historial
// y marca lo que está claramente por debajo de lo habitual.

const MONTHS_AHEAD = 6;
const HISTORY_POINTS = 60; // ~12 días a 5 barridos diarios
const DEAL_DISCOUNT = 15; // % por debajo de lo habitual para considerarlo oferta
export const RADAR_MAX_AGE_H = 6;

interface Obs {
  t: string; // cuándo se vio
  p: number; // precio ida y vuelta por persona
}
type History = Record<string, Obs[]>;

interface CheapOffer {
  price: number;
  airline?: string;
  flight_number?: number | string;
  departure_at?: string;
  return_at?: string;
}

const DEST_BY_ID = new Map(DESTINATIONS.map((d) => [d.id, d]));
export const BY_CODE = new Map<string, Destination>();
for (const d of DESTINATIONS) {
  for (const code of [d.iata, ...airportsFor(d.iata).split(",")]) if (!BY_CODE.has(code)) BY_CODE.set(code, d);
}

function cheapForMonth(token: string, origin: string, month: string) {
  const qs = new URLSearchParams({ origin, destination: "-", depart_date: month, return_date: month, currency: "usd" });
  // Sin caché: cada barrido quiere el dato del momento.
  return fetchJSON<{ success: boolean; data: Record<string, Record<string, CheapOffer>> }>(
    `https://api.travelpayouts.com/v1/prices/cheap?${qs}`,
    "radar",
    { headers: { "X-Access-Token": token } },
  );
}

/** Mejor oferta de un destino en un mes (compacta). */
interface MonthBest {
  p: number;
  dep?: string;
  ret?: string;
  al?: string;
  fn?: string;
}
/** Datos guardados por mes: cuándo se revisó y el mejor precio por destino del catálogo. */
type MonthStore = Record<string, { at: string; d: Record<string, MonthBest> }>;
/**
 * Precios vistos antes para el mismo destino y mes (base del "precio habitual"
 * comparable): mes -> destino -> observaciones [precio, noches, día].
 */
type BaseStore = Record<string, Record<string, BaselineObs[]>>;
/** Observaciones por destino y mes, y cuántos días se guardan. */
const BASE_POINTS = 8;
const BASE_DAYS = 30;

const dayOf = (iso: string) => Math.floor(Date.parse(iso) / 86400000);
/** Noches del viaje de una oferta (-1 si no trae las dos fechas). */
const nightsOf = (o: { dep?: string; ret?: string }) =>
  o.dep && o.ret ? Math.round((Date.parse(o.ret) - Date.parse(o.dep)) / 86400000) : -1;

/**
 * Al reemplazar los datos de un mes, lo que había pasa al historial de ese mes
 * (cada observación entra una sola vez). Se recorta por antigüedad y cantidad.
 */
export function pushBaseline(prev: Record<string, BaselineObs[]> | undefined, old: { at: string; d: Record<string, MonthBest> } | undefined, today: number): Record<string, BaselineObs[]> {
  const out: Record<string, BaselineObs[]> = {};
  const keep = (xs: BaselineObs[]) => xs.filter((o) => o[2] >= today - BASE_DAYS).slice(-BASE_POINTS);
  for (const [id, xs] of Object.entries(prev ?? {})) out[id] = xs;
  if (old) {
    const day = dayOf(old.at);
    for (const [id, o] of Object.entries(old.d)) out[id] = [...(out[id] ?? []), [o.p, nightsOf(o), day]];
  }
  for (const id of Object.keys(out)) {
    const kept = keep(out[id]);
    if (kept.length) out[id] = kept;
    else delete out[id];
  }
  return out;
}

/** Meses a revisar en este barrido: los que nunca se revisaron o los más viejos. */
export function monthsToSweep(window: string[], store: MonthStore, n: number): string[] {
  return [...window].sort((a, b) => (store[a]?.at ?? "").localeCompare(store[b]?.at ?? "") || a.localeCompare(b)).slice(0, n);
}

/** Resume la respuesta de un mes: solo destinos del catálogo y su precio más bajo. */
function compactMonth(origin: string, res: { success: boolean; data: Record<string, Record<string, CheapOffer>> }): Record<string, MonthBest> {
  const out: Record<string, MonthBest> = {};
  for (const [code, offers] of Object.entries(res.data)) {
    const dest = BY_CODE.get(code);
    if (!dest || isSameCity(origin, dest)) continue;
    for (const offer of Object.values(offers ?? {})) {
      if (!offer?.price) continue;
      const p = Math.round(offer.price);
      if (out[dest.id] && out[dest.id].p <= p) continue;
      out[dest.id] = {
        p,
        dep: offer.departure_at?.slice(0, 10),
        ret: offer.return_at?.slice(0, 10),
        al: offer.airline,
        fn: offer.flight_number != null ? `${offer.airline ?? ""}${offer.flight_number}` : undefined,
      };
    }
  }
  return out;
}

/**
 * Ejecuta un barrido y guarda el resultado.
 * Para no pasar el límite de CPU del plan gratuito (10 ms), cada barrido baja
 * y procesa solo `monthsPerRun` meses (los revisados hace más tiempo) y los
 * combina con lo guardado de los demás meses. Con 5 barridos por día, cada
 * mes se actualiza más o menos una vez por día.
 */
export async function runRadar(token: string, origin: string, now = new Date(), opts: { monthsPerRun?: number } = {}): Promise<RadarSnapshot> {
  const months = upcomingMonths(now).slice(0, MONTHS_AHEAD);
  const window = months.map(({ month, year }) => `${year}-${String(month).padStart(2, "0")}`);
  const storeKey = `radar:months:${origin}`;
  const prevStore = (await loadJSON<MonthStore>(storeKey)) ?? {};
  // Solo los meses que siguen en la ventana.
  const store: MonthStore = Object.fromEntries(window.filter((m) => prevStore[m]).map((m) => [m, prevStore[m]]));
  const toSweep = monthsToSweep(window, store, Math.max(1, Math.min(MONTHS_AHEAD, opts.monthsPerRun ?? 1)));
  const baseKey = `radar:base:${origin}`;
  const [responses, prevBase] = await Promise.all([
    Promise.all(toSweep.map(async (m) => [m, await cheapForMonth(token, origin, m)] as const)),
    loadJSON<BaseStore>(baseKey),
  ]);
  const base: BaseStore = Object.fromEntries(window.filter((m) => prevBase?.[m]).map((m) => [m, prevBase![m]]));
  const today = dayOf(now.toISOString());
  let fresh = false;
  for (const [m, res] of responses) {
    if (res?.success && res.data) {
      // Lo que se veía antes en este mes pasa a ser historial comparable.
      base[m] = pushBaseline(base[m], store[m], today);
      store[m] = { at: now.toISOString(), d: compactMonth(origin, res) };
      fresh = true;
    } else if (store[m]) {
      // Falló: conservamos lo que había, pero pasa al final de la fila.
      store[m] = { ...store[m], at: now.toISOString() };
    }
  }

  // Mejor precio por destino del catálogo, global y por mes, cada uno con su
  // precio habitual del mismo mes y estadía parecida.
  const best = new Map<string, { offer: MonthBest; dest: Destination; month: string }>();
  const byMonth: RadarSnapshot["byMonth"] = {};
  const baselines = new Map<string, ReturnType<typeof likeForLikeBaseline>>();
  for (const monthKey of window) {
    for (const [destId, offer] of Object.entries(store[monthKey]?.d ?? {})) {
      const dest = DEST_BY_ID.get(destId);
      if (!dest) continue;
      const estimate = flightEstimate(origin, dest, Number(monthKey.slice(5, 7)));
      const bl = likeForLikeBaseline(base[monthKey]?.[destId] ?? [], nightsOf(offer), estimate);
      baselines.set(`${destId}|${monthKey}`, bl);
      const entry: RadarMonth = { p: offer.p, dep: offer.dep, ret: offer.ret, al: offer.al, t: bl.typical, b: bl.baseline };
      (byMonth[destId] ??= {})[monthKey] = entry;
      const prev = best.get(destId);
      if (!prev || offer.p < prev.offer.p) best.set(destId, { offer, dest, month: monthKey });
    }
  }

  const histKey = `radar:hist:${origin}`;
  const prevSnap = await loadJSON<RadarSnapshot>(`radar:snap:${origin}`);
  const history = (await loadJSON<History>(histKey)) ?? {};
  const cutoff = now.getTime() - 30 * 86400000;
  const items: RadarItem[] = [];
  const stats = { deals: 0, down: 0, up: 0, minimums: 0 };

  for (const { offer, dest, month } of best.values()) {
    const price = offer.p;
    const past = (history[dest.id] ?? []).filter((o) => Date.parse(o.t) >= cutoff);
    // "Lo habitual" del mismo viaje (destino, mes y ±2 noches); si no hay
    // suficientes datos comparables, la estimación (puntaje topeado).
    const bl = baselines.get(`${dest.id}|${month}`)!;
    const typical = bl.typical;
    const discountPct = Math.max(0, Math.round((1 - price / typical) * 100));
    // Mínimo también contra viajes comparables: no contra otro mes u otra estadía.
    const isMinimum = bl.lowest != null && price < bl.lowest;
    const last = prevSnap?.items.find((i) => i.destinationId === dest.id)?.priceUSD;
    const trend: RadarItem["trend"] = last == null ? "new" : price < last * 0.98 ? "down" : price > last * 1.02 ? "up" : "same";
    const isDeal = discountPct >= DEAL_DISCOUNT || isMinimum;

    if (trend === "down") stats.down++;
    if (trend === "up") stats.up++;
    if (isMinimum) stats.minimums++;
    if (isDeal) stats.deals++;

    items.push(withRadarScore({
      destinationId: dest.id,
      name: dest.name,
      iata: dest.iata,
      priceUSD: price,
      typicalUSD: typical,
      discountPct,
      baseline: bl.baseline,
      trend,
      isMinimum,
      isDeal,
      depart: offer.dep,
      ret: offer.ret,
      airline: offer.al,
      flightNumber: offer.fn,
      score: discountPct + (isMinimum ? 10 : 0) + (dest.hiddenGem ? 3 : 0) + (trend === "down" ? 2 : 0),
    }));
    history[dest.id] = [...past, { t: now.toISOString(), p: price }].slice(-HISTORY_POINTS);
  }

  items.sort((a, b) => b.score - a.score || a.priceUSD - b.priceUSD);
  const snapshot: RadarSnapshot = {
    origin,
    updatedAt: now.toISOString(),
    routes: items.length,
    stats,
    items,
    byMonth,
    live: items.length > 0,
  };
  // Si Travelpayouts no devolvió nada, no pisamos el historial ni la última foto buena.
  if (fresh) {
    await trySaveJSON(storeKey, store);
    await trySaveJSON(baseKey, base);
    monthsMemo.delete(origin);
  }
  if (items.length && fresh) {
    // Sin cuota de escritura en KV el barrido igual responde (no se guarda hasta el próximo).
    await trySaveJSON(histKey, history);
    histMemo.delete(origin);
    await trySaveJSON(`radar:snap:${origin}`, snapshot);
  }
  return items.length && fresh ? snapshot : (prevSnap ?? snapshot);
}

// Copia en memoria de los meses del radar para /explore (se lee en cada búsqueda).
const monthsMemo = new Map<string, { until: number; store: MonthStore }>();
const MONTHS_MEMO_MS = 5 * 60000;
/** Datos de un mes del radar más viejos que esto no se usan como precio actual. */
export const RADAR_MONTH_MAX_AGE_H = 30;

/**
 * Mínimo real por destino del catálogo (IATA de ciudad -> precio) que vio el
 * radar en cada mes pedido, si ese mes se revisó hace poco. Es un dato chico y
 * ya resumido: /explore lo usa en vez de bajar y parsear la respuesta cruda.
 */
export async function radarMonthFares(origin: string, months: string[], now = Date.now()): Promise<Record<string, Map<string, number>>> {
  let memo = monthsMemo.get(origin);
  if (!memo || memo.until < now) {
    memo = { until: now + MONTHS_MEMO_MS, store: (await loadJSON<MonthStore>(`radar:months:${origin}`)) ?? {} };
    monthsMemo.set(origin, memo);
  }
  const out: Record<string, Map<string, number>> = {};
  for (const m of months) {
    const entry = memo.store[m];
    if (!entry || now - Date.parse(entry.at) > RADAR_MONTH_MAX_AGE_H * 3600000) continue;
    const prices = new Map<string, number>();
    for (const [id, o] of Object.entries(entry.d)) {
      const dest = DEST_BY_ID.get(id);
      if (dest && o.p) prices.set(dest.iata, o.p);
    }
    if (prices.size) out[m] = prices;
  }
  return out;
}

/** Última foto del radar; si es vieja (o no existe), hace un barrido nuevo. */
export async function getRadar(token: string | undefined, origin: string): Promise<RadarSnapshot | null> {
  const snap = await loadJSON<RadarSnapshot>(`radar:snap:${origin}`);
  const fresh = snap && Date.now() - Date.parse(snap.updatedAt) < RADAR_MAX_AGE_H * 3600000;
  if (fresh || !token) return snap && withoutPastDepartures(snap);
  return withoutPastDepartures(await runRadar(token, origin));
}

/** Al servir una foto vieja, saca las ofertas cuya salida ya pasó (solo lectura). */
export function withoutPastDepartures(snap: RadarSnapshot, today = new Date()): RadarSnapshot {
  const todayISO = today.toISOString().slice(0, 10);
  const future = (dep?: string) => !dep || dep > todayISO;
  const items = snap.items.filter((i) => future(i.depart));
  const byMonth: RadarSnapshot["byMonth"] = {};
  for (const [id, months] of Object.entries(snap.byMonth ?? {})) {
    const kept = Object.entries(months).filter(([, o]) => future(o.dep));
    if (kept.length) byMonth[id] = Object.fromEntries(kept);
  }
  return { ...snap, items, byMonth, routes: items.length };
}

// Copia en memoria del historial para el gráfico de la página del destino:
// así no se lee y parsea todo el historial de KV en cada visita (límite de CPU).
const histMemo = new Map<string, { until: number; hist: History }>();
const HIST_MEMO_MS = 10 * 60000;

/** Observaciones del radar para una ruta, de la más vieja a la más nueva (máx. ~12 días). */
export async function routeHistory(origin: string, destId: string, now = Date.now()): Promise<Obs[]> {
  let memo = histMemo.get(origin);
  if (!memo || memo.until < now) {
    memo = { until: now + HIST_MEMO_MS, hist: (await loadJSON<History>(`radar:hist:${origin}`)) ?? {} };
    histMemo.set(origin, memo);
  }
  // Fechas cortas (al minuto) para que la respuesta pese poco.
  return (memo.hist[destId] ?? []).map((o) => ({ t: `${o.t.slice(0, 16)}Z`, p: o.p }));
}
