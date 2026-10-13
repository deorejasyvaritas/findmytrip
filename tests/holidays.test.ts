import { describe, expect, it } from "vitest";
import { easter, holidays, longWeekends } from "../server/holidays.ts";

describe("feriados y fines de semana largos", () => {
  it("calcula Pascua", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
  });

  it("traslada los feriados movibles", () => {
    // 20 de noviembre de 2026 es viernes: pasa al lunes 23.
    expect(holidays(2026)["2026-11-23"]).toBe("Día de la Soberanía Nacional");
    // 17 de agosto de 2027 es martes: pasa al lunes 16.
    expect(holidays(2027)["2027-08-16"]).toBe("Paso a la Inmortalidad de San Martín");
    // Carnaval 2027: lunes 8 y martes 9 de febrero.
    expect(holidays(2027)["2027-02-08"]).toBe("Carnaval");
  });

  it("encuentra los próximos fines de semana largos", () => {
    const lw = longWeekends("2026-10-13", 4);
    expect(lw[0]).toMatchObject({ from: "2026-11-21", to: "2026-11-23", days: 3 });
    expect(lw[1]).toMatchObject({ from: "2026-12-25", to: "2026-12-27", days: 3, reason: "Navidad" });
    expect(lw[2]).toMatchObject({ from: "2027-01-01", to: "2027-01-03" });
    expect(lw[3]).toMatchObject({ from: "2027-02-06", to: "2027-02-09", days: 4, reason: "Carnaval" });
  });
});
