import { afterEach, describe, expect, it, vi } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { explore, lodgingCost, tripCost } from "../server/engine.ts";
import { googleHotelByName, googleHotels, nameMatches, toRealHotel } from "../server/providers/hotels.ts";
import { sample, xoteloHotels, type ListedHotel } from "../server/providers/xotelo.ts";
import { googleBadges, hotelBadges, normalizeCheckIn, priceIncludesPlan, sortHotelsFor, xoteloBadges } from "../shared/hotel-badges.ts";
import { bookingSearchUrl, stayLinks } from "../shared/links.ts";
import { allInclusiveFor, allInclusiveUnits, dailyFactor } from "../shared/meal-plan.ts";
import { describeRooms, occupancyFactor, roomOccupancy, roomPlan, roomsForParty } from "../shared/pricing.ts";
import type { Party, RealHotel } from "../shared/types.ts";

const today = new Date("2026-10-13T12:00:00Z");
const p = (adults: number, childAges: number[] = []): Party => ({ adults, childAges, bags: "cabin" });

afterEach(() => vi.unstubAllGlobals());

describe("habitaciones como las venden los hoteles", () => {
  it("dos adultos y un adolescente de 15 van en una triple", () => {
    const fam = p(2, [15]);
    expect(roomsForParty(fam)).toBe(1);
    expect(describeRooms(fam)).toBe("3 personas en 1 habitación");
    expect(roomOccupancy(fam)).toEqual({ adults: 2, childAges: [15] });
    // La triple cuesta más que una doble (solo en el estimado).
    expect(occupancyFactor(fam)).toBeCloseTo(1.3);
  });

  it("respeta los límites: 2 adultos por habitación, 4 con chicos, 3 de 12+ solo con un menor", () => {
    expect(roomsForParty(p(1, [14]))).toBe(1); // yo y mi hijo
    expect(roomsForParty(p(2, [5, 8]))).toBe(1); // 2 adultos + 2 chicos
    expect(roomsForParty(p(2, [3, 5, 8]))).toBe(2); // 5 personas no entran en una
    expect(roomsForParty(p(3))).toBe(2); // 3 adultos: sin menor no hay triple
    expect(roomsForParty(p(2, [13, 16]))).toBe(2);
    expect(roomsForParty(p(2, [1, 6, 13]))).toBe(2); // triple con adolescente no suma un chico más
    expect(roomsForParty(p(2, [0]))).toBe(1); // el bebé va en cuna
    expect(describeRooms(p(4))).toBe("4 personas en 2 habitaciones");
    expect(roomPlan(p(4, [15])).map((r) => r.adults + r.childAges.length).sort()).toEqual([2, 3]);
    expect(occupancyFactor(p(2))).toBe(1);
  });
});

describe("régimen y all inclusive", () => {
  const maceio = getDestination("maceio")!;
  const madrid = getDestination("madrid")!;
  const fam = p(2, [15]);

  it("all inclusive: tarifa por persona del destino y comidas que bajan", () => {
    const ai = allInclusiveFor(maceio)!;
    expect(ai).not.toBeNull();
    expect(allInclusiveUnits(p(2, [15, 8, 1]))).toBe(3.5);
    const month = 9;
    const c = tripCost("BUE", maceio, month, 10, fam, "mid", 450, undefined, false, "all");
    const perNight = Math.round(ai.perPersonNight.mid * Math.sqrt(maceio.season[month - 1]) * 3);
    expect(c.mealPlan).toBe("all");
    expect(c.lodging).toBe(perNight * 10);
    // Solo quedan traslados y paseos.
    expect(c.daily).toBe(Math.round(maceio.dailyUSD.mid * 11 * 3 * 0.45));
    const room = tripCost("BUE", maceio, month, 10, fam, "mid", 450);
    expect(c.daily).toBeLessThan(room.daily);
    expect(room.mealPlan).toBeUndefined();
  });

  it("donde no hay all inclusive se calcula solo alojamiento (y no se rotula all inclusive)", () => {
    expect(allInclusiveFor(madrid)).toBeNull();
    const c = tripCost("BUE", madrid, 5, 7, 2, "mid", 1000, undefined, false, "all");
    expect(c.mealPlan).toBeUndefined();
    expect(c).toEqual(tripCost("BUE", madrid, 5, 7, 2, "mid", 1000));
  });

  it("con desayuno el alojamiento sube un poco y las comidas bajan", () => {
    const room = lodgingCost(maceio, "mid", 9, 7, 2, "room");
    const bf = lodgingCost(maceio, "mid", 9, 7, 2, "breakfast");
    expect(bf.total).toBeGreaterThan(room.total);
    expect(bf.total - room.total).toBe(Math.round(maceio.dailyUSD.mid * 0.12) * 2 * 7);
    expect(dailyFactor("breakfast")).toBeCloseTo(0.88);
  });

  it("la búsqueda por presupuesto encuentra all inclusive en Brasil para 3 con USD 4.500", () => {
    const r = explore(
      {
        origin: "BUE",
        budgetUSD: 4500,
        travelers: 2,
        party: fam,
        nights: 10,
        month: null,
        style: "low",
        interests: ["playa"],
        mealPlan: "all",
      },
      undefined,
      today,
    );
    const all = [...r.suggestions, ...r.alternatives];
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(allInclusiveFor(s.destination)).not.toBeNull();
      expect(s.cost.mealPlan).toBe("all");
      expect(s.lodgingSource).toBe("estimado");
    }
    expect(all.some((s) => s.destination.country === "Brasil")).toBe(true);
    expect(all.some((s) => s.destination.id === "madrid")).toBe(false);
  });
});

