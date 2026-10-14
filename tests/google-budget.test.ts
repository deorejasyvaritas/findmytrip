import { afterEach, describe, expect, it, vi } from "vitest";
import { useCacheStore, type KVStore } from "../server/cache.ts";
import { getDestination } from "../server/data/destinations.ts";
import { budgetKey, budgetLeft, canUseGoogle, googleSearch, MONTHLY_SEARCHES, RESERVE, spendGoogle } from "../server/google-budget.ts";
import { googleFlights } from "../server/providers/flights.ts";

function fakeKV(failGet: (k: string) => boolean = () => false) {
  const data = new Map<string, string>();
  const kv: KVStore & { data: Map<string, string> } = {
    data,
    get: async (k) => {
      if (failGet(k)) throw new Error("KV caído");
      return data.has(k) ? JSON.parse(data.get(k)!) : null;
    },
    put: vi.fn(async (k: string, v: string) => void data.set(k, v)),
  };
  return kv;
}

/** SerpApi simulado: la cuenta dice `left` búsquedas; cuenta las búsquedas reales. */
function mockSerp(left: number | null) {
  const searches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("account.json")) return left == null ? new Response("", { status: 500 }) : Response.json({ total_searches_left: left });
      searches.push(url);
      return Response.json({ best_flights: [{ price: 500, flights: [{ airline: "AR" }] }] });
    }),
  );
  return searches;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useCacheStore(undefined);
});

describe("presupuesto de Google (SerpApi)", () => {
  it("usa el menor entre la cuenta y el contador propio; sin datos, no busca", () => {
    expect(budgetLeft(200, 10)).toBe(200);
    expect(budgetLeft(200, 240)).toBe(MONTHLY_SEARCHES - 240);
    expect(budgetLeft(null, 0)).toBeNull();
    expect(budgetLeft(100, null)).toBeNull();
  });

  it("si no se puede consultar la cuenta, no gasta búsquedas", async () => {
    useCacheStore(fakeKV());
    const searches = mockSerp(null);
    expect(await canUseGoogle("k")).toBe(false);
    expect(await googleSearch("k", new URLSearchParams({ engine: "google_flights" }), "test")).toBeNull();
    expect(searches).toHaveLength(0);
  });

  it("si KV no responde, no gasta búsquedas", async () => {
    useCacheStore(fakeKV((k) => k.startsWith("gbudget:")));
    mockSerp(200);
    expect(await canUseGoogle("k")).toBe(false);
  });

  it("cuenta cada búsqueda real y no los aciertos de caché", async () => {
    const kv = fakeKV();
    useCacheStore(kv);
    const searches = mockSerp(200);
    kv.data.set(budgetKey(), "3");
    const rio = getDestination("rio")!;
    expect((await googleFlights("k", "BUE", rio, "2031-03-10", "2031-03-17"))?.lowestUSD).toBe(500);
    expect((await googleFlights("k", "BUE", rio, "2031-03-10", "2031-03-17"))?.lowestUSD).toBe(500);
    expect(searches).toHaveLength(1);
    expect(kv.data.get(budgetKey())).toBe("4");
    // Lo guardado en caché es la cotización armada, no la respuesta cruda.
    const stored = JSON.parse(kv.data.get("gf2:BUE-RIO-2031-03-10-2031-03-17")!);
    expect(stored).toMatchObject({ lowestUSD: 500 });
    expect(stored.best_flights).toBeUndefined();
  });

  // Va última: el contador también queda en memoria del módulo.
  it("frena al llegar a la reserva según el contador propio, aunque la cuenta diga que hay más", async () => {
    const kv = fakeKV();
    useCacheStore(kv);
    mockSerp(200);
    kv.data.set(budgetKey(), String(MONTHLY_SEARCHES - RESERVE - 1));
    expect(await canUseGoogle("k")).toBe(true);
    await spendGoogle();
    expect(kv.data.get(budgetKey())).toBe(String(MONTHLY_SEARCHES - RESERVE));
    expect(await canUseGoogle("k")).toBe(false);
  });
});
