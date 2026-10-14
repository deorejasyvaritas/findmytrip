import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseWindowDay, legOptions, planTrip } from "../server/trip.ts";
import {
  describeWindow,
  pickWindowDay,
  quickWindows,
  tripDatesFromParams,
  tripDatesToParams,
  validWindow,
  windowFromParam,
  windowToParam,
} from "../shared/trip-window.ts";
import { arrivalFromDuration, arrivalInfo, infoFromResult, tripBagsCost } from "../shared/flight-details.ts";
import { minusHours, planTransfers, transferCost, transferTimes, transfersTotal, tripTotal, type AirportTransfer } from "../shared/transfers.ts";
import { packageQuoteInput, quoteText, whatsappUrl } from "../shared/quote-text.ts";
import type { FlightResult, TripLeg, TripPackage, TripPlan } from "../shared/types.ts";

afterEach(() => vi.unstubAllGlobals());

const EMOJI = /\p{Extended_Pictographic}/u;

describe("fechas flexibles: día más barato de la ventana", () => {
  const w = { from: "2033-07-16", to: "2033-07-31" };

  it("ida y vuelta: el día más barato dentro de la ventana (lo de afuera no cuenta)", () => {
    const r = pickWindowDay(w, [
      ["2033-07-10", 100],
      ["2033-07-18", 520],
      ["2033-07-16", 610],
      ["2033-07-25", 540],
    ]);
    expect(r.chosen).toBe("2033-07-18");
    expect(r.days.map((d) => d.date)).toEqual(["2033-07-16", "2033-07-18", "2033-07-25"]);
  });

  it("ida + vuelta: suma la vuelta que sale `nights` días después; sin ninguna completa, solo la ida", () => {
    const out: [string, number][] = [
      ["2033-07-18", 300],
      ["2033-07-20", 350],
    ];
    const back: [string, number][] = [
      ["2033-07-25", 400], // 18 + 7
      ["2033-07-27", 200], // 20 + 7
    ];
    const r = pickWindowDay(w, out, back, 7);
    expect(r).toMatchObject({ chosen: "2033-07-20", combined: true });
    expect(r.days).toEqual([
      { date: "2033-07-18", price: 700 },
      { date: "2033-07-20", price: 550 },
    ]);
    const onlyOut = pickWindowDay(w, out, [["2033-08-30", 100]], 7);
    expect(onlyOut).toMatchObject({ chosen: "2033-07-18", combined: false });
  });

  it("sin precios: no elige (el servidor usa el primer día)", () => {
    expect(pickWindowDay(w, []).chosen).toBeNull();
  });

  it("con la caché del mes de Aviasales: elige el día y respeta el día que eligió el usuario", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        calls.push(url.hostname);
        const items = [
          { price: 610, departure_at: "2033-07-16T03:00:00-03:00", return_at: "2033-07-23T13:00:00-03:00" },
          { price: 498, departure_at: "2033-07-18T03:00:00-03:00", return_at: "2033-07-25T13:00:00-03:00" },
          { price: 300, departure_at: "2033-07-05T03:00:00-03:00", return_at: "2033-07-12T13:00:00-03:00" },
        ];
        if (url.pathname.includes("grouped_prices")) return Response.json({ success: true, data: {} });
        return Response.json({ success: true, data: items });
      }),
    );
    const req = { origin: "BUE", depart: "2033-07-16", window: w };
    const r = await chooseWindowDay("tok", req, "REC", "REC", 7);
    expect(r).toMatchObject({ chosen: "2033-07-18", pinned: false, basis: "ida y vuelta" });
    expect(r!.days).toEqual([
      { date: "2033-07-16", price: 610 },
      { date: "2033-07-18", price: 498 },
    ]);
    // Nunca Google para recorrer los días.
    expect(calls.every((h) => h !== "serpapi.com")).toBe(true);
    const pinned = await chooseWindowDay("tok", { ...req, depart: "2033-07-16", pinned: true }, "REC", "REC", 7);
    expect(pinned).toMatchObject({ chosen: "2033-07-16", pinned: true });
  });
});

