import { afterEach, describe, expect, it, vi } from "vitest";
import { nearestDay, priceLeg, refreshLeg } from "../server/trip.ts";
import { bestPerDay } from "../server/providers/flights.ts";
import { hotelDistanceKm, hotelLinks } from "../shared/hotel-links.ts";

afterEach(() => vi.unstubAllGlobals());

type Item = { price: number; departure_at: string; return_at?: string; airline?: string; transfers?: number; link?: string };

/**
 * Data API falsa: `exact` responde a la fecha exacta, `month` al mes completo
 * (prices_for_dates y grouped_prices). Google responde con `google` si se pasa.
 */
function mockApis(p: { exact?: (from: string, to: string) => Item[]; month?: (from: string, to: string) => Item[]; google?: number | null }) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.hostname + url.pathname + url.search);
    const from = url.searchParams.get("origin") ?? "";
    const to = url.searchParams.get("destination") ?? "";
    if (url.hostname === "serpapi.com") {
      if (url.pathname.includes("account")) return Response.json({ total_searches_left: 200 });
      return Response.json(p.google ? { best_flights: [{ price: p.google, layovers: [], flights: [{ airline: "GOL" }] }], search_metadata: { google_flights_url: "https://g.co/f" } } : { best_flights: [] });
    }
    const dep = url.searchParams.get("departure_at") ?? "";
    if (url.pathname.includes("grouped_prices")) {
      const items = p.month?.(from, to) ?? [];
      return Response.json({ success: true, data: Object.fromEntries(items.map((i) => [i.departure_at.slice(0, 10), i])) });
    }
    if (dep.length === 10) return Response.json({ success: true, data: p.exact?.(from, to) ?? [] });
    return Response.json({ success: true, data: p.month?.(from, to) ?? [] });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("precio de cada tramo: exacto, Google, cercano, mes (también solo ida)", () => {
  it("solo ida con precio exacto en Aviasales", async () => {
    mockApis({ exact: () => [{ price: 254, departure_at: "2032-02-02T10:00:00-03:00", airline: "G3", transfers: 1, link: "/search/x" }] });
    const r = await priceLeg({ token: "tok", from: "BUE", to: "REC", date: "2032-02-02", back: null });
    expect(r).toMatchObject({ price: 254, priceKind: "exacto", priceSource: "aviasales", airline: "G3", stops: 1 });
  });

  it("sin precio exacto: Google Flights solo ida antes que el día vecino", async () => {
    const calls = mockApis({
      month: () => [{ price: 199, departure_at: "2032-03-03T10:00:00-03:00" }],
      google: 261,
    });
    const r = await priceLeg({ token: "tok", googleKey: "key", from: "BUE", to: "SSA", date: "2032-03-02", back: null });
    expect(r).toMatchObject({ price: 261, priceKind: "exacto", priceSource: "google", link: "https://g.co/f" });
    const g = calls.find((c) => c.startsWith("serpapi.com/search.json"))!;
    expect(g).toContain("type=2");
    expect(g).not.toContain("return_date");
  });

  it("sin exacto ni Google: el día vecino (±3) con su fecha", async () => {
    mockApis({ month: () => [{ price: 222, departure_at: "2032-04-04T10:00:00-03:00" }] });
    const r = await priceLeg({ token: "tok", from: "BUE", to: "FOR", date: "2032-04-02", back: null });
    expect(r).toMatchObject({ price: 222, priceKind: "cercano", priceDate: "2032-04-04" });
  });

  it("sin nada en ±3: el día del mes más cercano (hasta 7 días) y si no, lo más barato del mes", async () => {
    mockApis({
      month: (_f, to) =>
        to === "NAT"
          ? [
              { price: 300, departure_at: "2032-05-08T10:00:00-03:00" },
              { price: 150, departure_at: "2032-05-25T10:00:00-03:00" },
              // Ida y vuelta: no cuenta para un tramo solo ida.
              { price: 90, departure_at: "2032-05-09T10:00:00-03:00", return_at: "2032-05-15T10:00:00-03:00" },
            ]
          : [
              { price: 300, departure_at: "2032-05-20T10:00:00-03:00" },
              { price: 180, departure_at: "2032-05-28T10:00:00-03:00" },
            ],
    });
    const near = await priceLeg({ token: "tok", from: "BUE", to: "NAT", date: "2032-05-02", back: null });
    expect(near).toMatchObject({ price: 300, priceKind: "cercano", priceDate: "2032-05-08" });
    const month = await priceLeg({ token: "tok", from: "BUE", to: "JPA", date: "2032-05-02", back: null });
    expect(month).toMatchObject({ price: 180, priceKind: "mes", priceDate: "2032-05-28", priceSource: "aviasales" });
  });

  it("si el aeropuerto elegido no tiene nada, prueba los cercanos", async () => {
    mockApis({ month: (_f, to) => (to === "MCZ" ? [{ price: 310, departure_at: "2032-06-02T10:00:00-03:00" }] : []) });
    const r = await priceLeg({ token: "tok", from: "BUE", to: "REC", date: "2032-06-02", back: null, altTo: ["MCZ"] });
    expect(r).toMatchObject({ from: "BUE", to: "MCZ", price: 310, priceKind: "exacto" });
  });

  it("sin nada en ningún lado queda sin precio", async () => {
    mockApis({});
    const r = await priceLeg({ token: "tok", from: "BUE", to: "THE", date: "2032-07-02", back: null });
    expect(r.price).toBeNull();
    expect(r.priceKind).toBeNull();
  });
});