describe("comodidades de los hoteles", () => {
  it("lee Google Hotels en inglés y en español", () => {
    expect(googleBadges(["Free breakfast", "Beach access", "All-inclusive available"])).toEqual({
      allInclusive: "offered",
      breakfast: "included",
      beach: "access",
    });
    expect(googleBadges(["Desayuno ($)", "Piscina"], "Pousada Ecoporto")).toEqual({ allInclusive: null, breakfast: "paid", beach: null });
    expect(googleBadges(["Todo incluido disponible", "Desayuno gratis"])).toMatchObject({ allInclusive: "offered", breakfast: "included" });
    // La playa en el nombre es solo un indicio.
    expect(googleBadges([], "Brisa Praia Hotel").beach).toBe("name");
    expect(googleBadges([], "Hotel Mar del Plata").beach).toBeNull();
  });

  it("TripAdvisor: un resort all inclusive incluye; la etiqueta sola solo dice que lo ofrece", () => {
    expect(xoteloBadges(["All inclusive", "Breakfast included"], "Resort (All-Inclusive)")).toMatchObject({ allInclusive: "included", breakfast: "included" });
    expect(xoteloBadges(["All inclusive", "Breakfast included"], "Resort")).toMatchObject({ allInclusive: "offered", breakfast: "offered" });
    expect(xoteloBadges([], "Hotel")).toMatchObject({ allInclusive: null, breakfast: null });
  });

  it("hora de check-in", () => {
    expect(normalizeCheckIn("3:00 PM")).toBe("15:00");
    expect(normalizeCheckIn("14:00")).toBe("14:00");
    expect(normalizeCheckIn("12:00 AM")).toBe("00:00");
    expect(normalizeCheckIn(undefined)).toBeNull();
  });

  it("no presenta un precio de solo alojamiento como all inclusive", () => {
    const offered = { allInclusive: "offered" as const, breakfast: null, beach: null, checkIn: "14:00" };
    expect(priceIncludesPlan(offered, "all")).toBe(false);
    const labels = hotelBadges(offered, "all").map((b) => b.label);
    expect(labels).toContain("Ofrece all inclusive · el precio mostrado puede ser solo alojamiento");
    expect(labels).toContain("Check-in desde 14:00");
    expect(priceIncludesPlan({ allInclusive: "included", breakfast: null, beach: null }, "all")).toBe(true);
    expect(hotelBadges({ allInclusive: null, breakfast: "included", beach: "access" }).map((b) => b.label)).toEqual(["Desayuno incluido", "Acceso a la playa"]);
  });

  it("ordena por régimen y filtra frente al mar", () => {
    const h = (name: string, extra: Partial<RealHotel>): RealHotel => ({
      name,
      nightlyUSD: 100,
      totalUSD: 700,
      rating: 4,
      reviews: 10,
      stars: null,
      type: null,
      thumbnail: null,
      link: null,
      ...extra,
    });
    const list = [h("A", {}), h("B", { allInclusive: "offered" }), h("C", { allInclusive: "included", beach: "access" })];
    expect(sortHotelsFor(list, "all", false).map((x) => x.name)).toEqual(["C", "B", "A"]);
    expect(sortHotelsFor(list, "room", true).map((x) => x.name)).toEqual(["C"]);
  });

  it("arma el hotel de Google con comodidades, estrellas y check-in", () => {
    const r = toRealHotel(
      {
        name: "Marupiara Suites",
        rate_per_night: { extracted_lowest: 210.4 },
        hotel_class: "4-star hotel",
        amenities: ["All-inclusive available", "Beach access"],
        check_in_time: "2:00 PM",
      },
      10,
    );
    expect(r).toMatchObject({ nightlyUSD: 210, totalUSD: 2100, stars: 4, allInclusive: "offered", beach: "access", checkIn: "14:00" });
  });
});