describe("fechas flexibles en la URL", () => {
  it("ida y vuelta de los parámetros (con y sin día elegido)", () => {
    const window = { from: "2033-07-16", to: "2033-07-31" };
    for (const d of [
      { depart: "2033-07-16", window, pinned: null },
      { depart: "2033-07-16", window, pinned: "2033-07-20" },
      { depart: "2033-03-02", window: null, pinned: null },
    ]) {
      const q = new URLSearchParams({ tipo: "viaje", ...tripDatesToParams(d) });
      expect(tripDatesFromParams(new URLSearchParams(q.toString()))).toEqual(d);
    }
  });

  it("descarta ventanas inválidas y días fuera de la ventana", () => {
    expect(windowFromParam("2033-07-31_2033-07-16")).toBeNull();
    expect(windowFromParam("2033-07-01_2033-09-01")).toBeNull();
    expect(windowFromParam("basura")).toBeNull();
    expect(validWindow({ from: "2033-07-16", to: "2033-07-16" })).toBe(true);
    const q = new URLSearchParams({ depart: "2033-07-16", win: windowToParam({ from: "2033-07-16", to: "2033-07-31" }), dia: "2033-08-02" });
    expect(tripDatesFromParams(q).pinned).toBeNull();
  });

  it("atajos y descripción", () => {
    const q = quickWindows(2033, 7);
    expect(q.map((x) => x.label)).toEqual(["Primera quincena de julio", "Segunda quincena de julio", "Todo julio"]);
    expect(q[1].window).toEqual({ from: "2033-07-16", to: "2033-07-31" });
    expect(quickWindows(2032, 2)[1].window.to).toBe("2032-02-29");
    expect(describeWindow(q[1].window)).toBe("segunda quincena de julio (16 al 31 jul)");
    expect(describeWindow({ from: "2033-07-28", to: "2033-08-05" })).toBe("del 28 jul al 5 ago");
  });
});

describe("detalle del vuelo: llegada y +1", () => {
  it("calcula la llegada solo con huso fijo conocido", () => {
    // Salida 13:10 de Recife (UTC-3), 12 h 40 min: llega a Buenos Aires (UTC-3) a las 01:50 del día siguiente.
    expect(arrivalFromDuration("2033-02-11T13:10:00-03:00", 760, "EZE")).toBe("2033-02-12T01:50");
    // Lima está en UTC-5.
    expect(arrivalFromDuration("2033-02-11T10:00:00-03:00", 300, "LIM")).toBe("2033-02-11T13:00");
    // Madrid tiene horario de verano: no inventamos la hora.
    expect(arrivalFromDuration("2033-02-11T10:00:00-03:00", 720, "MAD")).toBeNull();
    // Sin huso en la salida, tampoco.
    expect(arrivalFromDuration("2033-02-11 10:00", 120, "REC")).toBeNull();
  });

  it("formato +1 y la frase de llegada", () => {
    expect(arrivalInfo("2033-02-11T13:10", "2033-02-12T01:50")).toEqual({ time: "01:50", plus: 1, note: "Llegás un día después, el 12 feb a las 01:50" });
    expect(arrivalInfo("2033-02-01T03:00", "2033-02-01T16:25")).toEqual({ time: "16:25", plus: 0, note: null });
    expect(arrivalInfo("2033-02-01T03:00", null)).toBeNull();
  });

  it("resultado de Aviasales: ida y vuelta con horarios, opciones sin repetir", () => {
    const r: FlightResult = {
      price: 520,
      airline: "G3",
      flightNumber: "G37460",
      origin: "EZE",
      destination: "REC",
      departAt: "2033-02-01T03:00:00-03:00",
      returnAt: "2033-02-11T13:10:00-03:00",
      stops: 2,
      returnStops: 2,
      durationOut: 805,
      durationBack: 760,
      link: null,
    };
    const info = infoFromResult(r);
    expect(info.out).toMatchObject({ from: "EZE", to: "REC", departAt: "2033-02-01T03:00", arriveAt: "2033-02-01T16:25", stops: 2 });
    expect(info.back).toMatchObject({ from: "REC", to: "EZE", departAt: "2033-02-11T13:10", arriveAt: "2033-02-12T01:50" });
    const opts = legOptions([r, { ...r, price: 530 }, { ...r, airline: "LA", price: 600 }]);
    expect(opts.map((o) => [o.airline, o.price])).toEqual([
      ["G3", 520],
      ["LA", 600],
    ]);
  });

  it("equipaje estimado: un tramo de ida y vuelta cuenta doble", () => {
    const party = { adults: 1, childAges: [12], bags: "cabin" as const };
    const rt = tripBagsCost(party, [{ country: "Brasil", roundTrip: true }]);
    const two = tripBagsCost(party, [
      { country: "Brasil", roundTrip: false },
      { country: "Brasil", roundTrip: false },
    ]);
    expect(rt).toBe(two);
    expect(rt).toBeGreaterThan(0);
    expect(tripBagsCost({ ...party, bags: "personal" }, [{ country: "Brasil", roundTrip: true }])).toBe(0);
  });
});

