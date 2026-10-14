import { describe, expect, it } from "vitest";
import { DESTINATIONS, getDestination } from "../server/data/destinations.ts";
import { TA_GEO } from "../server/providers/xotelo.ts";
import { PARK_TICKETS, extrasFor } from "../shared/extras.ts";
import { CRUISES, CRUISE_ZONES, cruiseFlightSearch, cruiseNightsLabel, leavesFromArgentina, sampleDeparture } from "../shared/cruises.ts";
import { entryRequirements } from "../shared/entry-requirements.ts";
import { ROUTES } from "../shared/routes.ts";

const NEW_IDS = ["orlando", "los-angeles", "beto-carrero", "porto-de-galinhas", "maragogi", "natal", "fortaleza", "gramado"];

describe("catálogo: parques y nordeste de Brasil", () => {
  it("los destinos nuevos tienen todos los campos con valores razonables", () => {
    for (const id of NEW_IDS) {
      const d = getDestination(id)!;
      expect(d, id).toBeDefined();
      expect(d.iata, id).toMatch(/^[A-Z]{3}$/);
      expect(d.lat, id).toBeGreaterThanOrEqual(-90);
      expect(d.lat, id).toBeLessThanOrEqual(90);
      expect(d.lon, id).toBeGreaterThanOrEqual(-180);
      expect(d.lon, id).toBeLessThanOrEqual(180);
      expect(d.season, id).toHaveLength(12);
      expect(d.bestMonths.length, id).toBeGreaterThan(0);
      for (const m of d.bestMonths) expect(m >= 1 && m <= 12, id).toBe(true);
      for (const s of ["low", "mid", "high"] as const) {
        expect(d.dailyUSD[s], id).toBeGreaterThan(0);
        expect(d.lodgingUSD[s], id).toBeGreaterThan(0);
      }
      expect(d.dailyUSD.low).toBeLessThan(d.dailyUSD.mid);
      expect(d.dailyUSD.mid).toBeLessThan(d.dailyUSD.high);
      expect(d.lodgingUSD.low).toBeLessThan(d.lodgingUSD.mid);
      expect(d.lodgingUSD.mid).toBeLessThan(d.lodgingUSD.high);
      expect(d.highlights.length, id).toBeGreaterThanOrEqual(3);
      expect(d.areas.length, id).toBeGreaterThan(0);
      expect(TA_GEO[id], id).toMatch(/^g\d+$/);
      expect(entryRequirements(d.country), id).not.toBeNull();
    }
  });

  it("las coordenadas caen en el lugar correcto (Brasil al sur del ecuador, EE.UU. al norte)", () => {
    for (const id of ["beto-carrero", "porto-de-galinhas", "maragogi", "natal", "fortaleza", "gramado"]) {
      const d = getDestination(id)!;
      expect(d.lat, id).toBeLessThan(0);
      expect(d.lon, id).toBeGreaterThan(-55);
      expect(d.lon, id).toBeLessThan(-34);
    }
    for (const id of ["orlando", "los-angeles"]) expect(getDestination(id)!.lat).toBeGreaterThan(25);
  });

  it("el interés parques marca los destinos con parques y los nombra en los imperdibles", () => {
    const parks = DESTINATIONS.filter((d) => d.tags.includes("parques")).map((d) => d.id);
    expect(parks).toEqual(expect.arrayContaining(["orlando", "los-angeles", "beto-carrero", "gramado", "paris", "japon", "cancun"]));
    expect(getDestination("orlando")!.highlights.join(" ")).toContain("Disney");
    expect(getDestination("paris")!.highlights).toContain("Disneyland Paris");
    expect(getDestination("barcelona")!.highlights.join(" ")).toContain("PortAventura");
  });
});

