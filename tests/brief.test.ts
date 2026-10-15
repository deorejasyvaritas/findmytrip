import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../server/data/destinations.ts";
import { briefBudget, briefChips, clearBriefField, updateBrief } from "../shared/brief.ts";

const D = DESTINATIONS;

describe("resumen del viaje de Trippy", () => {
  it("entiende presupuesto, grupo, duración y mes", () => {
    const b = updateBrief({}, "Tengo USD 2.500 para dos, 10 días en marzo. ¿Qué me recomendás?", D);
    expect(b).toMatchObject({ budgetUSD: 2500, adults: 2, nights: 9, month: 3 });
  });

  it("presupuesto por persona y menores con edades", () => {
    const b = updateBrief({}, "somos 2 adultos con dos hijos de 5 y 9 años, tenemos 1500 dólares por persona", D);
    expect(b).toMatchObject({ adults: 2, childAges: [5, 9], budgetPerPersonUSD: 1500 });
    expect(briefBudget(b, 2)).toBe(6000);
  });

  it("recuerda lo anterior y pisa solo lo que cambia", () => {
    let b = updateBrief({}, "Quiero ir a Florianópolis en enero una semana, para dos", D);
    expect(b).toMatchObject({ destinationId: "florianopolis", month: 1, nights: 7, adults: 2 });
    b = updateBrief(b, "mejor en febrero y algo más barato", D);
    expect(b).toMatchObject({ destinationId: "florianopolis", month: 2, nights: 7, adults: 2, style: "low" });
  });

  it("no confunde 'para 10 días' con personas y suma intereses", () => {
    const b = updateBrief({}, "playa para 10 días, con mi pareja", D);
    expect(b.adults).toBe(2);
    expect(b.nights).toBe(9);
    expect(b.interests).toContain("playa");
  });

  it("muestra chips y deja borrar un dato", () => {
    const b = updateBrief({}, "USD 3000, Lisboa, 7 noches", D);
    expect(briefChips(b).map((c) => c.field)).toEqual(["destination", "budget", "nights"]);
    expect(clearBriefField(b, "budget").budgetUSD).toBeUndefined();
  });
});

import { pickCards } from "../server/agent.ts";
import type { AgentCard } from "../shared/types.ts";

describe("tarjetas de Trippy", () => {
  const card = (id: string, name: string): AgentCard => ({
    destinationId: id, name, country: "X", month: 3, year: 2027, nights: 7, totalUSD: 2000, perPersonUSD: 1000, fit: "dentro", flightSource: "aviasales",
  });
  it("muestra solo los destinos que la respuesta nombra, en orden", () => {
    const seen = new Map([
      ["rio", card("rio", "Río de Janeiro")],
      ["florianopolis", card("florianopolis", "Florianópolis")],
      ["lisboa", card("lisboa", "Lisboa y Oporto")],
    ]);
    const cards = pickCards("Te recomiendo Florianopolis; si querés Europa, Lisboa también entra.", seen);
    expect(cards.map((c) => c.destinationId)).toEqual(["florianopolis", "lisboa"]);
  });
});