describe("traslado aeropuerto–hotel", () => {
  const leg = (p: Partial<TripLeg>): TripLeg =>
    ({ kind: "flight", role: "out", after: null, label: "", from: "BUE", to: "REC", date: "2033-07-18", returnDate: null, price: null, priceKind: null, priceDate: null, priceSource: null, airline: null, stops: null, link: null, liveUrl: null, km: null, hours: null, mapsUrl: null, ...p }) as TripLeg;
  const stop = (name: string, km: number) => ({
    name,
    country: "Brasil",
    region: null,
    lat: 0,
    lon: 0,
    nights: 4,
    checkin: "",
    checkout: "",
    airport: { code: "REC", city: "REC", name: "Guararapes", km },
  });

  it("ida al llegar en avión y vuelta al irse en avión (por tierra entre paradas no cuenta)", () => {
    const plan: Pick<TripPlan, "stops" | "legs"> = {
      stops: [stop("Maragogi", 120), stop("Porto de Galinhas", 50)],
      legs: [leg({ role: "out" }), leg({ kind: "ground", role: "between", after: 0 }), leg({ role: "back", from: "REC", to: "BUE" })],
    };
    const t = planTransfers(plan, () => "https://x");
    expect(t.map((x) => x?.ways)).toEqual([["ida"], ["vuelta"]]);
    expect(t[0]!.perWayUSD).toBeGreaterThan(t[1]!.perWayUSD);
    const roundTrip = planTransfers({ stops: [stop("Recife", 10)], legs: [leg({ returnDate: "2033-07-25" })] });
    expect(roundTrip[0]?.ways).toEqual(["ida", "vuelta"]);
  });

  it("los totales respetan lo que se quita", () => {
    const party = { adults: 1, childAges: [12], bags: "cabin" as const };
    const t: AirportTransfer = { airport: "REC", km: 50, ways: ["ida", "vuelta"], perWayUSD: 60, link: null };
    expect(transferCost(t, party)).toBe(120);
    // 4 personas: dos autos.
    expect(transferCost(t, { ...party, adults: 4 })).toBe(240);
    expect(transfersTotal([t, null, t], party)).toBe(240);
    expect(transfersTotal([t, null, t], party, { 2: true })).toBe(120);
    const parts = { flights: 1000, stays: 700, ground: 50, transfers: 120, bags: 100 };
    expect(tripTotal(parts, { ground: true, transfers: true, bags: true })).toBe(1970);
    expect(tripTotal(parts, { ground: false, transfers: false, bags: false })).toBe(1700);
    expect(tripTotal(parts, { ground: true, transfers: false, bags: true })).toBe(1850);
  });

  it("horarios: ida a la llegada, vuelta 3 h antes (internacional) o 2 h (cabotaje)", () => {
    expect(transferTimes("2033-07-18T16:25", "2033-07-25T13:10", true)).toEqual({ ida: "2033-07-18T16:25", vuelta: "2033-07-25T10:10" });
    expect(transferTimes(null, "2033-07-25T01:30", false)).toEqual({ ida: null, vuelta: "2033-07-24T23:30" });
    expect(minusHours("2033-03-01T02:00", 3)).toBe("2033-02-28T23:00");
  });

  it("planTrip: Maragogi + Porto de Galinhas con ventana, horarios del vuelo y traslados", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.includes("/v1/prices/cheap")) return Response.json({ success: true, data: { REC: { 0: { price: 380 } } } });
        if (url.pathname.includes("grouped_prices")) return Response.json({ success: true, data: {} });
        const dep = url.searchParams.get("departure_at") ?? "";
        const from = url.searchParams.get("origin");
        const oneWay = url.searchParams.get("one_way") === "true";
        if (dep.length === 10) {
          // Día exacto: dos vuelos para "Cambiar vuelo".
          const ret = url.searchParams.get("return_at");
          const back = ret ? { return_at: `${ret}T13:10:00-03:00`, return_transfers: 1, duration_back: 760 } : {};
          return Response.json({
            success: true,
            data: [
              { origin: from, destination: url.searchParams.get("destination"), price: 300, airline: "G3", flight_number: 1, departure_at: `${dep}T03:00:00-03:00`, transfers: 1, duration: 600, duration_to: 600, link: "/s/1", ...back },
              { origin: from, destination: url.searchParams.get("destination"), price: 340, airline: "LA", flight_number: 2, departure_at: `${dep}T10:00:00-03:00`, transfers: 0, duration: 420, duration_to: 420, link: "/s/2", ...back },
            ],
          });
        }
        if (oneWay) return Response.json({ success: true, data: [] });
        // Mes (ida y vuelta a Recife, 7 noches): lo más barato sale el 20.
        const days = [
          ["2034-07-17", "2034-07-24", 400],
          ["2034-07-20", "2034-07-27", 250],
          ["2034-07-08", "2034-07-15", 100],
        ];
        return Response.json({ success: true, data: days.map(([d, r, p]) => ({ price: p, departure_at: `${d}T08:00:00-03:00`, return_at: `${r}T08:00:00-03:00` })) });
      }),
    );
    const plan = await planTrip(
      "tok",
      {
        origin: "BUE",
        depart: "2034-07-16",
        window: { from: "2034-07-16", to: "2034-07-31" },
        stops: [
          { name: "Maragogi", country: "Brasil", lat: -9.012, lon: -35.222, nights: 4 },
          { name: "Porto de Galinhas", country: "Brasil", lat: -8.505, lon: -35.006, nights: 3 },
        ],
      },
      "789588",
      undefined,
      "585192",
    );
    // Las dos paradas usan Recife: ida y vuelta, y por tierra entre Maragogi y Porto de Galinhas.
    expect(plan.window).toMatchObject({ chosen: "2034-07-20", basis: "ida y vuelta" });
    expect(plan.depart).toBe("2034-07-20");
    expect(plan.ret).toBe("2034-07-27");
    const out = plan.legs.find((l) => l.role === "out")!;
    expect(out.flight?.out).toMatchObject({ departAt: "2034-07-20T03:00", durationMin: 600 });
    expect(out.flight?.back).toMatchObject({ departAt: "2034-07-27T13:10", arriveAt: "2034-07-28T01:50" });
    expect(out.options?.length).toBe(2);
    expect(plan.stops.map((s) => s.transfer?.ways)).toEqual([["ida"], ["vuelta"]]);
    expect(plan.stops[0].transfer!.link).toContain("tp.media/r");
  });
});