describe("entradas a parques en Completá el viaje", () => {
  it("todo destino con parques ofrece entradas, sin precios y con link a la búsqueda del parque", () => {
    for (const d of DESTINATIONS.filter((x) => x.tags.includes("parques"))) {
      const card = extrasFor(d).find((x) => x.kind === "parques");
      expect(card, d.id).toBeDefined();
      expect(PARK_TICKETS[d.id], d.id).toBeDefined();
      expect(card!.url).toMatch(/^https:\/\//);
      expect(card!.description).not.toMatch(/\$|USD|\d+ ?€/);
    }
    expect(extrasFor(getDestination("orlando")!).find((x) => x.kind === "parques")?.url).toBe(
      "https://www.klook.com/es/search/result/?query=Walt%20Disney%20World",
    );
  });

  it("no aparece en destinos sin parques y nunca deja afuera el seguro en Orlando", () => {
    expect(extrasFor(getDestination("bariloche")!).some((x) => x.kind === "parques")).toBe(false);
    expect(extrasFor(getDestination("roma")!).some((x) => x.kind === "parques")).toBe(false);
    const orlando = extrasFor(getDestination("orlando")!).map((x) => x.kind);
    expect(orlando).toEqual(["traslado", "parques", "auto", "excursiones", "esim", "seguro"]);
    for (const d of DESTINATIONS) {
      const kinds = extrasFor(d).map((x) => x.kind);
      expect(new Set(kinds).size, d.id).toBe(kinds.length);
    }
  });
});

describe("cruceros", () => {
  it("cada itinerario tiene datos completos y sin precios", () => {
    expect(new Set(CRUISES.map((c) => c.id)).size).toBe(CRUISES.length);
    for (const c of CRUISES) {
      expect(CRUISE_ZONES).toContain(c.zone);
      expect(c.ports.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.nights[0], c.id).toBeGreaterThan(0);
      expect(c.nights[1], c.id).toBeGreaterThanOrEqual(c.nights[0]);
      expect(c.months.length, c.id).toBeGreaterThan(0);
      for (const m of c.months) expect(m >= 1 && m <= 12, c.id).toBe(true);
      expect(c.lines.length, c.id).toBeGreaterThan(0);
      expect(c.search.url, c.id).toMatch(/^https:\/\/www\.crucero\.com\.ar\/(d|pd|c)-\d+-[a-z-]+$/);
      if (c.official) expect(c.official.url).toMatch(/^https:\/\//);
      if (c.flight) expect(c.flight.code, c.id).toMatch(/^[A-Z]{3}$/);
      const text = [c.name, c.summary, c.note ?? ""].join(" ");
      expect(text, c.id).not.toMatch(/\$|USD|U\$S/);
    }
  });

  it("incluye las salidas desde Buenos Aires y las rutas lejanas", () => {
    const ids = CRUISES.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["buenos-aires-brasil", "caribe-miami", "mediterraneo", "fiordos-noruegos", "alaska", "cabo-de-hornos"]));
    expect(leavesFromArgentina(CRUISES.find((c) => c.id === "buenos-aires-brasil")!)).toBe(true);
    expect(leavesFromArgentina(CRUISES.find((c) => c.id === "caribe-miami")!)).toBe(false);
    expect(cruiseNightsLabel(CRUISES.find((c) => c.id === "alaska")!)).toBe("7 noches");
  });

  it("la fecha de ejemplo cae en temporada y al menos un mes adelante", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(sampleDeparture([5, 6, 7, 8, 9], now)).toBe("2027-05-01");
    expect(sampleDeparture([11, 12, 1], now)).toBe("2026-11-13");
    expect(sampleDeparture([12, 1], now)).toBe("2026-12-01");
  });

  it("combina con un vuelo al puerto (o de vuelta si el crucero es solo ida)", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const origin = { code: "BUE", name: "Buenos Aires" };
    const miami = new URLSearchParams(cruiseFlightSearch(CRUISES.find((c) => c.id === "caribe-miami")!, origin, now)!.split("?")[1]);
    expect(miami.get("tipo")).toBe("vuelos");
    expect(miami.get("from")).toBe("BUE|Buenos Aires");
    expect(miami.get("to")).toBe("MIA|Miami");
    expect(miami.get("depart")! < miami.get("ret")!).toBe(true);
    const hornos = new URLSearchParams(cruiseFlightSearch(CRUISES.find((c) => c.id === "cabo-de-hornos")!, origin, now)!.split("?")[1]);
    expect(hornos.get("from")).toBe("SCL|Santiago de Chile");
    expect(hornos.get("to")).toBe("BUE|Buenos Aires");
    expect(hornos.get("ret")).toBeNull();
    expect(cruiseFlightSearch(CRUISES.find((c) => c.id === "buenos-aires-brasil")!, origin, now)).toBeNull();
  });
});

describe("rutas armadas con los destinos nuevos", () => {
  it("usan las fichas nuevas", () => {
    const ids = new Set(ROUTES.flatMap((r) => r.stops.map((s) => s.destinationId ?? s.lodgingFrom)));
    for (const id of ["orlando", "porto-de-galinhas", "maragogi", "beto-carrero", "los-angeles"]) expect(ids.has(id), id).toBe(true);
  });
});
