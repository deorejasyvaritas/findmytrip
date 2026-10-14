import { describe, expect, it } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { LONG_WEEKEND_MAX_HOURS, addDays, explore, resolveWhen, weekendOption } from "../server/engine.ts";
import type { ExploreRequest, RealPrice } from "../shared/types.ts";

// Hoy: 13 de octubre de 2026. Los próximos fines largos son:
// 21-23 nov (Soberanía), 5-8 dic (puente + Inmaculada), 25-27 dic (Navidad), 1-3 ene (Año Nuevo).
const today = new Date("2026-10-13T12:00:00Z");
const base: ExploreRequest = {
  origin: "BUE",
  budgetUSD: 6000,
  travelers: 2,
  nights: 7,
  month: null,
  style: "mid",
  interests: [],
  longWeekendsOnly: true,
};

describe("resolveWhen con fines de semana largos", () => {
  it("toma los próximos 4 y limita las noches al más largo", () => {
    const r = resolveWhen(base, today);
    expect(r.weekends?.map((w) => w.from)).toEqual(["2026-11-21", "2026-12-05", "2026-12-25", "2027-01-01"]);
    expect(r.nights).toBe(4);
    expect(r.months).toContainEqual({ month: 11, year: 2026 });
    expect(r.months).toContainEqual({ month: 1, year: 2027 });
  });

  it("respeta los meses elegidos", () => {
    const r = resolveWhen({ ...base, when: { kind: "months", months: [{ month: 12, year: 2026 }] } }, today);
    expect(r.weekends?.length).toBeGreaterThan(0);
    expect(r.weekends?.some((w) => w.from.startsWith("2026-11"))).toBe(false);
  });

  it("sin el filtro no cambia nada", () => {
    expect(resolveWhen({ ...base, longWeekendsOnly: false }, today).weekends).toBeUndefined();
  });

  it("con fechas exactas se ignora", () => {
    const r = resolveWhen({ ...base, when: { kind: "exact", depart: "2026-11-20", ret: "2026-11-23" } }, today);
    expect(r.weekends).toBeUndefined();
    expect(r.nights).toBe(3);
  });
});

describe("explore con fines de semana largos", () => {
  it("solo sugiere salidas dentro de un fin largo y destinos cercanos", () => {
    const res = explore(base, undefined, today);
    const all = [...res.suggestions, ...res.alternatives];
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      const w = s.longWeekend!;
      expect(w).toBeDefined();
      expect(s.depart! >= addDays(w.from, -1)).toBe(true);
      expect(s.depart! <= addDays(w.to, -1)).toBe(true);
      expect(s.ret! <= w.to).toBe(true);
      expect(s.nights).toBeLessThanOrEqual(w.days);
      expect(s.destination.flightHours).toBeLessThanOrEqual(LONG_WEEKEND_MAX_HOURS);
    }
  });

  it("usa el precio real que cae en el fin largo y descarta el de otras fechas", () => {
    const flori = getDestination("florianopolis")!;
    const prices: RealPrice[] = [
      { month: 11, flightPP: 40, depart: "2026-11-10", ret: "2026-11-14", source: "aviasales" },
      { month: 11, flightPP: 90, depart: "2026-11-20", ret: "2026-11-23", source: "aviasales", airline: "G3" },
    ];
    const res = explore({ ...base, budgetUSD: 20000 }, { forDest: (d) => (d.id === flori.id ? prices : []) }, today);
    const s = [...res.suggestions, ...res.alternatives].find((x) => x.destination.id === flori.id);
    expect(s).toBeDefined();
    expect(s!.flightSource).toBe("aviasales");
    expect(s!.depart).toBe("2026-11-20");
    expect(s!.nights).toBe(3);
    expect(s!.longWeekend?.reason).toContain("Soberanía");
  });
});

describe("weekendOption", () => {
  const dest = getDestination("florianopolis")!;
  const w = { from: "2026-12-05", to: "2026-12-08", days: 4, reason: "Puente turístico y Inmaculada Concepción" };

  it("sin precio real estima volviendo el último día libre", () => {
    const o = weekendOption("BUE", dest, w, [], 2, false, today);
    expect(o.nights).toBe(2);
    expect(o.depart).toBe("2026-12-06");
    expect(o.ret).toBe("2026-12-08");
    expect(o.flightPP).toBeGreaterThan(0);
    expect(o.live).toBeUndefined();
  });

  it("elige el precio real más barato dentro de la ventana (desde el día anterior)", () => {
    const real: RealPrice[] = [
      { month: 12, flightPP: 120, depart: "2026-12-04", ret: "2026-12-08", source: "aviasales" },
      { month: 12, flightPP: 100, depart: "2026-12-05", ret: "2026-12-08", source: "aviasales" },
      { month: 12, flightPP: 60, depart: "2026-12-05", ret: "2026-12-10", source: "aviasales" }, // vuelve tarde
      { month: 12, flightPP: 50, depart: "2026-12-03", ret: "2026-12-08", source: "aviasales" }, // sale antes
    ];
    const o = weekendOption("BUE", dest, w, real, 7, false, today);
    expect(o.live?.flightPP).toBe(100);
    expect(o.nights).toBe(3);
  });

  it("con solo directos descarta lo que Google sabe que tiene escalas", () => {
    const real: RealPrice[] = [{ month: 12, flightPP: 80, depart: "2026-12-04", ret: "2026-12-08", stops: 1, source: "google" }];
    expect(weekendOption("BUE", dest, w, real, 7, true, today).live).toBeUndefined();
  });
});