describe("pedir cotización por WhatsApp", () => {
  it("texto en primera persona con el grupo, paradas, ventana y precios con su etiqueta", () => {
    const text = quoteText({
      origin: "Buenos Aires",
      party: { adults: 1, childAges: [12] },
      stops: [
        { name: "Maragogi", nights: 4 },
        { name: "Porto de Galinhas", nights: 3 },
      ],
      depart: "2033-07-18",
      ret: "2033-07-25",
      window: { from: "2033-07-16", to: "2033-07-31" },
      lodging: ["Maragogi, pousada frente al mar"],
      prices: [{ label: "Vuelo de ida BUE–REC", amount: "USD 600", note: "Visto en los últimos días" }],
      total: "USD 2.100",
    });
    expect(text).toContain("2 personas: 1 adulto y un menor de 12 años");
    expect(text).toContain("4 noches en Maragogi y 3 noches en Porto de Galinhas");
    expect(text).toContain("segunda quincena de julio (16 al 31 jul)");
    expect(text).toContain("sale el 18 jul y vuelve el 25 jul");
    expect(text).toContain("- Vuelo de ida BUE–REC: USD 600 (visto en los últimos días)");
    expect(text).toContain("Total aproximado: USD 2.100");
    expect(text).toContain("cuotas");
    expect(EMOJI.test(text)).toBe(false);
    const url = whatsappUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(text);
  });

  it("desde un viaje guardado (sin detalle del grupo)", () => {
    const pkg = {
      id: "p",
      destinationId: "geo-x",
      destinationName: "Recife",
      origin: "BUE",
      departDate: "2033-02-01",
      returnDate: "2033-02-11",
      travelers: 2,
      style: "mid",
      items: [{ kind: "vuelo", label: "Vuelo ida y vuelta BUE–REC", amountUSD: 1040 }],
      totalUSD: 1040,
      createdAt: "2033-01-01T00:00:00Z",
      status: "idea",
    } as TripPackage;
    const text = quoteText(packageQuoteInput(pkg, (n) => `USD ${n}`, () => "Estimado"));
    expect(text).toContain("para 2 personas.");
    expect(text).toContain("10 noches en Recife");
    expect(text).toContain("Fechas: del 1 feb al 11 feb.");
    expect(text).toContain("- Vuelo ida y vuelta BUE–REC: USD 1040 (estimado)");
  });
});
