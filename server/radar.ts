import { withRadarScore } from "../shared/radar-score.ts";
import type { Destination, RadarItem, RadarSnapshot } from "../shared/types.ts";
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

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

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
  const responses = await Promise.all(toSweep.map(async (m) => [m, await cheapForMonth(token, origin, m)] as const));
  let fresh = false;
  for (const [m, res] of responses) {
    if (res?.success && res.data) {
      store[m] = { at: now.toISOString(), d: compactMonth(origin, res) };
      fresh = true;
    } else if (store[m]) {
      // Falló: conservamos lo que había, pero pasa al final de la fila.
      store[m] = { ...store[m], at: now.toISOString() };
    }
  }

  // Mejor precio por destino del catálogo, global y por mes.
  const best = new Map<string, { offer: MonthBest; dest: Destination }>();
  const byMonth: RadarSnapshot["byMonth"] = {};
  for (const monthKey of window) {
    for (const [destId, offer] of Object.entries(store[monthKey]?.d ?? {})) {
      const dest = DEST_BY_ID.get(destId);
      if (!dest) continue;
      (byMonth[destId] ??= {})[monthKey] = { p: offer.p, dep: offer.dep, ret: offer.ret, al: offer.al };
      const prev = best.get(destId);
      if (!prev || offer.p < prev.offer.p) best.set(destId, { offer, dest });
    }
  }

  const histKey = `radar:hist:${origin}`;
  const prevSnap = await loadJSON<RadarSnapshot>(`radar:snap:${origin}`);
  const history = (await loadJSON<History>(histKey)) ?? {};
  const cutoff = now.getTime() - 30 * 86400000;
  const items: RadarItem[] = [];
  const stats = { deals: 0, down: 0, up: 0, minimums: 0 };

  for (const { offer, dest } of best.values()) {
    const price = offer.p;
    const past = (history[dest.id] ?? []).filter((o) => Date.parse(o.t) >= cutoff);
    const depMonth = Number(offer.dep?.slice(5, 7)) || months[0].month;
    const useHistory = past.length >= 3;
    const typical = Math.round(useHistory ? median(past.map((o) => o.p)) : flightEstimate(origin, dest, depMonth));
    const discountPct = Math.max(0, Math.round((1 - price / typical) * 100));
    const isMinimum = useHistory && price < Math.min(...past.map((o) => o.p));
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
      baseline: useHistory ? "historial" : "estimado",
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
  if (fresh) await trySaveJSON(storeKey, store);
  if (items.length && fresh) {
    // Sin cuota de escritura en KV el barrido igual responde (no se guarda hasta el próximo).
    await trySaveJSON(histKey, history);
    histMemo.delete(origin);
    await trySaveJSON(`radar:snap:${origin}`, snapshot);
  }
  return items.length && fresh ? snapshot : (prevSnap ?? snapshot);
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
