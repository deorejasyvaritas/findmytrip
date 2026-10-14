import { describe, expect, it } from "vitest";
import { ESTIMATED_CAP, radarScore, radarTier, withRadarScore } from "../shared/radar-score.ts";

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
