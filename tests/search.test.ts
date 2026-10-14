import { afterEach, describe, expect, it, vi } from "vitest";
import { searchFlights, searchMulti, searchPlaces } from "../server/search.ts";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(handler: (url: URL) => unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL) => Response.json(handler(new URL(String(input)))));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ticket = (o: Partial<Record<string, unknown>>) => ({
  origin: "BUE",
  destination: "MAD",
  origin_airport: "EZE",
  destination_airport: "MAD",
  price: 900,
  airline: "UX",
  flight_number: 42,
  departure_at: "2031-03-10T23:40:00-03:00",
  return_at: "2031-03-20T13:15:00+01:00",
  transfers: 0,
  return_transfers: 1,
  duration_to: 735,
  duration_back: 880,
  link: "/search/BUE1003MAD20031?t=abc",
  ...o,
});

describe("buscador completo", () => {
  it("sugiere ciudades y aeropuertos", async () => {
    mockFetch(() => [
      { type: "city", code: "FLN", name: "Florianópolis", country_name: "Brasil", main_airport_name: "Hercilio Luz" },
      { type: "airport", code: "AEP", name: "Aeroparque", city_name: "Buenos Aires", country_name: "Argentina" },
    ]);
    const r = await searchPlaces("flo-test");
    expect(r[0]).toEqual({ code: "FLN", name: "Florianópolis", type: "city", city: null, country: "Brasil", airport: "Hercilio Luz" });
    expect(r[1]).toMatchObject({ code: "AEP", type: "airport", city: "Buenos Aires" });
    expect(await searchPlaces("a")).toEqual([]);
  });

  it("devuelve vuelos de las fechas exactas con link a Aviasales y una franja de días", async () => {
    mockFetch((url) => {
      const dep = url.searchParams.get("departure_at");
      if (dep === "2031-03-10")
        return {
          success: true,
          data: [ticket({}), ticket({ price: 870, flight_number: 43 }), ticket({ price: 500, departure_at: "2031-03-11T10:00:00-03:00" })],
        };
      return {
        success: true,
        data: [
          ticket({ price: 820, departure_at: "2031-03-08T10:00:00-03:00", return_at: "2031-03-18T10:00:00+01:00" }),
          ticket({ price: 600, departure_at: "2031-03-09T10:00:00-03:00", return_at: "2031-03-30T10:00:00+01:00" }), // otra duración
        ],
      };
    });
    const r = await searchFlights("tok", { origin: "BUE", destination: "MAD", depart: "2031-03-10", ret: "2031-03-20" }, "789588");
    expect(r.results.map((x) => x.price)).toEqual([870, 900]);
    expect(r.results[0]).toMatchObject({ airline: "UX", flightNumber: "UX43", stops: 0, returnStops: 1, durationOut: 735, origin: "EZE" });
    expect(r.results[0].link).toBe("https://www.aviasales.com/search/BUE1003MAD20031?t=abc&marker=789588");
    expect(r.strip).toEqual([
      { date: "2031-03-08", price: 820 },
      { date: "2031-03-10", price: 870 },
    ]);
  });

  it("sin token no busca", async () => {
    const fn = mockFetch(() => ({}));
    const r = await searchFlights(undefined, { origin: "BUE", destination: "MAD", depart: "2031-03-10", ret: null });
    expect(r.results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("multidestino trae opciones por tramo", async () => {
    mockFetch((url) => ({
      success: true,
      data: [ticket({ origin: url.searchParams.get("origin"), destination: url.searchParams.get("destination"), departure_at: `${url.searchParams.get("departure_at")}T10:00:00Z`, return_at: undefined })],
    }));
    const r = await searchMulti("tok", {
      legs: [
        { origin: "BUE", destination: "MAD", date: "2031-04-01" },
        { origin: "MAD", destination: "ROM", date: "2031-04-06" },
      ],
    });
    expect(r).toHaveLength(2);
    expect(r[1].options[0]).toMatchObject({ returnAt: null, price: 900 });
  });
});
