import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateClimate, climateRange, climateSummary, rainText, type OpenMeteoDaily } from "../shared/climate.ts";
import { climateFor } from "../server/providers/climate.ts";
import { useCacheStore } from "../server/cache.ts";

afterEach(() => vi.unstubAllGlobals());

/** Historial sintético: años completos con valores fijos por mes. */
function history(years: number[], perMonth: (m: number) => { hi: number; lo: number; rain: (day: number) => number }): OpenMeteoDaily {
  const d: OpenMeteoDaily = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [] };
  for (const y of years) {
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const v = perMonth(Number(date.slice(5, 7)));
      d.time.push(date);
      d.temperature_2m_max.push(v.hi);
      d.temperature_2m_min.push(v.lo);
      d.precipitation_sum.push(v.rain(Number(date.slice(8, 10))));
    }
  }
  return d;
}

describe("clima esperado", () => {
  it("resume el historial en 12 meses con promedios por mes", () => {
    // Enero: 30/22 y llueve 10 mm los primeros 5 días; julio: 10/2 sin lluvia.
    const daily = history([2022, 2023], (m) =>
      m === 1
        ? { hi: 30, lo: 22, rain: (day) => (day <= 5 ? 10 : 0) }
        : m === 7
          ? { hi: 10, lo: 2, rain: () => 0 }
          : { hi: 20, lo: 12, rain: () => 0.5 },
    );
    const months = aggregateClimate(daily);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ m: 1, tmax: 30, tmin: 22, rainMm: 50, rainDays: 5 });
    expect(months[6]).toMatchObject({ m: 7, tmax: 10, tmin: 2, rainMm: 0, rainDays: 0 });
    // 0,5 mm por día no cuenta como día de lluvia, pero suma al total.
    expect(months[2]).toMatchObject({ rainDays: 0, rainMm: 16 });
  });

  it("ignora valores vacíos sin bajar el promedio", () => {
    const daily = history([2023], () => ({ hi: 25, lo: 15, rain: () => 2 }));
    daily.temperature_2m_max[0] = null;
    daily.precipitation_sum[1] = null;
    expect(aggregateClimate(daily)[0]).toMatchObject({ tmax: 25, rainMm: 62, rainDays: 31 });
  });

  it("describe el mes en palabras simples", () => {
    expect(climateSummary({ tmax: 30, tmin: 24, rainMm: 60, rainDays: 6 }).label).toBe("Calor de playa");
    expect(climateSummary({ tmax: 22, tmin: 12, rainMm: 50, rainDays: 6 }).label).toBe("Templado");
    expect(climateSummary({ tmax: 4, tmin: -3, rainMm: 40, rainDays: 8 }).label).toBe("Frío, puede nevar");
    expect(climateSummary({ tmax: 30, tmin: 23, rainMm: 320, rainDays: 20 }).label).toBe("Temporada de lluvias");
    expect(climateSummary({ tmax: 35, tmin: 20, rainMm: 5, rainDays: 1 }).label).toBe("Mucho calor");
    // Muchos días de llovizna con poca agua no es temporada de lluvias.
    expect(climateSummary({ tmax: 27, tmin: 22, rainMm: 86, rainDays: 15 }).label).toBe("Calor de playa");
    expect(rainText({ rainMm: 3, rainDays: 0 })).toBe("Casi sin lluvia");
    expect(rainText({ rainMm: 90, rainDays: 8 })).toBe("8 días de lluvia (90 mm)");
  });

  it("promedia los últimos 4 años completos", () => {
    expect(climateRange(new Date("2026-10-13T00:00:00Z"))).toEqual({ start: "2022-01-01", end: "2025-12-31" });
  });

  it("pide Open-Meteo una sola vez y cachea el resumen", async () => {
    useCacheStore(undefined);
    const daily = history([2022, 2023, 2024, 2025], (m) => ({ hi: 20 + m, lo: 10, rain: () => 0 }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => Response.json({ daily }));
    vi.stubGlobal("fetch", fetchMock);
    const now = new Date("2026-10-13T00:00:00Z");
    const a = await climateFor(-34.61, -58.38, now);
    const b = await climateFor(-34.58, -58.41, now); // a pocos km: misma caché
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.hostname).toBe("archive-api.open-meteo.com");
    expect(url.searchParams.get("start_date")).toBe("2022-01-01");
    expect(url.searchParams.get("end_date")).toBe("2025-12-31");
    expect(url.searchParams.get("latitude")).toBe("-34.6");
    expect(a).toHaveLength(12);
    expect(a![11]).toMatchObject({ m: 12, tmax: 32, tmin: 10 });
    expect(b).toEqual(a);
  });

  it("devuelve null si Open-Meteo falla (y no lo cachea)", async () => {
    useCacheStore(undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response("error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await climateFor(40.4, -3.7)).toBeNull();
    expect(await climateFor(40.4, -3.7)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
