import { describe, expect, it } from "vitest";
import { DESTINATIONS, getDestination } from "../server/data/destinations.ts";
import { estimatedCalendar, explore, monthOverview, tripCost, upcomingMonths } from "../server/engine.ts";
import type { ExploreRequest } from "../shared/types.ts";

const today = new Date("2026-10-13T12:00:00Z");
const base: ExploreRequest = {
  origin: "BUE",
  budgetUSD: 3000,
  travelers: 2,
  nights: 7,
  month: null,
  style: "mid",
  interests: ["playa"],
};

describe("catálogo", () => {
  it("tiene datos consistentes", () => {
    const ids = new Set<string>();
    for (const d of DESTINATIONS) {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(d.season).toHaveLength(12);
      expect(d.areas.length).toBeGreaterThan(0);
      for (const m of d.bestMonths) expect(m).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("explore", () => {
  it("solo devuelve destinos dentro del presupuesto (+15% como máximo)", () => {
    const res = explore(base, undefined, today);
    expect(res.suggestions.length).toBeGreaterThan(0);
    for (const s of [...res.suggestions, ...res.alternatives]) {
      expect(s.cost.total).toBeLessThanOrEqual(base.budgetUSD * 1.15);
    }
  });

  it("no repite destinos entre sugerencias y alternativas", () => {
    const res = explore({ ...base, known: ["rio"] }, undefined, today);
    const main = new Set(res.suggestions.map((s) => s.destination.id));
    for (const a of res.alternatives) expect(main.has(a.destination.id)).toBe(false);
  });

  it("respeta mes fijo, exclusiones y región", () => {
    const res = explore(
      { ...base, month: 3, exclude: ["florianopolis"], regions: ["Sudamérica"] },
      undefined,
      today,
    );
    for (const s of res.suggestions) {
      expect(s.month).toBe(3);
      expect(s.year).toBe(2027);
      expect(s.destination.id).not.toBe("florianopolis");
      expect(s.destination.region).toBe("Sudamérica");
    }
  });

  it("usa precio en vivo cuando se lo pasan", () => {
    const res = explore({ ...base, month: 11, budgetUSD: 20000 }, (iata: string) => (iata === "RIO" ? 100 : undefined), today);
    const rio = [...res.suggestions, ...res.alternatives].find((s) => s.destination.id === "rio");
    expect(rio?.flightSource).toBe("en vivo");
    expect(rio?.cost.flights).toBe(200);
  });

  it("presupuesto mínimo no devuelve nada", () => {
    expect(explore({ ...base, budgetUSD: 50 }, undefined, today).suggestions).toHaveLength(0);
  });
});

describe("precios", () => {
  it("temporada alta es más cara que baja", () => {
    const flo = getDestination("florianopolis")!;
    expect(tripCost("BUE", flo, 1, 7, 2, "mid").total).toBeGreaterThan(tripCost("BUE", flo, 5, 7, 2, "mid").total);
  });

  it("calendario estimado: solo días futuros y determinístico", () => {
    const rio = getDestination("rio")!;
    const a = estimatedCalendar("BUE", rio, "2026-10", 7, today);
    const b = estimatedCalendar("BUE", rio, "2026-10", 7, today);
    expect(a.days[0].date > "2026-10-13").toBe(true);
    expect(a.days).toEqual(b.days);
    expect(a.cheapest?.priceUSD).toBe(Math.min(...a.days.map((d) => d.priceUSD)));
  });

  it("vista por mes marca 3 meses recomendados", () => {
    const rows = monthOverview("COR", getDestination("cusco")!, 7, 2, "mid", today);
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.best)).toHaveLength(3);
    expect(upcomingMonths(today)[0]).toEqual({ month: 10, year: 2026 });
  });
});
