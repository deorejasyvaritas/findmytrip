import type { Escape, EscapeWeekend } from "../shared/types.ts";
import { cached, fetchJSON } from "./cache.ts";
import { addDays, isSameCity, lodgingNightly, toISO } from "./engine.ts";
import { longWeekends } from "./holidays.ts";
import { BY_CODE } from "./radar.ts";

// Escapadas para los fines de semana largos: precios reales de Aviasales
// (Travelpayouts) para salir el día anterior o el primer día libre y volver el último.

const TP = "https://api.travelpayouts.com";
const MAX_FLIGHT_HOURS = 6; // escapada corta: destinos cercanos
const PER_WEEKEND = 4;

export interface Offer {
  code: string;
  price: number;
  depart: string;
  ret: string;
  airline?: string;
}

export async function offersFor(token: string, origin: string, depart: string, ret: string): Promise<Offer[]> {
  const out =
    (await cached<Offer[]>(`esc:${origin}-${depart}-${ret}`, 6 * 3600, async () => {
      const headers = { headers: { "X-Access-Token": token } };
      const [cheap, dates] = await Promise.all([
        fetchJSON<{ success: boolean; data: Record<string, Record<string, { price: number; airline?: string; departure_at?: string; return_at?: string }>> }>(
          `${TP}/v1/prices/cheap?${new URLSearchParams({ origin, destination: "-", depart_date: depart, return_date: ret, currency: "usd" })}`,
          "travelpayouts",
          headers,
        ),
        fetchJSON<{ success: boolean; data: { destination: string; price: number; airline?: string; departure_at: string; return_at?: string }[] }>(
          `${TP}/aviasales/v3/prices_for_dates?${new URLSearchParams({ origin, departure_at: depart, return_at: ret, one_way: "false", currency: "usd", sorting: "price", limit: "200" })}`,
          "travelpayouts",
          headers,
        ),
      ]);
      const list: Offer[] = [];
      if (cheap?.success && cheap.data) {
        for (const [code, offers] of Object.entries(cheap.data)) {
          for (const o of Object.values(offers)) {
            if (o?.price) list.push({ code, price: Math.round(o.price), depart: o.departure_at?.slice(0, 10) ?? depart, ret: o.return_at?.slice(0, 10) ?? ret, airline: o.airline });
          }
        }
      }
      if (dates?.success && Array.isArray(dates.data)) {
        for (const o of dates.data) {
          if (o?.price && o.destination) list.push({ code: o.destination, price: Math.round(o.price), depart: o.departure_at.slice(0, 10), ret: o.return_at?.slice(0, 10) ?? ret, airline: o.airline });
        }
      }
      // Solo cuenta si las fechas coinciden con la escapada.
      return list.filter((o) => o.depart === depart && o.ret === ret);
    })) ?? [];
  return out;
}

export async function escapes(token: string | undefined, origin: string, today = new Date()): Promise<EscapeWeekend[]> {
  const weekends = longWeekends(toISO(today), 4);
  if (!token) return weekends.map((w) => ({ ...w, options: [] }));
  return Promise.all(
    weekends.map(async (w) => {
      // Salir la noche anterior suele ser lo más común; también probamos salir el primer día libre.
      const [early, sameDay] = await Promise.all([
        offersFor(token, origin, addDays(w.from, -1), w.to),
        offersFor(token, origin, w.from, w.to),
      ]);
      const best = new Map<string, Escape>();
      for (const o of [...early, ...sameDay]) {
        const dest = BY_CODE.get(o.code);
        if (!dest || dest.flightHours > MAX_FLIGHT_HOURS || isSameCity(origin, dest)) continue;
        const nights = Math.max(1, Math.round((Date.parse(o.ret) - Date.parse(o.depart)) / 86400000));
        const month = Number(o.depart.slice(5, 7));
        // Alojamiento económico compartido de a dos, por persona.
        const lodgingPP = Math.round((lodgingNightly(dest, "low", month) * nights) / 2);
        const prev = best.get(dest.id);
        if (!prev || o.price < prev.flightUSD) {
          best.set(dest.id, {
            destinationId: dest.id,
            name: dest.name,
            flightUSD: o.price,
            lodgingUSD: lodgingPP,
            totalPerPersonUSD: o.price + lodgingPP,
            depart: o.depart,
            ret: o.ret,
            nights,
            airline: o.airline,
          });
        }
      }
      const options = [...best.values()].sort((a, b) => a.totalPerPersonUSD - b.totalPerPersonUSD).slice(0, PER_WEEKEND);
      return { ...w, options };
    }),
  );
}
