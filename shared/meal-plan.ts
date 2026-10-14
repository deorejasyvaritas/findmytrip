// Régimen de comidas (solo alojamiento, desayuno, media pensión, all inclusive):
// cómo cambia el costo del alojamiento y de las comidas, y dónde hay all inclusive.
//
// Supuestos (todo es estimado y se muestra como tal):
// - `dailyUSD` del catálogo (por persona y día) incluye comidas, transporte
//   local y paseos. Las comidas son ~52 %: desayuno 12 %, almuerzo 18 %, cena 22 %.
// - Desayuno y media pensión: lo que se deja de gastar afuera se paga en el
//   hotel (mismo monto), así que se mueve de "comidas" al alojamiento.
// - All inclusive: tarifa por persona y noche (habitación doble) del destino,
//   ajustada por temporada como el alojamiento (raíz del índice). Bebés gratis,
//   chicos de 2 a 11 ~50 %, desde 12 tarifa de adulto (los resorts cobran a
//   los adolescentes como adultos). Las comidas bajan a lo que no son comidas
//   (traslados y paseos, ~45 % del gasto diario): bebidas incluidas.
// - Tarifas all inclusive de referencia (USD por persona y noche, temporada
//   media, 2025-2026): Punta Cana 3★ ~80-90, 4★ ~120-140, 5★ ~220+; Cancún y
//   Riviera Maya ~10-15 % más; nordeste de Brasil (Maragogi, Porto de Galinhas,
//   Praia do Forte) 3★ ~65-75, 4★ ~95-110, 5★ ~170. Ej.: Marupiara (Porto de
//   Galinhas) 10 noches para 3 en Despegar ronda USD 2.500-3.000.

import type { AllInclusiveInfo, Destination, MealPlan, Party, Style } from "./types.ts";

export const MEAL_PLANS: MealPlan[] = ["room", "breakfast", "half", "all"];

export const MEAL_PLAN_LABEL: Record<MealPlan, string> = {
  room: "Solo alojamiento",
  breakfast: "Con desayuno",
  half: "Media pensión",
  all: "All inclusive",
};

export const MEAL_PLAN_SHORT: Record<MealPlan, string> = {
  room: "Solo aloj.",
  breakfast: "Desayuno",
  half: "Media pensión",
  all: "All inclusive",
};

/** Parte del gasto diario que son comidas incluidas en cada régimen. */
const MEAL_SHARE: Record<MealPlan, number> = { room: 0, breakfast: 0.12, half: 0.34, all: 0.55 };

const tier = (low: number, mid: number, high: number): Record<Style, number> => ({ low, mid, high });

const CARIBE: AllInclusiveInfo = { availability: "común", perPersonNight: tier(85, 130, 240) };
const NORDESTE: AllInclusiveInfo = { availability: "algunos", perPersonNight: tier(70, 100, 170) };

/**
 * All inclusive por destino del catálogo. Lo que no está acá usa el campo
 * `allInclusive` del destino o, si no lo tiene, la región (Caribe con playa).
 */
const BY_ID: Record<string, AllInclusiveInfo | null> = {
  "punta-cana": CARIBE,
  cancun: { availability: "común", perPersonNight: tier(100, 150, 280) },
  aruba: { availability: "algunos", perPersonNight: tier(170, 230, 380) },
  "costa-rica": { availability: "algunos", perPersonNight: tier(110, 160, 300) },
  "san-andres": { availability: "común", perPersonNight: tier(75, 110, 170) },
  cartagena: { availability: "algunos", perPersonNight: tier(80, 120, 200) },
  maceio: NORDESTE,
  salvador: { availability: "algunos", perPersonNight: tier(75, 110, 200) },
  florianopolis: { availability: "algunos", perPersonNight: tier(110, 150, 220) },
  // Nordeste de Brasil (si el catálogo los suma).
  "porto-de-galinhas": NORDESTE,
  maragogi: NORDESTE,
  recife: NORDESTE,
  natal: NORDESTE,
  fortaleza: NORDESTE,
  "porto-seguro": NORDESTE,
  "praia-do-forte": NORDESTE,
  "costa-do-sauipe": NORDESTE,
};

/** Dónde se consigue all inclusive y a qué tarifa estimada; null = casi no hay. */
export function allInclusiveFor(dest: Pick<Destination, "id" | "region" | "tags"> & { allInclusive?: AllInclusiveInfo | null }): AllInclusiveInfo | null {
  if (dest.allInclusive !== undefined) return dest.allInclusive;
  if (dest.id in BY_ID) return BY_ID[dest.id];
  if (dest.region === "Caribe y Centroamérica" && dest.tags.includes("playa")) return CARIBE;
  return null;
}

/** Personas que pagan all inclusive: bebés 0, de 2 a 11 la mitad, desde 12 como adultos. */
export function allInclusiveUnits(p: Party): number {
  return p.childAges.reduce((sum, age) => sum + (age < 2 ? 0 : age < 12 ? 0.5 : 1), p.adults);
}

/** Cuánto del gasto diario (por persona) sigue aparte con este régimen. */
export function dailyFactor(plan: MealPlan): number {
  return plan === "all" ? 0.45 : 1 - MEAL_SHARE[plan];
}

/** Comidas que se pagan en el hotel, por persona y noche (desayuno / media pensión). */
export function boardPerPersonNight(dest: Pick<Destination, "dailyUSD">, style: Style, plan: MealPlan): number {
  if (plan !== "breakfast" && plan !== "half") return 0;
  return Math.round(dest.dailyUSD[style] * MEAL_SHARE[plan]);
}

export const isMealPlan = (v: unknown): v is MealPlan => typeof v === "string" && (MEAL_PLANS as string[]).includes(v);
