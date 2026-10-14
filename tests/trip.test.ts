import { afterEach, describe, expect, it, vi } from "vitest";
import { nearestAirports, pickAirport, planTrip } from "../server/trip.ts";

afterEach(() => vi.unstubAllGlobals());

const AIRPORTS = [
  { code: "REC", city_code: "REC", name: "Guararapes", coordinates: { lat: -8.126, lon: -34.923 }, flightable: true, iata_type: "airport" },
  { code: "MCZ", city_code: "MCZ", name: "Palmares", coordinates: { lat: -9.511, lon: -35.792 }, flightable: true, iata_type: "airport" },
  { code: "CAU", city_code: "CAU", name: "Caruaru", coordinates: { lat: -8.282, lon: -36.0 }, flightable: true, iata_type: "airport" },
  { code: "XXX", city_code: "XXX", name: "Cerrado", coordinates: { lat: -8.6, lon: -35.1 }, flightable: false, iata_type: "airport" },
];

describe("viaje con paradas", () => {
  it("elige entre los aeropuertos cercanos el de vuelo más barato", () => {
    const rows = AIRPORTS.filter((a) => a.flightable).map((a) => [a.code, a.city_code, a.coordinates.lat, a.coordinates.lon, a.name] as [string, string, number, number, string]);
    const near = nearestAirports(rows, -9.012, -35.222); // Maragogi
    expect(near[0].code).toBe("MCZ");
    expect(pickAirport(near, new Map([["REC", 400], ["MCZ", 520]]))?.code).toBe("REC");
    expect(pickAirport(near, new Map())?.code).toBe("MCZ");
  });

  it("arma Porto de Galinhas + Maragogi: ida y vuelta a Recife y traslado por tierra", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.includes("airports.json")) return Response.json(AIRPORTS);
        if (url.pathname.includes("/v1/prices/cheap")) return Response.json({ success: true, data: { REC: { 0: { price: 380 } }, MCZ: { 0: { price: 450 } } } });
        const dep = url.searchParams.get("departure_at")!;
        return Response.json({
          success: true,
          data: [
            {
              origin: url.searchParams.get("origin"),
              destination: url.searchParams.get("destination"),
              price: 410,
              airline: "G3",
              flight_number: 1,
              departure_at: `${dep.length === 10 ? dep : `${dep}-01`}T08:00:00-03:00`,
              return_at: url.searchParams.get("return_at") ? `${url.searchParams.get("return_at")}T20:00:00-03:00` : undefined,
              transfers: 1,
              link: "/search/x",
            },
          ],
        });
      }),
    );
    const plan = await planTrip("tok", {
      origin: "BUE",
      depart: "2031-01-10",
      stops: [
        { name: "Porto de Galinhas", country: "Brasil", lat: -8.505, lon: -35.006, nights: 4 },
        { name: "Maragogi", country: "Brasil", lat: -9.012, lon: -35.222, nights: 5 },
      ],
    });
    expect(plan.ret).toBe("2031-01-19");
    expect(plan.stops.map((s) => [s.checkin, s.checkout, s.airport?.code])).toEqual([
      ["2031-01-10", "2031-01-14", "REC"],
      ["2031-01-14", "2031-01-19", "REC"],
    ]);
    expect(plan.legs.map((l) => [l.role, l.kind])).toEqual([
      ["out", "flight"],
      ["between", "ground"],
    ]);
    expect(plan.legs[0]).toMatchObject({ from: "BUE", to: "REC", returnDate: "2031-01-19", price: 410 });
    expect(plan.legs[1].km).toBeGreaterThan(40);
    expect(plan.legs[1].mapsUrl).toContain("google.com/maps/dir");
  });
});

describe("precio del vuelo sin dato para el día exacto", () => {
  it("usa el día vecino con precio real y dice cuál es", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.includes("airports.json")) return Response.json(AIRPORTS);
        if (url.pathname.includes("/v1/prices/cheap")) return Response.json({ success: true, data: {} });
        const dep = url.searchParams.get("departure_at")!;
        // Fecha exacta: sin datos. Mes completo: un vuelo dos días después, misma cantidad de noches.
        if (dep.length === 10) return Response.json({ success: true, data: [] });
        return Response.json({
          success: true,
          data: [{ origin: "BUE", destination: "REC", price: 333, airline: "G3", departure_at: "2031-05-12T08:00:00-03:00", return_at: "2031-05-16T20:00:00-03:00", transfers: 0 }],
        });
      }),
    );
    const plan = await planTrip("tok", {
      origin: "BUE",
      depart: "2031-05-10",
      stops: [{ name: "Porto de Galinhas", country: "Brasil", lat: -8.505, lon: -35.006, nights: 4 }],
    });
    expect(plan.legs[0]).toMatchObject({ priceKind: "cercano", priceDate: "2031-05-12", price: 333, priceSource: "aviasales" });
  });
});
