import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aviasalesForParty,
  aviasalesPax,
  aviasalesSearchUrl,
  flightLinks,
  flightPax,
  parseAviasalesUrl,
  stayLinks,
} from "../shared/links.ts";
import { ago, needsCheck, priceLabel, staleNote } from "../shared/price-age.ts";
import { applyRecheck, diffItem, diffLabel, diffPackage, legacyFlightQuote, recheckRequest } from "../shared/recheck.ts";
import type { ItemQuote, TripPackage } from "../shared/types.ts";
import { recheckItems } from "../server/recheck.ts";
import { shareSnapshot } from "../server/share.ts";

afterEach(() => vi.unstubAllGlobals());

const usd = (n: number) => `USD ${Math.round(n)}`;

describe("links de compra: misma ruta, fechas y grupo", () => {
  it("cuenta pasajeros como una aerolínea (12+ adulto, 2-11 niño, menos de 2 bebé)", () => {
    expect(flightPax(2)).toEqual({ adults: 2, children: 0, infants: 0 });
    expect(flightPax({ adults: 2, childAges: [5, 1, 13] })).toEqual({ adults: 3, children: 1, infants: 1 });
    // Más bebés que adultos: el que sobra viaja con asiento.
    expect(flightPax({ adults: 1, childAges: [0, 1] })).toEqual({ adults: 1, children: 1, infants: 1 });
    expect(aviasalesPax(2)).toBe("2");
    expect(aviasalesPax({ adults: 2, childAges: [5] })).toBe("21");
    expect(aviasalesPax({ adults: 2, childAges: [5, 1] })).toBe("211");
    expect(aviasalesPax({ adults: 2, childAges: [1] })).toBe("201");
  });

  it("arma la búsqueda de Aviasales de ida y vuelta y de solo ida", () => {
    expect(aviasalesSearchUrl({ from: "BUE", to: "MAD", depart: "2026-03-10", ret: "2026-03-20", party: 2, marker: "789588" })).toBe(
      "https://www.aviasales.com/search/BUE1003MAD20032?marker=789588",
    );
    expect(aviasalesSearchUrl({ from: "BUE", to: "MAD", depart: "2026-03-10", ret: null, party: { adults: 1, childAges: [7] } })).toBe(
      "https://www.aviasales.com/search/BUE1003MAD11",
    );
  });

  it("cambia los pasajeros del link de la Data API (viene para 1 adulto) y conserva el resto", () => {
    const url = "https://www.aviasales.com/search/BUE1003MAD20031?t=abc&marker=789588";
    expect(aviasalesForParty(url, { adults: 2, childAges: [5] })).toBe("https://www.aviasales.com/search/BUE1003MAD200321?t=abc&marker=789588");
    expect(aviasalesForParty("https://www.aviasales.com/search/BUE1003MAD1?t=x", 3)).toBe("https://www.aviasales.com/search/BUE1003MAD3?t=x");
    expect(aviasalesForParty("https://www.google.com/travel/flights?tfs=abc", 3)).toBe("https://www.google.com/travel/flights?tfs=abc");
    expect(aviasalesForParty(null, 3)).toBeNull();
  });

  it("lee ruta y fechas de un link guardado, con cambio de año", () => {
    expect(parseAviasalesUrl("https://www.aviasales.com/search/BUE2812RIO05012?marker=1", 2026)).toEqual({
      from: "BUE",
      to: "RIO",
      depart: "2026-12-28",
      ret: "2027-01-05",
    });
    expect(parseAviasalesUrl("https://www.aviasales.com/search/BUE2812RIO1", 2026)).toEqual({ from: "BUE", to: "RIO", depart: "2026-12-28", ret: null });
    expect(parseAviasalesUrl("https://www.aviasales.com/search/x", 2026)).toBeNull();
  });

  it("los comparadores de vuelos llevan el grupo y respetan el solo ida", () => {
    const party = { adults: 2, childAges: [5, 1] };
    const [, google, sky, despegar] = flightLinks("BUE", "MIA", "2026-07-01", "2026-07-10", party);
    expect(decodeURIComponent(google.url)).toContain("2 adults 1 children 1 infants on lap");
    expect(google.url).toContain("curr=USD");
    expect(sky.url).toBe("https://www.skyscanner.com.ar/transporte/vuelos/bue/mia/260701/260710/?adultsv2=2&cabinclass=economy&childrenv2=5%7C1");
    expect(despegar.url).toBe("https://www.despegar.com.ar/shop/flights/results/roundtrip/BUE/MIA/2026-07-01/2026-07-10/2/1/1");
    const oneWay = flightLinks("BUE", "MIA", "2026-07-01", null, 1);
    expect(oneWay[3].url).toBe("https://www.despegar.com.ar/shop/flights/results/oneway/BUE/MIA/2026-07-01/1/0/0");
    expect(oneWay[2].url).toContain("/260701/?");
    expect(decodeURIComponent(oneWay[1].url)).toContain("One way flights from BUE to MIA on 2026-07-01");
  });

  it("los links de alojamiento llevan fechas, habitaciones, chicos con edad y dólares", () => {
    const [booking, expedia, airbnb] = stayLinks("Copacabana, Río de Janeiro", "2026-07-01", "2026-07-08", { adults: 2, childAges: [5, 1] }, 1);
    const b = new URL(booking.url).searchParams;
    expect(b.get("checkin")).toBe("2026-07-01");
    expect(b.get("checkout")).toBe("2026-07-08");
    expect(b.get("group_adults")).toBe("2");
    expect(b.get("group_children")).toBe("2");
    expect(b.getAll("age")).toEqual(["5", "1"]);
    expect(b.get("no_rooms")).toBe("1");
    expect(b.get("selected_currency")).toBe("USD");
    const e = new URL(expedia.url).searchParams;
    expect(e.get("children")).toBe("1_5,1_1");
    expect(e.get("rooms")).toBe("1");
    const a = new URL(airbnb.url).searchParams;
    expect(a.get("children")).toBe("1");
    expect(a.get("infants")).toBe("1");
    expect(a.get("currency")).toBe("USD");
    // Con una cantidad (compatibilidad): todos adultos.
    expect(new URL(stayLinks("Bariloche", "2026-07-01", "2026-07-03", 3, 2)[0].url).searchParams.get("group_adults")).toBe("3");
  });
});

