import { describe, expect, it } from "vitest";
import { ESTIMATED_CAP, likeForLikeBaseline, radarScore, radarTier, withRadarScore, type BaselineObs } from "../shared/radar-score.ts";

const base = { discountPct: 0, isMinimum: false, trend: "same" as const, baseline: "historial" as const };

describe("puntaje del radar", () => {
  it("sube con el descuento y suma por mínimo y baja", () => {
    expect(radarScore({ ...base, discountPct: 20 })).toBe(70);
    expect(radarScore({ ...base, discountPct: 20, isMinimum: true })).toBe(80);
    expect(radarScore({ ...base, discountPct: 20, trend: "down" })).toBe(74);
  });

  it("queda entre 0 y 100", () => {
    expect(radarScore({ ...base, discountPct: 95, isMinimum: true, trend: "down" })).toBe(100);
    expect(radarScore(base)).toBeGreaterThanOrEqual(0);
  });

  it("con precio habitual estimado no pasa de 85", () => {
    expect(radarScore({ ...base, discountPct: 60, baseline: "estimado" })).toBe(ESTIMATED_CAP);
    expect(withRadarScore({ ...base, discountPct: 60, baseline: "estimado" }).tier).toBe("Muy buena");
  });

  it("etiquetas por tramo", () => {
    expect(radarTier(95, 40)).toBe("Ofertón");
    expect(radarTier(91, 25)).toBe("Excelente");
    expect(radarTier(80, 20)).toBe("Muy buena");
    expect(radarTier(65, 15)).toBe("Buena");
    expect(radarTier(64, 15)).toBeNull();
  });

  it("withRadarScore conserva el ítem y agrega puntaje y etiqueta", () => {
    const r = withRadarScore({ ...base, discountPct: 35, isMinimum: true });
    expect(r).toMatchObject({ discountPct: 35, radarScore: 100, tier: "Ofertón" });
  });
});

describe("precio habitual del mismo viaje", () => {
  const seen: BaselineObs[] = [
    [400, 7, 1],
    [410, 8, 2],
    [405, 6, 3],
    [250, 14, 4], // otra estadía: no cuenta
    [300, -1, 5], // sin fechas: no cuenta
  ];

  it("usa la mediana de estadías parecidas (±2 noches) y su mínimo", () => {
    expect(likeForLikeBaseline(seen, 7, 999)).toEqual({ typical: 405, baseline: "historial", comparables: 3, lowest: 400 });
  });

  it("con menos de 3 comparables vuelve a la estimación, marcada y topeada", () => {
    const b = likeForLikeBaseline(seen, 12, 520);
    expect(b).toEqual({ typical: 520, baseline: "estimado", comparables: 1, lowest: null });
    expect(likeForLikeBaseline(seen, null, 520).baseline).toBe("estimado");
    // Un 60 % "contra lo estimado" no llega a Excelente ni a Ofertón.
    const r = withRadarScore({ discountPct: 60, isMinimum: false, trend: "down" as const, baseline: b.baseline });
    expect(r).toMatchObject({ radarScore: ESTIMATED_CAP, tier: "Muy buena" });
  });
});
