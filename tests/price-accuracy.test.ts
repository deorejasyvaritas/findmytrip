import { describe, expect, it } from "vitest";
import { DESTINATIONS, getDestination } from "../server/data/destinations.ts";
import { explore, stayOptions, tripCost } from "../server/engine.ts";
import { buildPackage } from "../server/packages.ts";
import { pickAlertOffer } from "../server/alerts.ts";
import { withoutPastDepartures } from "../server/radar.ts";
import { formatMoney, isDomestic, pesoHint, pesoRate } from "../src/lib/format.ts";
import type { Destination, ExploreRequest, RadarSnapshot, RealPrice } from "../shared/types.ts";

const today = new Date("2026-10-13T12:00:00Z");
const rio = getDestination("rio")!;
const bariloche = getDestination("bariloche")!;

const base: ExploreRequest = {
  exclude: DESTINATIONS.filter((d) => d.id !== "rio").map((d) => d.id),
  origin: "BUE",
  budgetUSD: 20000,
  travelers: 2,
  nights: 7,
  month: null,
  style: "mid",
  interests: [],
};
const realFor = (id: string, prices: RealPrice[]) => ({ forDest: (d: Destination) => (d.id === id ? prices : []) });
const find = (res: ReturnType<typeof explore>, id: string) =>
  [...res.suggestions, ...res.alternatives].find((s) => s.destination.id === id);
/** Explora un solo destino (el resto queda excluido). */
const only = (id: string) => DESTINATIONS.filter((d) => d.id !== id).map((d) => d.id);

describe("explore con fechas: mínimos mensuales de Aviasales (#1)", () => {
  const monthly: RealPrice = { month: 12, flightPP: 55, source: "aviasales" };

  it("con ventana no usa el mínimo del mes sin fecha como precio de esas fechas", () => {
    const req = { ...base, when: { kind: "window" as const, from: "2026-12-01", to: "2026-12-10" } };
    const s = find(explore(req, realFor("rio", [monthly]), today), "rio")!;
    expect(s.flightSource).toBe("estimado");
    expect(s.cost.flights).not.toBe(55 * 2);
  });

  it("con fechas exactas tampoco", () => {
    const req = { ...base, when: { kind: "exact" as const, depart: "2026-12-05", ret: "2026-12-12" } };
    const s = find(explore(req, realFor("rio", [monthly]), today), "rio")!;
    expect(s.flightSource).toBe("estimado");
    expect(s.depart).toBe("2026-12-05");
  });

  it("sí usa un precio de Aviasales con fecha dentro de la ventana", () => {
    const dated: RealPrice = { month: 12, flightPP: 60, depart: "2026-12-04", ret: "2026-12-11", source: "aviasales" };
    const req = { ...base, when: { kind: "window" as const, from: "2026-12-01", to: "2026-12-10" } };
    const s = find(explore(req, realFor("rio", [monthly, dated]), today), "rio")!;
    expect(s.flightSource).toBe("aviasales");
    expect(s.cost.flights).toBe(120);
    expect(s.depart).toBe("2026-12-04");
  });

  it("sin fechas (meses) el mínimo mensual sigue sirviendo", () => {
    const req = { ...base, when: { kind: "months" as const, months: [{ month: 12, year: 2026 }] } };
    const s = find(explore(req, realFor("rio", [monthly]), today), "rio")!;
    expect(s.flightSource).toBe("aviasales");
    expect(s.cost.flights).toBe(110);
  });
});

describe("explore con fechas de Google (#2)", () => {
  it("el costo usa las noches de las fechas que muestra, no las pedidas", () => {
    const g: RealPrice = { month: 12, flightPP: 300, depart: "2026-12-03", ret: "2026-12-09", source: "google" };
    const s = find(explore({ ...base, nights: 7 }, realFor("rio", [g]), today), "rio")!;
    expect(s.depart).toBe("2026-12-03");
    expect(s.ret).toBe("2026-12-09");
    expect(s.nights).toBe(6);
    expect(s.cost).toEqual(tripCost("BUE", rio, 12, 6, { adults: 2, childAges: [], bags: "cabin" }, "mid", 300));
  });

  it("descarta fechas de Google con una estadía muy distinta a la pedida", () => {
    // 3 noches no es el precio de un viaje de 7: no se muestra como si lo fuera.
    const g: RealPrice = { month: 12, flightPP: 300, depart: "2026-12-03", ret: "2026-12-06", source: "google" };
    const s = find(explore({ ...base, nights: 7 }, realFor("rio", [g]), today), "rio");
    expect(s?.depart === "2026-12-03" && s?.ret === "2026-12-06").toBe(false);
  });
});

describe("habitaciones con chicos (#4)", () => {
  it("stayOptions: los chicos comparten habitación", () => {
    const family = stayOptions(rio, "2026-12-03", 5, { adults: 2, childAges: [5, 8], bags: "cabin" });
    expect(family[0].rooms).toBe(1);
    expect(family[0].totalUSD).toBe(family[0].nightlyUSD * 5);
    // Cuatro adultos sí necesitan dos.
    expect(stayOptions(rio, "2026-12-03", 5, 4)[0].rooms).toBe(2);
  });
});

