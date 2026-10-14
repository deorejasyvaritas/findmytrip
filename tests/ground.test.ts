import { describe, expect, it } from "vitest";
import { TRANSFER_MAX_KM, fareFor, groundEstimate, groundSeats, groundTotal, rome2rioUrl } from "../shared/ground.ts";

describe("groundEstimate", () => {
  it("micro en Brasil: precio por km con redondeo a 5", () => {
    // 300 km x 0,065 = 19,5 -> 20
    const g = groundEstimate(300, "Brasil", "Brasil", "Florianópolis", "Bombinhas");
    expect(g.mode).toBe("micro");
    expect(g.perPerson).toBe(20);
    expect(g.transfer).toBeNull();
  });

  it("tramos cortos: pasaje mínimo y transfer privado como alternativa", () => {
    const g = groundEstimate(60, "Brasil", "Brasil", "Maceió", "Maragogi");
    expect(g.perPerson).toBe(10); // mínimo 8 -> 10
    expect(g.transfer).toBe(60); // 60 km x 1 USD = 60 (mínimo 40)
    expect(groundEstimate(TRANSFER_MAX_KM + 1, "Brasil", "Brasil", "a", "b").transfer).toBeNull();
  });

  it("tren en Europa es más caro por km que el micro en Sudamérica", () => {
    const italy = groundEstimate(280, "Italia", "Italia", "Roma", "Florencia");
    const arg = groundEstimate(280, "Argentina", "Argentina", "Salta", "Tucumán");
    expect(italy.mode).toBe("tren");
    expect(italy.perPerson).toBeGreaterThan(arg.perPerson);
  });

  it("reconoce países sin acentos o en inglés y usa un valor por defecto si no conoce el país", () => {
    expect(fareFor("Japón")).toEqual(fareFor("japan"));
    expect(fareFor("España").mode).toBe("micro o tren");
    expect(groundEstimate(100, "Narnia", "Narnia", "a", "b").perPerson).toBe(10);
  });

  it("si cruza de país promedia las tarifas", () => {
    const g = groundEstimate(400, "Argentina", "Chile", "Mendoza", "Santiago");
    // (0,07 + 0,05) / 2 x 400 = 24 -> 25
    expect(g.perPerson).toBe(25);
  });

  it("arma el link de Rome2Rio", () => {
    expect(rome2rioUrl("Porto de Galinhas", "Recife")).toBe("https://www.rome2rio.com/s/Porto-de-Galinhas/Recife");
  });
});

describe("groundTotal", () => {
  it("cobra a adultos y chicos, no a bebés", () => {
    const party = { adults: 2, childAges: [1, 6], bags: "cabin" as const };
    expect(groundSeats(party)).toBe(3);
    const legs = [{ ground: groundEstimate(300, "Brasil", "Brasil", "a", "b") }, { ground: null }, {}];
    expect(groundTotal(legs, party)).toBe(60);
  });
});
