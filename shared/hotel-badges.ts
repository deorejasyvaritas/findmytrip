// Qué ofrece cada hotel (all inclusive, desayuno, playa, check-in) según lo que
// dice la fuente, y cómo se muestra sin prometer de más: el precio de Google
// Hotels es la tarifa más baja entre sitios y puede ser solo alojamiento.

import type { MealPlan, RealHotel } from "./types.ts";

type Badges = Pick<RealHotel, "allInclusive" | "breakfast" | "beach">;

// Google Hotels devuelve las comodidades en el idioma pedido (hl=es) o en inglés.
const ALL_INCLUSIVE = /all[\s-]?inclusive|todo incluido/i;
const FREE_BREAKFAST = /free breakfast|breakfast included|desayuno (gratis|incluido|sin cargo)/i;
const PAID_BREAKFAST = /breakfast\s*\(\$\)|desayuno\s*\(\$\)|desayuno \(pago\)|desayuno disponible|breakfast available/i;
const BEACH = /beach access|beachfront|private beach|acceso a la playa|frente a la playa|playa privada/i;

/** Comodidades de Google Hotels (`amenities`) a datos compactos. */
export function googleBadges(amenities: string[] | undefined, name = ""): Badges {
  const list = amenities ?? [];
  const has = (re: RegExp) => list.some((a) => re.test(a));
  return {
    // Google dice "All-inclusive available": lo ofrece, no que la tarifa lo incluya.
    allInclusive: has(ALL_INCLUSIVE) ? "offered" : null,
    breakfast: has(FREE_BREAKFAST) ? "included" : has(PAID_BREAKFAST) ? "paid" : null,
    beach: has(BEACH) ? "access" : beachByName(name),
  };
}

/**
 * Etiquetas de TripAdvisor (Xotelo): `merchandising_labels` ("All inclusive",
 * "Breakfast included") dicen que hay tarifas así, no que la más barata lo sea.
 * Un "Resort (All-Inclusive)" vende solo todo incluido: ahí la tarifa lo incluye.
 */
export function xoteloBadges(labels: string[] | undefined, type: string | null | undefined, name = ""): Badges {
  const list = labels ?? [];
  const aiResort = Boolean(type && ALL_INCLUSIVE.test(type));
  return {
    allInclusive: aiResort ? "included" : list.some((l) => ALL_INCLUSIVE.test(l)) ? "offered" : null,
    breakfast: aiResort ? "included" : list.some((l) => /breakfast/i.test(l)) ? "offered" : null,
    beach: beachByName(name),
  };
}

// Palabras que en el nombre suelen indicar que está sobre la playa. Conservador:
// "Mar" solo, "Ocean" o "Sea" no alcanzan (hay muchos "Hotel Mar del Plata").
const BEACH_NAME = /\b(beach|beachfront|praia|playa|pé na areia|pe na areia|frente al mar|frente ao mar|beira[\s-]mar|seafront|oceanfront)\b/i;

/** Indicio por el nombre (hay que verificarlo en el mapa). */
export function beachByName(name: string): "name" | null {
  return BEACH_NAME.test(name) ? "name" : null;
}

/** "3:00 PM" / "15:00" / "15 h" -> "15:00". */
export function normalizeCheckIn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? "00";
  const ampm = m[3]?.toLowerCase().replace(/[.\s]/g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || Number(min) > 59) return null;
  return `${String(h).padStart(2, "0")}:${min}`;
}

export interface Badge {
  label: string;
  /** ok = lo dice la fuente · warn = ojo, puede no estar en el precio · info = dato. */
  tone: "ok" | "warn" | "info";
}

/** Insignias para la tarjeta del hotel, honestas respecto del precio mostrado. */
export function hotelBadges(h: Badges & Pick<RealHotel, "checkIn">, mealPlan: MealPlan = "room"): Badge[] {
  const out: Badge[] = [];
  if (h.allInclusive === "included") out.push({ label: "Resort all inclusive", tone: "ok" });
  else if (h.allInclusive === "offered")
    out.push(
      mealPlan === "all"
        ? { label: "Ofrece all inclusive · el precio mostrado puede ser solo alojamiento", tone: "warn" }
        : { label: "Ofrece all inclusive", tone: "info" },
    );
  if (h.allInclusive !== "included") {
    if (h.breakfast === "included") out.push({ label: "Desayuno incluido", tone: "ok" });
    else if (h.breakfast === "offered")
      out.push({ label: mealPlan === "breakfast" ? "Tiene tarifas con desayuno · confirmalo en la tarifa" : "Tiene tarifas con desayuno", tone: mealPlan === "breakfast" ? "warn" : "info" });
    else if (h.breakfast === "paid") out.push({ label: "Desayuno aparte", tone: "info" });
  }
  if (h.beach === "access") out.push({ label: "Acceso a la playa", tone: "ok" });
  else if (h.beach === "name") out.push({ label: "Playa en el nombre · verificalo en el mapa", tone: "info" });
  if (h.checkIn) out.push({ label: `Check-in desde ${h.checkIn}`, tone: "info" });
  return out;
}

/** Qué tan bien encaja el hotel con el régimen pedido (para ordenar: más es mejor). */
export function mealPlanMatch(h: Badges, mealPlan: MealPlan): number {
  if (mealPlan === "all") return h.allInclusive === "included" ? 2 : h.allInclusive === "offered" ? 1 : 0;
  if (mealPlan === "breakfast" || mealPlan === "half")
    return h.allInclusive === "included" || h.breakfast === "included" ? 2 : h.breakfast === "offered" ? 1 : 0;
  return 0;
}

/** Filtros de los selectores de hotel: régimen (preferir) y frente al mar (filtrar). */
export function sortHotelsFor<T extends RealHotel>(hotels: T[], mealPlan: MealPlan, beachfront: boolean): T[] {
  const pool = beachfront ? hotels.filter((h) => h.beach) : hotels;
  if (mealPlan === "room") return pool;
  // Estable: dentro de cada grupo queda el orden original (precio).
  return pool
    .map((h, i) => ({ h, i, m: mealPlanMatch(h, mealPlan) }))
    .sort((a, b) => b.m - a.m || a.i - b.i)
    .map((x) => x.h);
}

/** ¿El precio mostrado incluye el régimen pedido? (si no, se avisa y se ofrece el link con el filtro). */
export function priceIncludesPlan(h: Badges, mealPlan: MealPlan): boolean {
  if (mealPlan === "room") return true;
  if (mealPlan === "all") return h.allInclusive === "included";
  if (mealPlan === "breakfast") return h.allInclusive === "included" || h.breakfast === "included";
  return h.allInclusive === "included";
}
