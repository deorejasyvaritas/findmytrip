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

/** Ocupación de una habitación: adultos y edades de los menores. */
export interface RoomOccupancy {
  adults: number;
  childAges: number[];
}

/**
 * Cómo se reparte el grupo en habitaciones, como lo venden los hoteles (y
 * Despegar): hasta 2 adultos por habitación; hasta 3 personas de 12 años o más
 * si al menos una es menor (habitación triple: 2 adultos + un adolescente);
 * con niños de 2 a 11, hasta 4 personas (2 adultos + 2 chicos). Los bebés
 * (menos de 2) van en cuna y no ocupan cama.
 *
 * Elige la menor cantidad de habitaciones posible.
 */
export function roomPlan(p: Party): RoomOccupancy[] {
  const adults = Math.max(1, p.adults);
  const teens = p.childAges.filter((a) => a >= 12).sort((a, b) => b - a);
  const kids = p.childAges.filter((a) => a >= 2 && a < 12).sort((a, b) => b - a);
  const babies = p.childAges.filter((a) => a < 2);
  const grown = adults + teens.length;
  let r = 1;
  for (; r < 12; r++) {
    // Habitaciones que necesitan 3 personas de 12+ (cada una con un adolescente).
    const triples = Math.max(0, grown - 2 * r);
    const fits = adults <= 2 * r && triples <= Math.min(r, teens.length) && kids.length <= 4 * r - triples - grown;
    if (fits) break;
  }
  const rooms: RoomOccupancy[] = Array.from({ length: r }, () => ({ adults: 0, childAges: [] }));
  for (let i = 0; i < adults; i++) rooms[i % r].adults++;
  const people = (x: RoomOccupancy) => x.adults + x.childAges.filter((a) => a >= 2).length;
  const grownIn = (x: RoomOccupancy) => x.adults + x.childAges.filter((a) => a >= 12).length;
  // Adolescentes: primero donde hay menos personas de 12+.
  for (const t of teens) rooms.slice().sort((a, b) => grownIn(a) - grownIn(b))[0].childAges.push(t);
  // Chicos: en habitaciones con lugar (máximo 4; con 3 de 12+, ninguno más).
  for (const k of kids) {
    const room = rooms.filter((x) => grownIn(x) < 3 && people(x) < 4).sort((a, b) => people(a) - people(b))[0] ?? rooms[0];
    room.childAges.push(k);
  }
  for (const [i, b] of babies.entries()) rooms[i % r].childAges.push(b);
  return rooms;
}

/** Habitaciones para el grupo (ver roomPlan). */
export function roomsForParty(p: Party): number {
  return roomPlan(p).length;
}

/** La habitación con más gente: con su ocupación se piden los precios reales (por habitación). */
export function roomOccupancy(p: Party): RoomOccupancy {
  const plan = roomPlan(p);
  return plan.reduce((a, b) => (b.adults + b.childAges.length > a.adults + a.childAges.length ? b : a), plan[0]);
}

/** "3 personas en 1 habitación", como lo muestran los sitios de reserva. */
export function describeRooms(p: Party): string {
  const people = headcount(p);
  const rooms = roomsForParty(p);
  return `${people} ${people === 1 ? "persona" : "personas"} en ${rooms} ${rooms === 1 ? "habitación" : "habitaciones"}`;
}

/**
 * Recargo estimado por ocupación: una habitación con 3 personas de 12 años o
 * más (triple) cuesta más que una doble. Con Xotelo vimos ~+35 % al pasar de 2
 * a 3 adultos; usamos +30 % por cada persona de 12+ de más. Solo se aplica a
 * precios estimados: los reales ya se piden con la ocupación del grupo.
 */
export function occupancyFactor(p: Party): number {
  const plan = roomPlan(p);
  const extra = plan.reduce((sum, x) => sum + Math.max(0, x.adults + x.childAges.filter((a) => a >= 12).length - 2), 0);
  return 1 + (0.3 * extra) / plan.length;
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
