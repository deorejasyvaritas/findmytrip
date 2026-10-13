// Reglas de precio por pasajero y equipaje, compartidas por la web y la API.
// Son aproximaciones de mercado para estimar; el precio final siempre se
// confirma en el sitio de reserva.

import type { Bags, Party, Region } from "./types.ts";

export const DEFAULT_PARTY: Party = { adults: 2, childAges: [], bags: "cabin" };

export const BAGS_LABEL: Record<Bags, string> = {
  personal: "Solo mochila",
  cabin: "Carry-on",
  checked1: "1 valija",
  checked2: "2 valijas",
};

/** Personas que viajan (adultos + menores). */
export const headcount = (p: Party) => p.adults + p.childAges.length;

/**
 * Equivalente en "pasajes de adulto": bebés (menos de 2 años, en brazos)
 * pagan ~10 %, niños de 2 a 11 ~75 %, desde 12 tarifa completa.
 */
export function fareUnits(p: Party): number {
  return p.childAges.reduce((sum, age) => sum + (age < 2 ? 0.1 : age < 12 ? 0.75 : 1), p.adults);
}

/** Gastos diarios: bebés 0, niños de 2 a 11 ~60 %, desde 12 como adultos. */
export function dailyUnits(p: Party): number {
  return p.childAges.reduce((sum, age) => sum + (age < 2 ? 0 : age < 12 ? 0.6 : 1), p.adults);
}

/** Habitaciones: dos adultos (o mayores de 12) por habitación; los chicos comparten. */
export function roomsForParty(p: Party): number {
  const grown = p.adults + p.childAges.filter((a) => a >= 12).length;
  return Math.max(1, Math.ceil(grown / 2));
}

// Costo aproximado de una valija despachada por tramo (ida o vuelta), en USD.
// En vuelos largos a Europa y Asia la primera valija suele estar incluida.
const CHECKED_BAG_PER_LEG: Record<Region, [number, number]> = {
  Argentina: [30, 45],
  "Sudamérica": [45, 65],
  "Caribe y Centroamérica": [55, 80],
  "Norteamérica": [60, 90],
  Europa: [0, 90],
  Asia: [0, 100],
  "África y Medio Oriente": [0, 100],
};
const CABIN_BAG_PER_LEG: Record<Region, number> = {
  Argentina: 15,
  "Sudamérica": 25,
  "Caribe y Centroamérica": 30,
  "Norteamérica": 30,
  Europa: 0,
  Asia: 0,
  "África y Medio Oriente": 0,
};

/** Costo extra de equipaje ida y vuelta para todo el grupo (bebés no llevan). */
export function bagsCost(p: Party, region: Region): number {
  const people = p.adults + p.childAges.filter((a) => a >= 2).length;
  const [first, second] = CHECKED_BAG_PER_LEG[region];
  const perLeg =
    p.bags === "personal" ? 0 : p.bags === "cabin" ? CABIN_BAG_PER_LEG[region] : p.bags === "checked1" ? first : first + second;
  return perLeg * 2 * people;
}

export function describeParty(p: Party): string {
  const kids = p.childAges.filter((a) => a >= 2).length;
  const babies = p.childAges.length - kids;
  const parts = [`${p.adults} ${p.adults === 1 ? "adulto" : "adultos"}`];
  if (kids) parts.push(`${kids} ${kids === 1 ? "niño" : "niños"}`);
  if (babies) parts.push(`${babies} ${babies === 1 ? "bebé" : "bebés"}`);
  return parts.join(", ");
}

/** Lee el grupo desde parámetros de URL (?adults=2&kids=5,8&bags=cabin). */
export function partyFromParams(params: URLSearchParams, fallback: Party): Party {
  const adults = Number(params.get("adults")) || fallback.adults;
  const kids = params.get("kids");
  const childAges = kids === null ? fallback.childAges : kids.split(",").filter(Boolean).map(Number).filter((n) => n >= 0 && n < 18);
  const bags = (params.get("bags") as Bags | null) ?? fallback.bags;
  return { adults, childAges, bags: bags in BAGS_LABEL ? bags : fallback.bags };
}

export function partyToParams(p: Party): Record<string, string> {
  return { adults: String(p.adults), kids: p.childAges.join(","), bags: p.bags };
}
