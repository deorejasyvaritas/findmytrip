import { describe, expect, it } from "vitest";
import {
  DURATION_BANDS,
  ROUTES,
  ROUTE_STYLES,
  bestMonthsLabel,
  inBand,
  routeDays,
  routeHops,
  routePrice,
  routeSearchParams,
  routeStopParam,
  type RouteQuote,
} from "../shared/routes.ts";
import { readStop, stopParam } from "../src/components/FullSearch.tsx";
import { DESTINATIONS, getDestination } from "../server/data/destinations.ts";
import { monthInRange, quoteRoute, routeQuotes } from "../server/routes.ts";

describe("datos de las rutas armadas", () => {
  it("tiene entre 16 y 24 rutas con ids únicos", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(16);
    expect(ROUTES.length).toBeLessThanOrEqual(24);
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
  });

  it("cada parada tiene coordenadas válidas y noches positivas", () => {
    for (const r of ROUTES) {
      expect(r.stops.length, r.id).toBeGreaterThanOrEqual(2);
      // "Ya sé a dónde" acepta hasta 5 paradas.
      expect(r.stops.length, r.id).toBeLessThanOrEqual(5);
      for (const s of r.stops) {
        expect(s.lat, `${r.id} ${s.name}`).toBeGreaterThanOrEqual(-90);
        expect(s.lat).toBeLessThanOrEqual(90);
        expect(s.lon, `${r.id} ${s.name}`).toBeGreaterThanOrEqual(-180);
        expect(s.lon).toBeLessThanOrEqual(180);
        expect(Number.isInteger(s.nights) && s.nights > 0, `${r.id} ${s.name}`).toBe(true);
        expect(s.name.includes("~") || s.region.includes("~") || s.country.includes("~")).toBe(false);
      }
    }
  });

  it("los países de la ruta coinciden con los de sus paradas", () => {
    for (const r of ROUTES) expect(new Set(r.stops.map((s) => s.country))).toEqual(new Set(r.countries));
  });

  it("las paradas de un mismo país están cerca de su destino del catálogo", () => {
    // Detecta coordenadas cruzadas (signo cambiado, lat/lon invertidas).
    for (const r of ROUTES) {
      for (const s of r.stops) {
        if (!s.destinationId) continue;
        const d = getDestination(s.destinationId)!;
        const km = Math.hypot(s.lat - d.lat, (s.lon - d.lon) * Math.cos((s.lat * Math.PI) / 180)) * 111;
        expect(km, `${r.id} ${s.name}`).toBeLessThan(500);
      }
    }
  });

  it("las fichas y referencias de alojamiento existen en el catálogo", () => {
    const ids = new Set(DESTINATIONS.map((d) => d.id));
    for (const r of ROUTES) {
      for (const s of r.stops) {
        if (s.destinationId) expect(ids.has(s.destinationId), s.destinationId).toBe(true);
        if (s.lodgingFrom) expect(ids.has(s.lodgingFrom), s.lodgingFrom).toBe(true);
        expect(Boolean(s.destinationId || s.lodgingFrom), `${r.id} ${s.name} sin referencia de alojamiento`).toBe(true);
      }
    }
  });

  it("estilos, meses y vuelo de llegada son válidos", () => {
    for (const r of ROUTES) {
      expect(r.styles.length).toBeGreaterThan(0);
      for (const s of r.styles) expect(ROUTE_STYLES).toContain(s);
      expect(r.bestMonths.length).toBeGreaterThan(0);
      for (const m of r.bestMonths) expect(m >= 1 && m <= 12).toBe(true);
      for (const c of r.flyTo.codes) expect(c).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("cada filtro de duración tiene al menos una ruta", () => {
    for (const b of DURATION_BANDS) expect(ROUTES.some((r) => inBand(r, b.id)), b.label).toBe(true);
  });
});

describe("rutas en la URL de Ya sé a dónde", () => {
  it("usa el mismo formato que stopParam y readStop lo lee igual", () => {
    for (const r of ROUTES) {
      for (const s of r.stops) {
        const raw = routeStopParam(s);
        expect(raw).toBe(stopParam({ name: s.name, region: s.region, country: s.country, lat: s.lat, lon: s.lon, destinationId: s.destinationId ?? null }, s.nights));
        const back = readStop(raw)!;
        expect(back).toMatchObject({ name: s.name, region: s.region, country: s.country, lat: s.lat, lon: s.lon, nights: s.nights, destinationId: s.destinationId ?? null });
      }
    }
  });

  it("sobrevive al ida y vuelta por URLSearchParams", () => {
    const r = ROUTES.find((x) => x.id === "nordeste-brasil")!;
    const q = new URLSearchParams(routeSearchParams(r, { depart: "2026-11-01" }).toString());
    expect(q.get("tipo")).toBe("viaje");
    expect(q.get("depart")).toBe("2026-11-01");
    const stops = q.getAll("stop").map(readStop);
    expect(stops.map((s) => s?.name)).toEqual(["Porto de Galinhas", "Maragogi", "Maceió", "Salvador"]);
    expect(stops.reduce((n, s) => n + s!.nights, 0) + 1).toBe(routeDays(r));
  });
});

describe("precio desde", () => {
  const quote: RouteQuote = { flightUSD: 612, flightTo: "Recife", lodgingUSD: 700, groundUSD: 45, internalFlights: 0, openJaw: true };

  it("sin vuelo real muestra Ver precio de hoy, nunca un número", () => {
    for (const q of [null, undefined, { ...quote, flightUSD: null }, { ...quote, flightUSD: 0 }]) {
      const p = routePrice(q, "noviembre");
      expect(p.kind).toBe("live");
      expect(p.kind === "live" && p.label).toBe("Ver precio de hoy");
    }
  });

  it("sin referencia de alojamiento tampoco hay número", () => {
    expect(routePrice({ ...quote, lodgingUSD: null }).kind).toBe("live");
  });

  it("suma vuelo, alojamiento y traslados y explica de dónde sale", () => {
    const p = routePrice(quote, "noviembre");
    expect(p.kind).toBe("estimate");
    if (p.kind !== "estimate") return;
    expect(p.perPersonUSD).toBe(1360);
    expect(p.basis).toContain("vuelo ida y vuelta a Recife más barato visto para noviembre");
    expect(p.basis).toContain("alojamiento promedio");
    expect(p.basis).toContain("traslados por tierra");
    expect(p.basis).toContain("Volver desde otra ciudad");
  });

  it("aclara los vuelos internos que no incluye", () => {
    const one = routePrice({ ...quote, internalFlights: 1, groundUSD: 0, openJaw: false });
    const two = routePrice({ ...quote, internalFlights: 2 });
    expect(one.kind === "estimate" && one.basis).toContain("No incluye el vuelo interno");
    expect(one.kind === "estimate" && one.basis).not.toContain("traslados");
    expect(two.kind === "estimate" && two.basis).toContain("No incluye 2 vuelos internos");
  });
});

describe("cotización en el servidor", () => {
  const nordeste = ROUTES.find((r) => r.id === "nordeste-brasil")!;

  it("usa solo el vuelo del mes que vino de Aviasales", () => {
    const q = quoteRoute(nordeste, "BUE", "2026-11", new Map([["REC", 640]]));
    expect(q.flightUSD).toBe(640);
    expect(q.flightTo).toBe("Recife");
    expect(q.lodgingUSD).toBeGreaterThan(0);
    expect(q.openJaw).toBe(true);
    expect(quoteRoute(nordeste, "BUE", "2026-11", new Map()).flightUSD).toBeNull();
  });

  it("prueba el siguiente código y no cotiza volar a la ciudad de salida", () => {
    const norte = ROUTES.find((r) => r.id === "norte-argentino")!;
    expect(quoteRoute(norte, "BUE", "2026-07", new Map([["SLA", 150]])).flightUSD).toBe(150);
    expect(quoteRoute(norte, "SLA", "2026-07", new Map([["SLA", 150]])).flightUSD).toBeNull();
  });

  it("cuenta como vuelo interno lo mismo que Ya sé a dónde (más de 500 km)", () => {
    const peru = ROUTES.find((r) => r.id === "peru-clasico")!;
    expect(routeHops(peru).map((h) => h.kind)).toEqual(["flight", "ground", "ground"]);
    expect(quoteRoute(peru, "BUE", "2026-07", new Map()).internalFlights).toBe(1);
  });

  it("sin token no llama a nada y devuelve todas las rutas sin vuelo", async () => {
    const res = await routeQuotes(undefined, "BUE", "2026-11");
    expect(Object.keys(res.quotes)).toHaveLength(ROUTES.length);
    expect(Object.values(res.quotes).every((q) => q.flightUSD == null)).toBe(true);
  });

  it("solo cotiza meses desde el actual hasta 11 adelante", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(monthInRange("2026-10", now)).toBe(true);
    expect(monthInRange("2027-09", now)).toBe(true);
    expect(monthInRange("2027-10", now)).toBe(false);
    expect(monthInRange("2026-09", now)).toBe(false);
  });
});

describe("mejor época", () => {
  it("agrupa meses seguidos aunque crucen el año", () => {
    expect(bestMonthsLabel([9, 10, 11, 12, 1, 2, 3])).toBe("sep a mar");
    expect(bestMonthsLabel([12, 1, 2, 3, 7, 8])).toBe("jul a ago y dic a mar");
    expect(bestMonthsLabel([4, 5, 6, 9, 10])).toBe("abr a jun y sep a oct");
    expect(bestMonthsLabel([5])).toBe("may");
  });
});