describe("buildPackage (#5)", () => {
  const party = { adults: 2, childAges: [7], bags: "checked1" as const };

  it("usa las mismas reglas que tripCost: tarifa de chicos, equipaje y comidas aparte", () => {
    const pkg = buildPackage({ dest: rio, origin: "BUE", departDate: "2026-12-03", nights: 5, party, style: "mid", flightPP: 400 });
    const cost = tripCost("BUE", rio, 12, 5, party, "mid", 400);
    expect(pkg.travelers).toBe(3);
    expect(pkg.items.find((i) => i.kind === "vuelo")?.amountUSD).toBe(Math.round(400 * 2.75));
    expect(pkg.items.find((i) => i.kind === "extra")?.amountUSD).toBe(cost.bags);
    expect(cost.bags).toBeGreaterThan(0);
    expect(pkg.items.some((i) => i.kind === "gastos")).toBe(false);
    expect(pkg.totalUSD).toBe(cost.total);
    expect(pkg.notes).toContain("Comidas y paseos aparte");
    expect(pkg.returnDate).toBe("2026-12-08");
  });

  it("suma comidas y paseos solo si se pide", () => {
    const pkg = buildPackage({ dest: rio, origin: "BUE", departDate: "2026-12-03", nights: 5, party, style: "mid", flightPP: 400, includeDaily: true });
    const cost = tripCost("BUE", rio, 12, 5, party, "mid", 400, undefined, true);
    expect(pkg.items.find((i) => i.kind === "gastos")?.amountUSD).toBe(cost.daily);
    expect(pkg.totalUSD).toBe(cost.total);
  });

  it("sigue aceptando solo la cantidad de adultos", () => {
    const pkg = buildPackage({ dest: rio, origin: "BUE", departDate: "2026-12-03", nights: 5, travelers: 3, style: "low", flightPP: 400 });
    expect(pkg.items.find((i) => i.kind === "vuelo")?.amountUSD).toBe(1200);
  });
});

describe("alertas de destinos seguidos (#7)", () => {
  const sub = { month: 12, nights: 10 };

  it("cuenta las noches de las fechas de la oferta", () => {
    const pick = pickAlertOffer(sub, { "2026-12": { p: 300, dep: "2026-12-05", ret: "2026-12-14" } }, today);
    expect(pick?.nights).toBe(9);
  });

  it("descarta ofertas con una estadía muy distinta o con salida pasada", () => {
    const pick = pickAlertOffer(
      sub,
      {
        "2026-12": { p: 100, dep: "2026-12-05", ret: "2026-12-08" },
        "2026-10": { p: 50, dep: "2026-10-01", ret: "2026-10-11" },
      },
      today,
    );
    expect(pick).toBeNull();
  });

  it("sin fechas usa las noches pedidas", () => {
    const pick = pickAlertOffer({ month: null, nights: 10 }, { "2027-01": { p: 280 } }, today);
    expect(pick).toMatchObject({ monthKey: "2027-01", nights: 10 });
  });
});

describe("radar: no sirve salidas pasadas (#9)", () => {
  it("filtra ofertas viejas al leer la foto", () => {
    const snap = {
      origin: "BUE",
      updatedAt: "2026-10-01T00:00:00Z",
      routes: 2,
      stats: { deals: 0, down: 0, up: 0, minimums: 0 },
      items: [
        { destinationId: "rio", depart: "2026-10-05" },
        { destinationId: "mendoza", depart: "2026-11-05" },
      ],
      byMonth: { rio: { "2026-10": { p: 100, dep: "2026-10-05" } }, mendoza: { "2026-11": { p: 90, dep: "2026-11-05" } } },
      live: true,
    } as unknown as RadarSnapshot;
    const out = withoutPastDepartures(snap, today);
    expect(out.items.map((i) => i.destinationId)).toEqual(["mendoza"]);
    expect(Object.keys(out.byMonth)).toEqual(["mendoza"]);
  });
});

describe("pesos: viajes dentro de Argentina al dólar oficial (#8)", () => {
  it("elige la cotización según el destino", () => {
    expect(isDomestic(bariloche.region)).toBe(true);
    expect(isDomestic(rio.region)).toBe(false);
    expect(pesoRate({ card: 1950, official: 1500 }, true)).toBe(1500);
    expect(pesoRate({ card: 1950, official: 1500 }, false)).toBe(1950);
    // Sin oficial, el tarjeta sin la percepción del 30 %.
    expect(pesoRate({ card: 1950 }, true)).toBe(1500);
    expect(formatMoney(100, "ARS", pesoRate({ card: 1950, official: 1500 }, true))).toBe(`$ ${(150000).toLocaleString("es-AR")}`);
    expect(pesoHint("ARS", true)).toBe("En pesos, sin percepciones");
    expect(pesoHint("ARS", false)).toBe("En pesos, con dólar tarjeta");
    expect(pesoHint("USD", true)).toBe("");
  });

  it("un presupuesto en pesos rinde más en destinos de Argentina", () => {
    const req = { ...base, exclude: only("bariloche"), when: { kind: "months" as const, months: [{ month: 3, year: 2027 }] } };
    const cost = tripCost("BUE", bariloche, 3, 7, 2, "mid");
    // Con el presupuesto convertido al tarjeta no entra; al oficial, sí.
    const tight = { ...req, budgetUSD: Math.round(cost.total * 0.8) };
    expect(find(explore(tight, undefined, today), "bariloche")).toBeUndefined();
    const domestic = explore({ ...tight, domesticBudgetUSD: Math.round(cost.total * 0.8 * 1.3) }, undefined, today);
    expect(find(domestic, "bariloche")).toBeDefined();
  });
});
