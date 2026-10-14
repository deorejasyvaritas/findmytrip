import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../server/data/destinations.ts";
import { ENTRY_REQUIREMENTS, entryRequirements, entrySummary, normalizeCountry } from "../shared/entry-requirements.ts";

describe("requisitos de entrada", () => {
  it("cubre todos los países del catálogo", () => {
    for (const d of DESTINATIONS) expect(entryRequirements(d.country), d.country).not.toBeNull();
  });

  it("encuentra el país con o sin tildes, mayúsculas o en inglés", () => {
    expect(normalizeCountry("  República   Dominicana ")).toBe("republica dominicana");
    expect(entryRequirements("Japon")?.country).toBe("Japón");
    expect(entryRequirements("PERÚ")?.country).toBe("Perú");
    expect(entryRequirements("mexico")?.country).toBe("México");
    expect(entryRequirements("EE. UU.")?.country).toBe("Estados Unidos");
    expect(entryRequirements("Spain")?.country).toBe("España");
    expect(entryRequirements("Narnia")).toBeNull();
    expect(entryRequirements("")).toBeNull();
  });

  it("arma el resumen de una línea", () => {
    expect(entrySummary(entryRequirements("Brasil")!)).toBe("DNI o pasaporte · sin visa");
    expect(entrySummary(entryRequirements("Estados Unidos")!)).toBe("Pasaporte · con visa");
    expect(entrySummary(entryRequirements("Tailandia")!)).toContain("certificado de vacuna");
    expect(entrySummary(entryRequirements("Argentina")!)).toContain("DNI");
  });

  it("cada país tiene fuente oficial y fecha de revisión", () => {
    for (const r of ENTRY_REQUIREMENTS) {
      expect(r.source.url, r.country).toMatch(/^https:\/\//);
      expect(r.lastReviewed, r.country).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
