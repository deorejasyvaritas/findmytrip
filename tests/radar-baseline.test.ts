import { afterEach, describe, expect, it, vi } from "vitest";
import { useCacheStore } from "../server/cache.ts";
import { getDestination } from "../server/data/destinations.ts";
import { upcomingMonths } from "../server/engine.ts";
import { realPrices } from "../server/providers/explore.ts";
import { MAX_UNCACHED_MONTHS } from "../server/providers/flights.ts";
import { pushBaseline, radarMonthFares, runRadar } from "../server/radar.ts";

useCacheStore(undefined); // memoria

const ALL_MONTHS = { monthsPerRun: 6 };

/** Travelpayouts simulado: por mes, destino -> [precio, salida, vuelta]. */
function mockCheap(byMonth: Record<string, Record<string, [number, string, string]>>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (!url.pathname.includes("/v1/prices/cheap")) return Response.json({ success: true, data: {} });
    const month = url.searchParams.get("depart_date")!;
    const data = Object.fromEntries(
      Object.entries(byMonth[month] ?? {}).map(([code, [price, dep, ret]]) => [
        code,
        { "0": { price, airline: "G3", flight_number: 7460, departure_at: `${dep}T08:00:00-03:00`, return_at: `${ret}T10:00:00-03:00` } },
      ]),
    );
    return Response.json({ success: true, data });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const cheapCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter((c) => String(c[0]).includes("/v1/prices/cheap")).length;

afterEach(() => vi.unstubAllGlobals());

describe("precio habitual comparable del radar", () => {
  const t0 = new Date("2026-10-13T12:00:00Z");
  const at = (h: number) => new Date(t0.getTime() + h * 3600000);

  it("no compara contra otro mes: una baja en diciembre se mide contra su estimación", async () => {
    for (const [i, p] of [400, 410, 405].entries()) {
      mockCheap({ "2026-11": { SSA: [p, "2026-11-14", "2026-11-21"] } });
      await runRadar("tok", "COR", at(i * 6), ALL_MONTHS);
    }
    // El más barato ahora está en diciembre: no hay historial de diciembre.
    mockCheap({ "2026-11": { SSA: [400, "2026-11-14", "2026-11-21"] }, "2026-12": { SSA: [300, "2026-12-05", "2026-12-12"] } });
    const snap = await runRadar("tok", "COR", at(24), ALL_MONTHS);
    const ssa = snap.items.find((i) => i.destinationId === "salvador")!;
    expect(ssa).toMatchObject({ priceUSD: 300, baseline: "estimado", isMinimum: false });
    expect(ssa.typicalUSD).not.toBe(405);
    expect(ssa.radarScore).toBeLessThanOrEqual(85);
    // Noviembre sí tiene historial comparable: 400 frente a 405.
    expect(snap.byMonth.salvador["2026-11"]).toMatchObject({ p: 400, t: 405, b: "historial" });
    expect(snap.byMonth.salvador["2026-12"]).toMatchObject({ p: 300, b: "estimado" });
  });

  it("no compara estadías distintas: 14 noches no se miden contra viajes de 7", async () => {
    for (const [i, p] of [400, 410, 405].entries()) {
      mockCheap({ "2026-11": { FLN: [p, "2026-11-14", "2026-11-21"] } });
      await runRadar("tok", "MDZ", at(i * 6), ALL_MONTHS);
    }
    mockCheap({ "2026-11": { FLN: [380, "2026-11-10", "2026-11-24"] } });
    const fln = (await runRadar("tok", "MDZ", at(24), ALL_MONTHS)).items.find((i) => i.destinationId === "florianopolis")!;
    expect(fln.baseline).toBe("estimado");
    expect(fln.isMinimum).toBe(false);

    // Una estadía parecida (8 noches, dentro de ±2) sí es comparable.
    mockCheap({ "2026-11": { FLN: [300, "2026-11-14", "2026-11-22"] } });
    const again = (await runRadar("tok", "MDZ", at(30), ALL_MONTHS)).items.find((i) => i.destinationId === "florianopolis")!;
    expect(again).toMatchObject({ baseline: "historial", typicalUSD: 405, isMinimum: true, discountPct: 26 });
  });

  it("el historial por mes se recorta por antigüedad y cantidad", () => {
    const today = 20000;
    const prev = { a: [[100, 7, today - 40] as [number, number, number], [110, 7, today - 2] as [number, number, number]] };
    const out = pushBaseline(prev, { at: new Date(today * 86400000).toISOString(), d: { a: { p: 120, dep: "2026-11-01", ret: "2026-11-08" }, b: { p: 90 } } }, today);
    expect(out.a).toEqual([[110, 7, today - 2], [120, 7, today]]);
    expect(out.b).toEqual([[90, -1, today]]);
  });
});

describe("/explore sin pasar el límite de CPU", () => {
  const now = new Date();
  const months = upcomingMonths(now).slice(0, 3);
  const key = ({ month, year }: { month: number; year: number }) => `${year}-${String(month).padStart(2, "0")}`;
  const day = (m: { month: number; year: number }, d: number) => `${key(m)}-${String(d).padStart(2, "0")}`;

  it("baja como mucho un mes nuevo por búsqueda; el resto queda estimado hasta la próxima", async () => {
    const fn = mockCheap(Object.fromEntries(months.map((m, i) => [key(m), { CUN: [600 + i, day(m, 10), day(m, 17)] }])));
    const r = await realPrices({ travelpayouts: "t" }, "SLA", months, null);
    expect(cheapCalls(fn)).toBe(MAX_UNCACHED_MONTHS);
    expect(r.forDest(getDestination("cancun")!)).toEqual([{ month: months[0].month, flightPP: 600, source: "aviasales" }]);

    // La siguiente búsqueda usa lo cacheado y baja un mes más.
    const r2 = await realPrices({ travelpayouts: "t" }, "SLA", months, null);
    expect(cheapCalls(fn)).toBe(2);
    expect(r2.forDest(getDestination("cancun")!).map((p) => p.flightPP)).toEqual([600, 601]);
  });

  it("en ciudades del radar usa su foto compacta y no baja nada", async () => {
    mockCheap(Object.fromEntries(months.map((m, i) => [key(m), { MCZ: [200 + i, day(m, 10), day(m, 17)], GIG: [150, day(m, 3), day(m, 9)] }])));
    await runRadar("tok", "ROS", now, ALL_MONTHS);
    expect(Object.keys(await radarMonthFares("ROS", months.map(key)))).toEqual(months.map(key));

    const fn = mockCheap({});
    const r = await realPrices({ travelpayouts: "t" }, "ROS", months, null);
    expect(cheapCalls(fn)).toBe(0);
    expect(r.forDest(getDestination("maceio")!).map((p) => p.flightPP)).toEqual([200, 201, 202]);
    expect(r.forDest(getDestination("rio")!)[0]).toMatchObject({ flightPP: 150, source: "aviasales" });
  });

  it("no usa meses del radar que no se revisan hace más de 30 h", async () => {
    const later = now.getTime() + 31 * 3600000;
    expect(await radarMonthFares("ROS", months.map(key), later)).toEqual({});
  });
});