describe("volver a mirar un tramo después de Aviasales", () => {
  it("trae el precio exacto del día sin la caché larga", async () => {
    let price = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: price ? [{ price, departure_at: "2032-08-02T10:00:00-03:00", airline: "LA", link: "/s/1" }] : [] })),
    );
    expect((await refreshLeg("tok", "123", "BUE", "REC", "2032-08-02", null)).price).toBeNull();
    price = 254;
    expect(await refreshLeg("tok", "123", "BUE", "REC", "2032-08-02", null)).toMatchObject({
      price: 254,
      priceKind: "exacto",
      link: "https://www.aviasales.com/s/1?marker=123",
    });
  });
});

describe("ayudas de precio por día", () => {
  it("separa solo ida de ida y vuelta y se queda con el más barato por día", () => {
    const items = [
      { price: 200, departure_at: "2032-02-02T08:00" },
      { price: 180, departure_at: "2032-02-02T20:00" },
      { price: 100, departure_at: "2032-02-03T08:00", return_at: "2032-02-10T08:00" },
    ];
    expect(bestPerDay(items, "2032-02", null)).toEqual([["2032-02-02", 180]]);
    expect(bestPerDay(items, "2032-02", 7)).toEqual([["2032-02-03", 100]]);
    expect(nearestDay([["2032-02-01", 50], ["2032-02-05", 40]], "2032-02-03")).toEqual(["2032-02-05", 40]);
  });
});

describe("links de cada hotel", () => {
  it("Xotelo: TripAdvisor directo y búsqueda del sitio oficial", () => {
    const l = hotelLinks({ name: "Hotel Mar", link: "https://www.tripadvisor.com/Hotel_Review-x", tripadvisorUrl: "https://www.tripadvisor.com/Hotel_Review-x", officialUrl: null }, "Recife Brasil");
    expect(l.tripadvisor).toBe("https://www.tripadvisor.com/Hotel_Review-x");
    expect(l.officialIsSearch).toBe(true);
    expect(l.official).toBe("https://www.google.com/search?q=Hotel+Mar+Recife+Brasil+sitio+oficial");
    expect(l.maps).toBe("https://www.google.com/maps/search/?api=1&query=Hotel+Mar+Recife+Brasil");
  });

  it("Google Hotels: sitio oficial del hotel y búsqueda en TripAdvisor", () => {
    const l = hotelLinks({ name: "Pousada Sol", link: "https://pousadasol.com.br", officialUrl: "https://pousadasol.com.br" }, "Maragogi");
    expect(l.official).toBe("https://pousadasol.com.br");
    expect(l.officialIsSearch).toBe(false);
    expect(l.tripadvisor).toBe("https://www.tripadvisor.com/Search?q=Pousada+Sol+Maragogi");
  });

  it("distancia a la parada solo si hay coordenadas", () => {
    expect(hotelDistanceKm({ lat: null, lon: null }, -8, -35)).toBeNull();
    expect(hotelDistanceKm({ lat: -8.01, lon: -35 }, -8, -35)).toBeCloseTo(1.1, 1);
  });
});
