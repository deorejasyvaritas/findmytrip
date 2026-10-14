import { describe, expect, it } from "vitest";
import { DESTINATIONS } from "../server/data/destinations.ts";
import { explore } from "../server/engine.ts";
import { COUNTRIES, countryCodeOf, matchCountries } from "../shared/countries.ts";
import {
  countryExploreRequest,
  countryRoutes,
  countrySearchFromParams,
  countrySearchToParams,
  rankCountry,
  scaleRouteNights,
  suggestionFlightLabel,
  type CountrySearch,
} from "../shared/country-search.ts";
import { ROUTES } from "../shared/routes.ts";
import type { ExploreRequest, Suggestion } from "../shared/types.ts";

const today = new Date("2026-10-13T12:00:00Z");

describe("países en el autocompletar", () => {
  it("reconoce nombres con y sin tilde", () => {
    expect(matchCountries("Brasil")[0]?.code).toBe("BR");
    expect(matchCountries("brasil")[0]?.code).toBe("BR");
    expect(matchCountries("Japon")[0]?.code).toBe("JP");
    expect(matchCountries("JAPÓN")[0]?.code).toBe("JP");
    expect(matchCountries("Mexico")[0]?.code).toBe("MX");
    expect(matchCountries("Perú")[0]?.code).toBe("PE");
  });

  it("reconoce alias comunes", () => {
    for (const q of ["EEUU", "EE.UU.", "ee. uu.", "USA", "Estados Unidos"]) expect(matchCountries(q)[0]?.code, q).toBe("US");
    expect(matchCountries("Brazil")[0]?.code).toBe("BR");
    expect(matchCountries("Holanda")[0]?.code).toBe("NL");
    expect(matchCountries("Dominicana")[0]?.code).toBe("DO");
  });

  it("sugiere por el comienzo desde 4 letras, sin tapar ciudades cortas", () => {
    expect(matchCountries("bras")[0]?.code).toBe("BR");
    expect(matchCountries("ital")[0]?.code).toBe("IT");
    expect(matchCountries("bra")).toEqual([]);
    expect(matchCountries("Mar del Plata")).toEqual([]);
    expect(matchCountries("Salvador")).toEqual([]);
    expect(matchCountries("Río de Janeiro")).toEqual([]);
  });

  it("todos los países del catálogo tienen su entrada", () => {
    for (const d of DESTINATIONS) expect(countryCodeOf(d.country), d.country).not.toBeNull();
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRIES) expect(c.cities.length).toBeGreaterThan(0);
  });
});

describe("explore por país", () => {
  const base: ExploreRequest = { origin: "BUE", budgetUSD: 4500, travelers: 3, nights: 10, month: 1, year: 2027, style: "mid", interests: [] };

  it("solo devuelve destinos de ese país, todos (también los que se pasan)", () => {
    const res = explore({ ...base, budgetUSD: 500, countries: ["BR"] }, undefined, today);
    const brasil = DESTINATIONS.filter((d) => d.country === "Brasil");
    expect(res.suggestions.length).toBe(brasil.length);
    expect(res.alternatives).toEqual([]);
    for (const s of res.suggestions) expect(s.destination.country).toBe("Brasil");
    // Sin la frase del presupuesto: la app marca cuánto se pasa.
    for (const s of res.suggestions) expect(s.reasons.join(" ")).not.toMatch(/presupuesto|Se pasa/);
  });

  it("con all inclusive deja afuera los destinos del país donde no se consigue", () => {
    const all = explore({ ...base, countries: ["BR"] }, undefined, today).suggestions.length;
    const ai = explore({ ...base, countries: ["BR"], mealPlan: "all" }, undefined, today).suggestions;
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.length).toBeLessThanOrEqual(all);
    for (const s of ai) expect(s.cost.mealPlan).toBe("all");
  });

  it("sin filtro de país sigue igual", () => {
    const res = explore(base, undefined, today);
    expect(new Set(res.suggestions.map((s) => s.destination.country)).size).toBeGreaterThan(1);
  });
});

const search: CountrySearch = {
  country: "BR",
  from: "BUE|Buenos Aires (BUE)",
  dates: { depart: "2027-01-01", window: { from: "2027-01-01", to: "2027-01-15" }, pinned: null },
  nights: 10,
  party: { adults: 2, childAges: [15], bags: "cabin" },
  budget: 4500,
  meal: "all",
  interests: ["playa", "gastronomía"],
  sort: "epoca",
};

