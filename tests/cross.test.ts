import { afterEach, describe, expect, it, vi } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { crossAndFly } from "../server/cross.ts";

afterEach(() => vi.unstubAllGlobals());

describe("cruzá y volá", () => {
  it("compara salir desde otra ciudad sumando el cruce", async () => {
    const prices: Record<string, Record<string, number>> = {
      BUE: { MAD: 1200, SCL: 180 },
      MVD: { MAD: 900 },
      SCL: { MAD: 1150 },
      SAO: {},
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const origin = new URL(String(input)).searchParams.get("origin")!;
        const data = Object.fromEntries(Object.entries(prices[origin] ?? {}).map(([k, p]) => [k, { 0: { price: p } }]));
        return Response.json({ success: true, data });
      }),
    );
    const r = await crossAndFly("tok", "BUE", getDestination("madrid")!, "2031-03");
    expect(r.baseUSD).toBe(1200);
    expect(r.options[0]).toMatchObject({ origin: "MVD", crossingSource: "estimado", totalUSD: 1020, savingUSD: 180 });
    // Santiago: vuelo real BUE-SCL (180) + 1150 = 1330, más caro.
    expect(r.options[1]).toMatchObject({ origin: "SCL", crossingUSD: 180, crossingSource: "aviasales", savingUSD: -130 });
    expect(r.options).toHaveLength(2);
  });
});
