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

  it("usa precios reales de Google y solo en esas fechas", () => {
    const real = {
      forDest: (d: { id: string }) =>
        d.id === "rio"
          ? [{ month: 11, flightPP: 100, hotelNight: 30, depart: "2026-11-10", ret: "2026-11-17", source: "google" as const }]
          : [],
    };
    const res = explore({ ...base, budgetUSD: 20000 }, real, today);
    const rio = [...res.suggestions, ...res.alternatives].find((s) => s.destination.id === "rio")!;
    expect(rio).toMatchObject({ month: 11, flightSource: "google", lodgingSource: "google", depart: "2026-11-10" });
    expect(rio.cost.flights).toBe(200);
    // estilo "mid": 30 × (110 / 40) = 83 por noche × 7 noches × 1 habitación
    expect(rio.cost.lodging).toBe(83 * 7);
  });

  it("tope de vuelo por persona: descarta lo que se pasa", () => {
    const res = explore({ ...base, budgetUSD: 20000, interests: [], maxFlightPP: 300 }, undefined, today);
    const all = [...res.suggestions, ...res.alternatives];
    expect(all.length).toBeGreaterThan(0);
    // 2 adultos: el vuelo del grupo no puede pasar 2 × 300
    for (const s of all) expect(s.cost.flights).toBeLessThanOrEqual(600);
    const real = {
      forDest: (d: { id: string }) => (d.id === "rio" ? [{ month: 11, flightPP: 450, source: "aviasales" as const }] : []),
      extra: [
        { name: "Cara", country: "X", airport: "AAA", flightPP: 900, hotelNight: null, depart: "2026-11-10", ret: null, airline: null, link: null, thumbnail: null, stops: 0 },
      ],
    };
    const withReal = explore({ ...base, budgetUSD: 20000, interests: [], maxFlightPP: 400 }, real, today);
    expect([...withReal.suggestions, ...withReal.alternatives].some((s) => s.destination.id === "rio")).toBe(false);
    expect(withReal.extra).toHaveLength(0);
  });

  it("solo directos: saca lo que Google sabe con escalas y marca lo directo", () => {
    const g = (stops?: number) => ({ month: 11, flightPP: 200, depart: "2026-11-10", ret: "2026-11-17", source: "google" as const, stops });
    const real = {
      forDest: (d: { id: string }) =>
        d.id === "rio" ? [g(0)] : d.id === "salvador" ? [g(1)] : d.id === "florianopolis" ? [g(undefined)] : [],
      extra: [
        { name: "Escala", country: "X", airport: "AAA", flightPP: 300, hotelNight: null, depart: "2026-11-10", ret: null, airline: null, link: null, thumbnail: null, stops: 2 },
        { name: "Sin dato", country: "X", airport: "BBB", flightPP: 300, hotelNight: null, depart: "2026-11-10", ret: null, airline: null, link: null, thumbnail: null, stops: null },
      ],
    };
    const req: ExploreRequest = { ...base, budgetUSD: 20000, regions: ["Sudamérica"] };
    const find = (r: ReturnType<typeof explore>, id: string) => [...r.suggestions, ...r.alternatives].find((s) => s.destination.id === id);

    const off = explore(req, real, today);
    expect(find(off, "salvador")).toBeDefined();
    expect(off.extra).toHaveLength(2);

    const on = explore({ ...req, directOnly: true }, real, today);
    expect(find(on, "salvador")).toBeUndefined();
    expect(find(on, "rio")?.direct).toBe(true);
    // Sin dato de escalas: queda, pero no se marca como directo
    expect(find(on, "florianopolis")).toBeDefined();
    expect(find(on, "florianopolis")?.direct).toBeUndefined();
    expect(on.extra.map((e) => e.name)).toEqual(["Sin dato"]);
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