describe("qué precio es y qué tan viejo", () => {
  const now = Date.parse("2026-10-14T15:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

  it("etiquetas cortas por tipo de precio", () => {
    expect(priceLabel({ kind: "manual" }, now)).toBe("Precio que cargaste");
    expect(priceLabel({ kind: "estimado", source: "estimado" }, now)).toBe("Estimado");
    expect(priceLabel({ kind: "cercano", source: "aviasales", priceDate: "2026-12-12" }, now)).toBe("Precio de otro día (12 dic)");
    expect(priceLabel({ kind: "mes", source: "aviasales", priceDate: "2026-12-03" }, now)).toBe("Mínimo del mes (3 dic)");
    expect(priceLabel({ kind: "exacto", source: "google", at: hoursAgo(2) }, now)).toBe("Precio de hoy");
    expect(priceLabel({ kind: "exacto", source: "google", at: hoursAgo(20) }, now)).toBe("Visto hace 20 h");
    expect(priceLabel({ kind: "exacto", source: "aviasales", at: hoursAgo(1) }, now)).toBe("Visto en los últimos días");
    expect(priceLabel({ kind: "exacto", source: "aviasales", at: hoursAgo(72) }, now)).toBe("Visto hace 3 días");
    expect(priceLabel({ kind: "exacto", source: "xotelo", at: hoursAgo(0) }, now)).toBe("Precio de hoy");
  });

  it("no dice 'de hoy' para un precio de ayer aunque tenga menos de 12 h", () => {
    // 02:00 en Argentina; el precio es de las 22:00 del día anterior.
    const early = Date.parse("2026-10-14T05:00:00Z");
    expect(priceLabel({ kind: "exacto", source: "google", at: new Date(early - 4 * 3600_000).toISOString() }, early)).toBe("Visto hace 4 h");
  });

  it("avisa antes de comprar solo si el precio no es exacto o es viejo", () => {
    expect(needsCheck({ kind: "exacto", source: "aviasales", at: hoursAgo(2) }, now)).toBe(false);
    expect(staleNote({ kind: "exacto", source: "aviasales", at: hoursAgo(2) }, now)).toBeNull();
    expect(staleNote({ kind: "exacto", source: "aviasales", at: hoursAgo(30) }, now)).toBe("Este precio es de hace 1 día; puede cambiar al reservar.");
    expect(staleNote({ kind: "cercano", source: "aviasales", at: hoursAgo(1), priceDate: "2026-12-12" }, now)).toBe(
      "Este precio es de otro día (12 dic); puede cambiar al reservar.",
    );
    expect(staleNote({ kind: "estimado", source: "estimado", at: hoursAgo(1) }, now)).toBe("Es un precio estimado; puede cambiar al reservar.");
    expect(needsCheck({ kind: "manual", at: hoursAgo(500) }, now)).toBe(false);
    expect(ago(hoursAgo(0.5), now)).toBe("hace 30 min");
  });
});

const flightQuote: ItemQuote = {
  kind: "exacto",
  source: "aviasales",
  at: "2026-10-01T12:00:00Z",
  unitUSD: 400,
  units: 2.75,
  flight: { from: "BUE", to: "RIO", depart: "2026-12-10", ret: "2026-12-17" },
};
const hotelQuote: ItemQuote = {
  kind: "exacto",
  source: "xotelo",
  at: "2026-10-01T12:00:00Z",
  unitUSD: 100,
  units: 7,
  hotel: { key: "g303506-d123", checkin: "2026-12-10", checkout: "2026-12-17" },
};

function pkg(): TripPackage {
  return {
    id: "pkg_1",
    destinationId: "rio",
    destinationName: "Río de Janeiro",
    origin: "BUE",
    departDate: "2026-12-10",
    returnDate: "2026-12-17",
    travelers: 4,
    style: "mid",
    items: [
      { kind: "vuelo", label: "Vuelo BUE–RIO (2 adultos, 2 niños, USD 400 por adulto)", amountUSD: 1100, link: "https://www.aviasales.com/search/BUE1012RIO1712220", quote: flightQuote },
      { kind: "alojamiento", label: "Hotel Copa · 7 noches", amountUSD: 700, quote: hotelQuote },
      { kind: "extra", label: "Equipaje", amountUSD: 120 },
    ],
    totalUSD: 1920,
    createdAt: "2026-10-01T12:00:00Z",
    status: "armando",
  };
}

describe("revisar precios de un viaje guardado", () => {
  it("pide solo vuelos y hoteles que se pueden volver a consultar", () => {
    expect(recheckRequest(pkg())).toEqual([
      { i: 0, type: "flight", from: "BUE", to: "RIO", depart: "2026-12-10", ret: "2026-12-17" },
      { i: 1, type: "hotel", key: "g303506-d123", checkin: "2026-12-10", checkout: "2026-12-17" },
    ]);
  });

  it("deduce el vuelo de un viaje guardado antes de existir el detalle del precio", () => {
    const old = { kind: "vuelo" as const, label: "Vuelo BUE ⇄ RIO (2 adultos, USD 350 por adulto)", amountUSD: 700, link: "https://www.aviasales.com/search/BUE1012RIO17122" };
    const q = legacyFlightQuote(old, { departDate: "2026-12-10", createdAt: "2026-09-01T00:00:00Z" });
    expect(q).toMatchObject({ unitUSD: 350, units: 2, flight: { from: "BUE", to: "RIO", depart: "2026-12-10", ret: "2026-12-17" } });
    expect(legacyFlightQuote({ ...old, label: "Vuelo sin precio por adulto" }, { departDate: "2026-12-10", createdAt: "x" })).toBeNull();
  });

  it("sigue, subió, bajó, otro día o sin precio", () => {
    const item = pkg().items[0];
    const at = "2026-10-14T12:00:00Z";
    const same = diffItem(item, flightQuote, { i: 0, unitUSD: 401, kind: "exacto", source: "aviasales", at });
    expect(same.status).toBe("igual");
    expect(diffLabel(same, usd)).toBe("Sigue a USD 1103");
    const up = diffItem(item, flightQuote, { i: 0, unitUSD: 440, kind: "exacto", source: "aviasales", at });
    expect(up).toMatchObject({ status: "subio", newAmountUSD: 1210, deltaUSD: 110, canUpdate: true });
    expect(diffLabel(up, usd)).toBe("Subió USD 110 (ahora USD 1210)");
    const down = diffItem(item, flightQuote, { i: 0, unitUSD: 380, kind: "exacto", source: "aviasales", at });
    expect(diffLabel(down, usd)).toBe("Bajó USD 55 (ahora USD 1045)");
    const near = diffItem(item, flightQuote, { i: 0, unitUSD: 300, kind: "cercano", source: "aviasales", priceDate: "2026-12-12", at });
    expect(near).toMatchObject({ status: "otro-dia", canUpdate: false });
    expect(diffLabel(near, usd)).toBe("Sin precio para tu fecha; el 12/12 sale USD 825");
    const none = diffItem(item, flightQuote, { i: 0, unitUSD: null, kind: null, source: null, at });
    expect(none.status).toBe("sin-precio");
  });

  it("actualiza montos, total y etiqueta solo con precios exactos que cambiaron", () => {
    const p = pkg();
    const res = {
      checkedAt: "2026-10-14T12:00:00Z",
      results: [
        { i: 0, unitUSD: 440, kind: "exacto" as const, source: "aviasales" as const, at: "2026-10-14T12:00:00Z", link: "https://www.aviasales.com/search/BUE1012RIO17121?t=z" },
        { i: 1, unitUSD: 90, kind: "exacto" as const, source: "xotelo" as const, at: "2026-10-14T12:00:00Z" },
      ],
    };
    const next = applyRecheck(p, diffPackage(p, res));
    expect(next.items[0].amountUSD).toBe(1210);
    expect(next.items[0].label).toContain("USD 440 por adulto");
    // El link guardado (para todo el grupo) no se pisa con el de 1 adulto.
    expect(next.items[0].link).toBe(p.items[0].link);
    expect(next.items[0].quote).toMatchObject({ unitUSD: 440, at: "2026-10-14T12:00:00Z" });
    expect(next.items[1].amountUSD).toBe(630);
    expect(next.totalUSD).toBe(1920 + 110 - 70);
    // Revisar de nuevo con lo mismo: ya sigue igual.
    expect(diffPackage(next, res).every((d) => d.status === "igual")).toBe(true);
  });

  it("el servidor consulta Aviasales (día exacto) y la tarifa del hotel, sin Google si no se pidió", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        calls.push(url.hostname + url.pathname);
        if (url.pathname.includes("prices_for_dates")) {
          return Response.json({
            success: true,
            data: [{ price: 455, airline: "G3", departure_at: "2026-12-10T08:00:00-03:00", return_at: "2026-12-17T20:00:00-03:00", transfers: 0, link: "/search/BUE1012RIO17121?t=a" }],
          });
        }
        if (url.pathname.includes("/rates")) return Response.json({ error: null, result: { rates: [{ code: "x", name: "Booking.com", rate: 80, tax: 12 }] } });
        return Response.json({});
      }),
    );
    const r = await recheckItems({ token: "t", marker: "789588" }, recheckRequest(pkg()), false);
    expect(r[0]).toMatchObject({ i: 0, unitUSD: 455, kind: "exacto", source: "aviasales" });
    expect(r[1]).toMatchObject({ i: 1, unitUSD: 92, kind: "exacto", source: "xotelo" });
    expect(calls.some((c) => c.includes("serpapi"))).toBe(false);
  });
});

describe("viaje compartido", () => {
  it("dice desde cuándo son los precios (no cuándo se compartió)", () => {
    const s = shareSnapshot(pkg());
    expect(s?.pricedAt).toBe("2026-10-01T12:00:00.000Z");
  });
});
