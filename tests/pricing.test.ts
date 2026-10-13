import { describe, expect, it } from "vitest";
import { bagsCost, dailyUnits, describeParty, fareUnits, partyFromParams, roomsForParty } from "../shared/pricing.ts";
import { DESTINATIONS, getDestination } from "../server/data/destinations.ts";
import { explore, resolveWhen, tripCost } from "../server/engine.ts";

const today = new Date("2026-10-13T12:00:00Z");

describe("pasajeros y equipaje", () => {
  const family = { adults: 2, childAges: [1, 6, 13], bags: "checked1" as const };

  it("tarifas según edad", () => {
    expect(fareUnits(family)).toBeCloseTo(2 + 0.1 + 0.75 + 1);
    expect(dailyUnits(family)).toBeCloseTo(2 + 0 + 0.6 + 1);
    expect(roomsForParty(family)).toBe(2); // 2 adultos + 1 de 13 años
    expect(describeParty(family)).toBe("2 adultos, 2 niños, 1 bebé");
  });

  it("valijas: los bebés no llevan y en vuelos largos la primera suele estar incluida", () => {
    expect(bagsCost(family, "Sudamérica")).toBe(45 * 2 * 4);
    expect(bagsCost(family, "Europa")).toBe(0);
    expect(bagsCost({ ...family, bags: "personal" }, "Sudamérica")).toBe(0);
  });

  it("el costo total incluye equipaje", () => {
    const rio = getDestination("rio")!;
    const c = tripCost("BUE", rio, 5, 7, family, "mid", 300);
    expect(c.flights).toBe(Math.round(300 * 3.85));
    expect(c.bags).toBe(360);
    // Comidas y paseos van aparte salvo que se pidan.
    expect(c.total).toBe(c.flights + c.bags + c.lodging);
    expect(c.dailyIncluded).toBe(false);
    expect(c.perPerson).toBe(Math.round(c.total / 5));
    const withDaily = tripCost("BUE", rio, 5, 7, family, "mid", 300, undefined, true);
    expect(withDaily.total).toBe(c.total + c.daily);
  });

  it("lee el grupo desde la URL", () => {
    const p = partyFromParams(new URLSearchParams("adults=1&kids=4,0&bags=checked2"), { adults: 2, childAges: [], bags: "cabin" });
    expect(p).toEqual({ adults: 1, childAges: [4, 0], bags: "checked2" });
  });
});

describe("fechas", () => {
  it("rango que cruza meses: fines de enero a principios de febrero", () => {
    const w = resolveWhen({ when: { kind: "window", from: "2027-01-25", to: "2027-02-05" }, nights: 7 }, today);
    expect(w.months).toEqual([
      { month: 1, year: 2027 },
      { month: 2, year: 2027 },
    ]);
  });

  it("fechas exactas fijan las noches", () => {
    const w = resolveWhen({ when: { kind: "exact", depart: "2027-03-10", ret: "2027-03-20" }, nights: 7 }, today);
    expect(w.nights).toBe(10);
    expect(w.months).toEqual([{ month: 3, year: 2027 }]);
  });

  it("descarta precios de Google fuera del rango", () => {
    const real = {
      forDest: (d: { id: string }) =>
        d.id === "rio"
          ? [
              { month: 1, flightPP: 100, depart: "2027-01-05", source: "google" as const },
              { month: 2, flightPP: 150, depart: "2027-02-02", source: "google" as const },
            ]
          : [],
    };
    const res = explore(
      {
        origin: "BUE",
        budgetUSD: 50000,
        travelers: 2,
        nights: 7,
        month: null,
        style: "mid",
        interests: [],
        when: { kind: "window", from: "2027-01-25", to: "2027-02-05" },
        exclude: DESTINATIONS.filter((d) => d.id !== "rio").map((d) => d.id),
      },
      real,
      today,
    );
    const rio = [...res.suggestions, ...res.alternatives].find((s) => s.destination.id === "rio")!;
    expect(rio.depart).toBe("2027-02-02");
  });
});