describe("links con el régimen", () => {
  it("Booking con filtro de all inclusive, grupo y edades", () => {
    const url = new URL(bookingSearchUrl("Marupiara, Porto de Galinhas", "2027-01-10", "2027-01-20", { adults: 2, childAges: [15] }, 1, "all"));
    expect(url.hostname).toBe("www.booking.com");
    expect(url.searchParams.get("nflt")).toBe("mealplan=4");
    expect(url.searchParams.get("group_adults")).toBe("2");
    expect(url.searchParams.get("group_children")).toBe("1");
    expect(url.searchParams.getAll("age")).toEqual(["15"]);
    expect(url.searchParams.get("no_rooms")).toBe("1");
    expect(url.searchParams.get("selected_currency")).toBe("USD");
    expect(new URL(bookingSearchUrl("X", "2027-01-10", "2027-01-12", 2, 1, "breakfast")).searchParams.get("nflt")).toBe("mealplan=1");
    expect(new URL(bookingSearchUrl("X", "2027-01-10", "2027-01-12", 2, 1)).searchParams.has("nflt")).toBe(false);
  });

  it("los links de comparar llevan el régimen", () => {
    const [booking, expedia] = stayLinks("Punta Cana", "2027-01-10", "2027-01-17", 2, 1, "all");
    expect(new URL(booking.url).searchParams.get("nflt")).toBe("mealplan=4");
    expect(new URL(expedia.url).searchParams.get("mealPlan")).toBe("ALL_INCLUSIVE");
  });
});

describe("proveedores de hoteles", () => {
  it("Xotelo cotiza con la ocupación del grupo y guarda las etiquetas", async () => {
    const aruba = getDestination("aruba")!;
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/list"))
          return Response.json({
            result: {
              list: [1, 2, 3].map((i) => ({
                key: `g147247-d${i}`,
                name: i === 1 ? "Riu Palace Beach" : `Hotel ${i}`,
                accommodation_type: i === 1 ? "Resort (All-Inclusive)" : "Hotel",
                merchandising_labels: i === 2 ? ["Breakfast included"] : [],
                review_summary: { rating: 4.5, count: 100 },
                price_ranges: { minimum: 100 * i },
                geo: { latitude: 12.55, longitude: -70.05 },
              })),
            },
          });
        return Response.json({ result: { rates: [{ name: "Booking.com", rate: 300, tax: 0 }] } });
      }),
    );
    const q = await xoteloHotels(aruba, "2027-03-01", 7, { room: { adults: 2, childAges: [15] }, prefer: "all" });
    const rates = urls.filter((u) => u.includes("/rates")).map((u) => new URL(u).searchParams);
    expect(rates.length).toBe(3);
    expect(rates[0].get("adults")).toBe("2");
    expect(rates[0].get("age_of_children")).toBe("15");
    const riu = q!.hotels.find((h) => h.name === "Riu Palace Beach")!;
    expect(riu).toMatchObject({ allInclusive: "included", beach: "name" });
    expect(q!.hotels.find((h) => h.name === "Hotel 2")).toMatchObject({ breakfast: "offered", allInclusive: null });
  });

  it("la muestra prioriza lo pedido", () => {
    const list: ListedHotel[] = Array.from({ length: 30 }, (_, i) => ({
      key: `k${i}`,
      name: `Hotel ${i}`,
      url: null,
      image: null,
      type: "Hotel",
      rating: 4,
      reviews: 1,
      min: i * 10,
      ...(i % 10 === 0 && { tags: "a" }),
    }));
    const picked = sample(list, "all");
    expect(picked.length).toBe(12);
    expect(picked.slice(0, 3).every((h) => h.tags === "a")).toBe(true);
  });

  it("Google Hotels pide la ocupación de la habitación (con la edad del adolescente)", async () => {
    let asked: URLSearchParams | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("account.json")) return Response.json({ total_searches_left: 200 });
        asked = new URL(url).searchParams;
        return Response.json({
          properties: [1, 2, 3].map((i) => ({
            name: `Hotel ${i}`,
            rate_per_night: { extracted_lowest: 100 * i },
            gps_coordinates: { latitude: -9.66, longitude: -35.73 },
            amenities: i === 1 ? ["Free breakfast"] : [],
          })),
        });
      }),
    );
    const q = await googleHotels("key", getDestination("maceio")!, "2027-05-02", 4, { adults: 2, childAges: [15] });
    expect(asked!.get("adults")).toBe("2");
    expect(asked!.get("children")).toBe("1");
    expect(asked!.get("children_ages")).toBe("15");
    expect(q!.hotels[0]).toMatchObject({ name: "Hotel 1", breakfast: "included" });
  });

  it("buscar por nombre: acepta la ficha directa de Google y descarta otros hoteles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("account.json")) return Response.json({ total_searches_left: 200 });
        return Response.json({
          name: "Ecoporto Hotel",
          rate_per_night: { extracted_lowest: 180 },
          amenities: ["Free breakfast", "Beach access"],
          check_in_time: "2:00 PM",
          gps_coordinates: { latitude: -8.5, longitude: -35.0 },
        });
      }),
    );
    const place = { id: "geo--8.5,-35.0", name: "Porto de Galinhas", country: "Brasil", lat: -8.51, lon: -35.0 };
    const found = await googleHotelByName("key", "Ecoporto", place, "2027-05-06", 3, { adults: 1, childAges: [14] });
    expect(found).toHaveLength(1);
    expect(found![0]).toMatchObject({ name: "Ecoporto Hotel", nightlyUSD: 180, breakfast: "included", beach: "access", checkIn: "14:00" });
    expect(nameMatches("hotel Brisa", "Pousada Brisa Maragogi")).toBe(true);
    expect(nameMatches("Brisa", "Salinas Maragogi")).toBe(false);
  });
});
