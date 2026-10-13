import { afterEach, describe, expect, it, vi } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { flightCalendar, googleFlights, livePriceLookup } from "../server/providers/flights.ts";
import { googleHotels } from "../server/providers/hotels.ts";
import { usdArsRate } from "../server/providers/fx.ts";

// Simula las APIs externas: cada test responde según la URL pedida.
function mockFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const body = handler(String(input));
    return body === undefined ? new Response("", { status: 500 }) : Response.json(body);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const rio = getDestination("rio")!;

describe("Travelpayouts", () => {
  it("mezcla precios reales con estimados en el calendario", async () => {
    mockFetch(() => ({
      success: true,
      data: [
        { price: 310, airline: "G3", departure_at: "2027-03-10T08:00:00-03:00", return_at: "2027-03-17T10:00:00-03:00", transfers: 0 },
        { price: 290, airline: "LA", departure_at: "2027-03-10T09:00:00-03:00", return_at: "2027-03-30T10:00:00-03:00", transfers: 1 },
      ],
    }));
    const cal = await flightCalendar("tok", "BUE", rio, "2027-03", 7);
    const day = cal.days.find((d) => d.date === "2027-03-10")!;
    expect(cal.live).toBe(true);
    expect(day).toMatchObject({ priceUSD: 310, source: "en vivo", airline: "G3" }); // la estadía de 20 noches se descarta
    expect(cal.cheapest?.source).toBe("en vivo");
    expect(cal.days.some((d) => d.source === "estimado")).toBe(true);
  });

  it("sin token usa estimaciones y no llama a la API", async () => {
    const fn = mockFetch(() => ({}));
    const cal = await flightCalendar(undefined, "BUE", rio, "2027-04", 7);
    expect(cal.live).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("lookup de precios por destino y mes", async () => {
    mockFetch((url) => (url.includes("depart_date=2027-05") ? { success: true, data: { RIO: { "0": { price: 280 }, "1": { price: 250 } } } } : undefined));
    const lookup = await livePriceLookup("tok", "BUE", [{ month: 5, year: 2027 }]);
    expect(lookup?.("RIO", 5)).toBe(250);
    expect(lookup?.("CUN", 5)).toBeUndefined();
  });
});

describe("SerpApi", () => {
  it("Google Flights: ofertas ordenadas y rango habitual", async () => {
    const fn = mockFetch(() => ({
      best_flights: [{ price: 420, total_duration: 180, layovers: [], flights: [{ airline: "Aerolíneas Argentinas", departure_airport: { time: "2027-03-10 08:00" } }] }],
      other_flights: [{ price: 380, total_duration: 300, layovers: [{}], flights: [{ airline: "GOL" }, { airline: "GOL" }] }],
      price_insights: { lowest_price: 380, price_level: "low", typical_price_range: [400, 600] },
      search_metadata: { google_flights_url: "https://www.google.com/travel/flights?x" },
    }));
    const q = await googleFlights("key", "BUE", rio, "2027-03-10", "2027-03-17");
    expect(String(fn.mock.calls[0][0])).toContain("departure_id=EZE%2CAEP");
    expect(String(fn.mock.calls[0][0])).toContain("arrival_id=GIG%2CSDU");
    expect(q?.lowestUSD).toBe(380);
    expect(q?.offers[0]).toMatchObject({ airlines: ["GOL"], stops: 1 });
    expect(q?.typicalRangeUSD).toEqual([400, 600]);
  });

  it("Google Hotels: hoteles y precios por estilo", async () => {
    mockFetch(() => ({
      properties: [50, 80, 120, 200, 400].map((p, i) => ({
        name: `Hotel ${i}`,
        rate_per_night: { extracted_lowest: p },
        total_rate: { extracted_lowest: p * 7 },
        overall_rating: 4.2,
        extracted_hotel_class: 3,
      })),
    }));
    const q = await googleHotels("key", rio, "2027-03-10", 7, 2);
    expect(q?.hotels).toHaveLength(5);
    expect(q?.tiers).toEqual({ low: 80, mid: 120, high: 200 });
    expect(q?.checkout).toBe("2027-03-17");
  });
});

describe("dolarapi", () => {
  it("usa el dólar tarjeta y cae al respaldo si falla", async () => {
    mockFetch(() => undefined);
    expect((await usdArsRate(1500)).rate).toBe(1500);
    mockFetch(() => ({ nombre: "Tarjeta", venta: 1876.5 }));
    expect(await usdArsRate(1500)).toEqual({ rate: 1877, source: "Dólar Tarjeta (dolarapi.com)" });
  });
});
