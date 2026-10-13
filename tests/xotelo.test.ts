import { afterEach, describe, expect, it, vi } from "vitest";
import { DESTINATIONS, getDestination } from "../server/data/destinations.ts";
import { TA_GEO, spread, xoteloHotels } from "../server/providers/xotelo.ts";

afterEach(() => vi.unstubAllGlobals());

describe("Xotelo (hoteles sin cuota)", () => {
  it("tiene ubicación de TripAdvisor para todos los destinos", () => {
    for (const d of DESTINATIONS) expect(TA_GEO[d.id], d.id).toMatch(/^g\d+$/);
  });

  it("reparte la elección entre baratos y caros", () => {
    const hotels = Array.from({ length: 20 }, (_, i) => ({ min: i * 10, rating: 4 }));
    const picked = spread(hotels, 5);
    expect(picked.map((h) => h.min)).toEqual([0, 50, 100, 140, 190]);
  });

  it("trae el mejor precio por hotel y descarta los de otro lugar", async () => {
    const aruba = getDestination("aruba")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/list"))
          return Response.json({
            error: null,
            result: {
              list: [
                ...[1, 2, 3, 4].map((i) => ({
                  key: `g147247-d${i}`,
                  name: `Hotel ${i}`,
                  url: `/Hotel_Review-g147247-d${i}.html`,
                  review_summary: { rating: 4.5, count: 100 },
                  price_ranges: { minimum: 100 * i, maximum: 150 * i },
                  geo: { latitude: 12.55, longitude: -70.05 },
                })),
                { key: "g1-d9", name: "Llao Llao", geo: { latitude: -41.05, longitude: -71.53 }, review_summary: { rating: 5 } },
              ],
            },
          });
        const i = Number(new URL(url).searchParams.get("hotel_key")!.split("-d")[1]);
        return Response.json({
          error: null,
          result: { rates: [{ name: "Booking.com", rate: 100 * i, tax: 10 }, { name: "Agoda", rate: 100 * i - 5, tax: 10 }] },
        });
      }),
    );
    const q = await xoteloHotels(aruba, "2027-02-15", 10);
    expect(q?.source).toBe("xotelo");
    expect(q?.hotels.map((h) => h.name)).toEqual(["Hotel 1", "Hotel 2", "Hotel 3", "Hotel 4"]);
    expect(q?.hotels[0]).toMatchObject({ nightlyUSD: 105, totalUSD: 1050, site: "Agoda", link: "https://www.tripadvisor.com/Hotel_Review-g147247-d1.html" });
    expect(q?.checkout).toBe("2027-02-25");
  });
});
