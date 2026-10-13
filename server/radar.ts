import type { Destination, RadarItem, RadarSnapshot } from "../shared/types.ts";
import { fetchJSON, loadJSON, saveJSON } from "./cache.ts";
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

const BY_CODE = new Map<string, Destination>();
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
  // Sin caché: cada barrido quiere el dato del momento (son 6 llamadas por ciudad).
  return fetchJSON<{ success: boolean; data: Record<string, Record<string, CheapOffer>> }>(
    `https://api.travelpayouts.com/v1/prices/cheap?${qs}`,
    "radar",
    { headers: { "X-Access-Token": token } },
  );
}

/** Ejecuta un barrido y guarda el resultado. */
export async function runRadar(token: string, origin: string, now = new Date()): Promise<RadarSnapshot> {
  const months = upcomingMonths(now).slice(0, MONTHS_AHEAD);
  const responses = await Promise.all(
    months.map(async ({ month, year }) => {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      return [key, await cheapForMonth(token, origin, key)] as const;
    }),
  );

  // Mejor precio por destino del catálogo, global y por mes.
  const best = new Map<string, { offer: CheapOffer; dest: Destination }>();
  const byMonth: RadarSnapshot["byMonth"] = {};
  for (const [monthKey, res] of responses) {
    if (!res?.success || !res.data) continue;
    for (const [code, offers] of Object.entries(res.data)) {
      const dest = BY_CODE.get(code);
      if (!dest || isSameCity(origin, dest)) continue;
      for (const offer of Object.values(offers)) {
        if (!offer?.price) continue;
        const slot = (byMonth[dest.id] ??= {});
        if (!slot[monthKey] || offer.price < slot[monthKey].p) {
          slot[monthKey] = { p: Math.round(offer.price), dep: offer.departure_at?.slice(0, 10), ret: offer.return_at?.slice(0, 10), al: offer.airline };
        }
        const prev = best.get(dest.id);
        if (!prev || offer.price < prev.offer.price) best.set(dest.id, { offer, dest });
      }
    }
  }

  const histKey = `radar:hist:${origin}`;
  const prevSnap = await loadJSON<RadarSnapshot>(`radar:snap:${origin}`);
  const history = (await loadJSON<History>(histKey)) ?? {};
  const cutoff = now.getTime() - 30 * 86400000;
  const items: RadarItem[] = [];
  const stats = { deals: 0, down: 0, up: 0, minimums: 0 };

  for (const { offer, dest } of best.values()) {
    const price = Math.round(offer.price);
    const past = (history[dest.id] ?? []).filter((o) => Date.parse(o.t) >= cutoff);
    const depMonth = Number(offer.departure_at?.slice(5, 7)) || months[0].month;
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

    items.push({
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
      depart: offer.departure_at?.slice(0, 10),
      ret: offer.return_at?.slice(0, 10),
      airline: offer.airline,
      flightNumber: offer.flight_number != null ? `${offer.airline ?? ""}${offer.flight_number}` : undefined,
      score: discountPct + (isMinimum ? 10 : 0) + (dest.hiddenGem ? 3 : 0) + (trend === "down" ? 2 : 0),
    });
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
  if (items.length) {
    await saveJSON(histKey, history);
    await saveJSON(`radar:snap:${origin}`, snapshot);
  }
  return items.length ? snapshot : (prevSnap ?? snapshot);
}

/** Última foto del radar; si es vieja (o no existe), hace un barrido nuevo. */
export async function getRadar(token: string | undefined, origin: string): Promise<RadarSnapshot | null> {
  const snap = await loadJSON<RadarSnapshot>(`radar:snap:${origin}`);
  const fresh = snap && Date.now() - Date.parse(snap.updatedAt) < RADAR_MAX_AGE_H * 3600000;
  if (fresh || !token) return snap;
  return runRadar(token, origin);
}
