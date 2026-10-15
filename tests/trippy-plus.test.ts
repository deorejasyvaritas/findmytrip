import { describe, expect, it } from "vitest";
import { prefSuggestions } from "../shared/brief.ts";
import { dayPlan, parseItinerary } from "../shared/itinerary.ts";
import type { Profile, TripPackage } from "../shared/types.ts";

const profile: Profile = {
  name: "", origin: "BUE", travelers: 2, style: "mid", interests: ["ciudad"], currency: "USD", visited: [], maxFlightHours: null,
};

describe("itinerario de Trippy", () => {
  it("lee un día por línea, con viñetas o negritas", () => {
    const text = "Te armo los días:\n- **Día 1:** Llegada y paseo por Lagoa.\n- Día 2 (sábado): Praia Mole y atardecer.\nDía 3 - Excursión a Campeche.\n¡Buen viaje!";
    expect(parseItinerary(text)).toEqual([
      { day: 1, title: "Llegada y paseo por Lagoa." },
      { day: 2, title: "Praia Mole y atardecer." },
      { day: 3, title: "Excursión a Campeche." },
    ]);
    expect(parseItinerary("Día 1: solo uno")).toBeNull();
  });

  it("el día por día del viaje muestra la actividad", () => {
    const pkg = {
      id: "p", destinationId: "florianopolis", destinationName: "Florianópolis", origin: "BUE", departDate: "2027-03-06", returnDate: "2027-03-08",
      travelers: 2, style: "mid", items: [], totalUSD: 0, createdAt: "2026-10-01", status: "idea",
      activities: [{ day: 2, title: "Praia Mole" }],
    } as TripPackage;
    expect(dayPlan(pkg)?.days[1].activity).toBe("Praia Mole");
    expect(dayPlan(pkg)?.days[0].activity).toBeUndefined();
  });
});

describe("gustos para el perfil", () => {
  it("ofrece guardar lo nuevo y no lo que ya está", () => {
    const s = prefSuggestions("Queremos playa, all inclusive y frente al mar, no más de 8 horas de vuelo", profile);
    expect(s.map((x) => x.key)).toEqual(["hours:8", "meal:all", "beachfront", "interests:playa"]);
    expect(prefSuggestions("me gusta la ciudad", profile)).toEqual([]);
  });
});

import { withoutDayLines } from "../shared/itinerary.ts";
describe("texto sin los días", () => {
  it("deja la introducción y el cierre", () => {
    expect(withoutDayLines("Te armo los días:\nDía 1: A\nDía 2: B\n¡Buen viaje!")).toBe("Te armo los días:\n¡Buen viaje!");
  });
});