describe("URL de la búsqueda por país", () => {
  it("ida y vuelta sin perder nada", () => {
    const q = countrySearchToParams(search);
    expect(q.get("tipo")).toBe("pais");
    expect(countrySearchFromParams(new URLSearchParams(q.toString()))).toEqual(search);
  });

  it("con fecha exacta y sin extras", () => {
    const plain: CountrySearch = { ...search, dates: { depart: "2027-02-10", window: null, pinned: null }, budget: null, meal: null, interests: [], sort: "barato" };
    const q = countrySearchToParams(plain);
    expect(q.has("presu")).toBe(false);
    expect(q.has("regimen")).toBe(false);
    expect(countrySearchFromParams(new URLSearchParams(q.toString()))).toEqual(plain);
  });

  it("descarta país o valores inválidos", () => {
    expect(countrySearchFromParams(new URLSearchParams("tipo=pais&pais=XX&from=BUE&depart=2027-01-01"))).toBeNull();
    const s = countrySearchFromParams(new URLSearchParams("tipo=pais&pais=br&from=BUE&depart=2027-01-01&regimen=nada&int=playa,xx&presu=-3"));
    expect(s?.country).toBe("BR");
    expect(s?.meal).toBeNull();
    expect(s?.interests).toEqual(["playa"]);
    expect(s?.budget).toBeNull();
  });

  it("arma el pedido a explore con el país, la ventana y el régimen", () => {
    const r = countryExploreRequest(search, "mid");
    expect(r.countries).toEqual(["BR"]);
    expect(r.origin).toBe("BUE");
    expect(r.when).toEqual({ kind: "window", from: "2027-01-01", to: "2027-01-15" });
    expect(r.mealPlan).toBe("all");
    expect(r.travelers).toBe(3);
    const exact = countryExploreRequest({ ...search, dates: { depart: "2027-02-10", window: null, pinned: null } }, "mid");
    expect(exact.when).toEqual({ kind: "exact", depart: "2027-02-10", ret: "2027-02-20" });
  });
});

describe("resultados por país", () => {
  const sugg = (id: string, total: number, month = 1): Suggestion => {
    const destination = DESTINATIONS.find((d) => d.id === id)!;
    return {
      destination,
      month,
      year: 2027,
      cost: { flights: 0, bags: 0, lodging: 0, daily: 0, dailyIncluded: false, total, perPerson: total / 3 },
      score: 0,
      fit: "dentro",
      reasons: [],
      isAlternative: false,
      flightSource: "estimado",
      lodgingSource: "estimado",
    };
  };

  it("separa lo que entra del presupuesto y dice cuánto se pasa", () => {
    const brasil = DESTINATIONS.filter((d) => d.country === "Brasil").slice(0, 3);
    const list = [sugg(brasil[0].id, 4730), sugg(brasil[1].id, 3900), sugg(brasil[2].id, 4400)];
    const r = rankCountry(list, { sort: "barato", budget: 4500, interests: [] });
    expect(r.within.map((o) => o.s.cost.total)).toEqual([3900, 4400]);
    expect(r.over.map((o) => o.over)).toEqual([230]);
  });

  it("filtra por intereses", () => {
    const brasil = DESTINATIONS.filter((d) => d.country === "Brasil");
    const r = rankCountry(brasil.map((d) => sugg(d.id, 1000)), { sort: "barato", budget: null, interests: ["nieve"] });
    expect(r.within.length + r.over.length).toBe(brasil.filter((d) => d.tags.includes("nieve")).length);
  });

  it("etiqueta el precio del vuelo según su origen", () => {
    const s = sugg(DESTINATIONS[0].id, 1000);
    expect(suggestionFlightLabel(s, null)).toBe("Estimado");
    expect(suggestionFlightLabel({ ...s, flightSource: "aviasales" }, null)).toBe("Referencia del mes");
    expect(suggestionFlightLabel({ ...s, flightSource: "aviasales", depart: "2027-01-05" }, "2027-01-03")).toBe("Precio de otro día (5 ene)");
  });

  it("rutas armadas del país y noches repartidas", () => {
    const br = countryRoutes("BR", ROUTES);
    expect(br.length).toBeGreaterThan(0);
    for (const r of br) expect(r.stops.filter((s) => s.country === "Brasil").length * 2).toBeGreaterThanOrEqual(r.stops.length);
    const r = ROUTES.find((x) => x.id === "nordeste-brasil")!;
    const scaled = scaleRouteNights(r, 10);
    expect(scaled.reduce((n, s) => n + s.nights, 0)).toBe(10);
    for (const s of scaled) expect(s.nights).toBeGreaterThanOrEqual(1);
    expect(scaleRouteNights(r, 2)).toBe(r.stops);
  });
});
