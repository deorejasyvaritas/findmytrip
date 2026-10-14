import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../server/data/destinations.ts";
import { tripCost } from "../server/engine.ts";
import { estimateTrip, lowest } from "../shared/compare.ts";

describe("estimateTrip", () => {
  it("da lo mismo que tripCost del servidor", () => {
    const party = { adults: 2, childAges: [5], bags: "checked1" as const };
    for (const dest of DESTINATIONS.slice(0, 10)) {
      for (const month of [1, 7]) {
        const server = tripCost("BUE", dest, month, 6, party, "mid", 500);
        const web = estimateTrip(dest, 500, month, 6, party, "mid");
        expect(web.total).toBe(server.total);
        expect(web.lodging).toBe(server.lodging);
        expect(web.daily).toBe(server.daily);
      }
    }
  });
});

describe("lowest", () => {
  it("marca el menor y los empates", () => {
    expect([...lowest([300, 200, 200])]).toEqual([1, 2]);
  });
  it("no marca nada si todos son iguales o hay un solo dato", () => {
    expect(lowest([100, 100]).size).toBe(0);
    expect(lowest([100, null]).size).toBe(0);
  });
});
