import { afterEach, describe, expect, it, vi } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { flightCalendar, googleFlights } from "../server/providers/flights.ts";
import { realPrices } from "../server/providers/explore.ts";
import { googleHotels } from "../server/providers/hotels.ts";
import { usdArsRate } from "../server/providers/fx.ts";

// Simula las APIs externas: cada test responde según la URL pedida.
// La cuenta de SerpApi siempre tiene búsquedas de sobra.
function mockFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("serpapi.com/account.json")) return Response.json({ total_searches_left: 200 });
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

  it("completa el calendario con otras fuentes de Aviasales y estadías parecidas", async () => {
    mockFetch((url) => {
      if (url.includes("/v1/prices/calendar"))
        return { success: true, data: { "2027-05-12": { price: 280, airline: "AR", transfers: 0, departure_at: "2027-05-12T08:00:00-03:00", return_at: "2027-05-19T08:00:00-03:00" } } };
      if (url.includes("month-matrix"))
        return { success: true, data: [{ value: 260, depart_date: "2027-05-20", return_date: "2027-05-28", number_of_changes: 1 }] };
      return { success: true, data: [] };
    });
    const cal = await flightCalendar("tok", "BUE", rio, "2027-05", 7);
    expect(cal.days.find((d) => d.date === "2027-05-12")).toMatchObject({ priceUSD: 280, source: "en vivo", airline: "AR" });
    // Sin precio para 7 noches ese día: usa el de 8 noches con su fecha de vuelta real.
    expect(cal.days.find((d) => d.date === "2027-05-20")).toMatchObject({ priceUSD: 260, returnDate: "2027-05-28", source: "en vivo" });
  });

  it("sin token usa estimaciones y no llama a la API", async () => {
    const fn = mockFetch(() => ({}));
    const cal = await flightCalendar(undefined, "BUE", rio, "2027-04", 7);
    expect(cal.live).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("Aviasales completa los destinos que Google no trajo", async () => {
    mockFetch((url) => {
      if (url.includes("google_travel_explore"))
        return {
          destinations: [
            { name: "Río de Janeiro", country: "Brasil", destination_airport: { code: "GIG" }, start_date: "2027-05-04", end_date: "2027-05-11", flight_price: 310, hotel_price: 45, airline: "GOL" },
            { name: "Asunción", country: "Paraguay", destination_airport: { code: "ASU" }, start_date: "2027-05-08", end_date: "2027-05-15", flight_price: "$ 250" },
            { name: "Lima", destination_airport: { code: "LIM" }, start_date: "2027-07-01", flight_price: 400 }, // otro mes
          ],
        };
      if (url.includes("depart_date=2027-05")) return { success: true, data: { RIO: { "0": { price: 200 } }, CUN: { "0": { price: 700 } } } };
      return undefined;
    });
    const r = await realPrices({ serpapi: "k", travelpayouts: "t" }, "BUE", [{ month: 5, year: 2027 }], 5);
    expect(r.forDest(getDestination("rio")!)).toEqual([
      expect.objectContaining({ source: "google", flightPP: 310, hotelNight: 45, depart: "2027-05-04" }),
    ]);
    expect(r.forDest(getDestination("cancun")!)).toEqual([{ month: 5, flightPP: 700, source: "aviasales" }]);
    expect(r.forDest(getDestination("lima")!)).toEqual([]);
    expect(r.extra.map((e) => [e.name, e.flightPP])).toEqual([["Asunción", 250]]);
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
    const search = String(fn.mock.calls.find((c) => String(c[0]).includes("search.json"))?.[0]);
    expect(search).toContain("departure_id=EZE%2CAEP");
    expect(search).toContain("arrival_id=GIG%2CSDU");
    expect(search).toContain("api_key=key");
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
        gps_coordinates: { latitude: -22.97, longitude: -43.18 },
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

describe("fotos", () => {
  it("usa anchos estándar de Wikimedia y el original si es chico", async () => {
    const { pickImage } = await import("../server/providers/photos.ts");
    expect(
      pickImage({
        thumbnail: { source: "https://upload.wikimedia.org/x/thumb/a/ab/Rio.jpg/330px-Rio.jpg" },
        originalimage: { source: "https://upload.wikimedia.org/x/a/ab/Rio.jpg", width: 4000 },
      }),
    ).toBe("https://upload.wikimedia.org/x/thumb/a/ab/Rio.jpg/960px-Rio.jpg");
    expect(pickImage({ originalimage: { source: "https://upload.wikimedia.org/x/a/ab/Chico.jpg", width: 640 } })).toBe(
      "https://upload.wikimedia.org/x/a/ab/Chico.jpg",
    );
    expect(pickImage(null)).toBeNull();
  });
});
