import { afterEach, describe, expect, it, vi } from "vitest";
import { escapes } from "../server/escapes.ts";

afterEach(() => vi.unstubAllGlobals());

describe("escapadas de fin de semana largo", () => {
  it("arma opciones cercanas con precio real para las fechas exactas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const depart = url.searchParams.get("depart_date") ?? url.searchParams.get("departure_at")!;
        const ret = url.searchParams.get("return_date") ?? url.searchParams.get("return_at")!;
        if (url.pathname.includes("/v1/prices/cheap"))
          return Response.json({
            success: true,
            data: {
              RIO: { 0: { price: 320, airline: "G3", departure_at: `${depart}T20:00:00-03:00`, return_at: `${ret}T18:00:00-03:00` } },
              MAD: { 0: { price: 900, departure_at: `${depart}T20:00:00-03:00`, return_at: `${ret}T18:00:00-03:00` } }, // lejos: no es escapada
              MDZ: { 0: { price: 150, departure_at: "2030-01-01T10:00:00-03:00", return_at: "2030-01-05T10:00:00-03:00" } }, // otras fechas
            },
          });
        return Response.json({ success: true, data: [] });
      }),
    );
    const weekends = await escapes("tok", "BUE", new Date("2026-10-13T12:00:00Z"));
    expect(weekends[0]).toMatchObject({ from: "2026-11-21", to: "2026-11-23" });
    const opts = weekends[0].options;
    expect(opts.map((o) => o.destinationId)).toEqual(["rio"]);
    expect(opts[0]).toMatchObject({ flightUSD: 320, depart: "2026-11-20", ret: "2026-11-23", nights: 3 });
    expect(opts[0].totalPerPersonUSD).toBe(opts[0].flightUSD + opts[0].lodgingUSD);
  });
});
