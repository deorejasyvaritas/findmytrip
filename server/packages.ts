import type { Destination, PackageItem, Party, Style, TripPackage } from "../shared/types.ts";
import { flightLinks, stayLinks } from "../shared/links.ts";
import { BAGS_LABEL, describeParty, headcount, roomsForParty } from "../shared/pricing.ts";
import { addDays, flightEstimateForDate, lodgingNightly, toParty, tripCost } from "./engine.ts";

export interface BuildPackageInput {
  dest: Destination;
  origin: string;
  departDate: string;
  nights: number;
  /** Grupo completo (edades y equipaje) o, por compatibilidad, cantidad de adultos. */
  party?: Party;
  travelers?: number;
  style: Style;
  /** Precio de vuelo por adulto elegido (si no, se estima para la fecha). */
  flightPP?: number;
  /** Sumar comidas y paseos al total (por defecto van aparte, como en el resto de la app). */
  includeDaily?: boolean;
  notes?: string;
}

/** Arma un paquete con las mismas reglas de costo que el explorador (tripCost). */
export function buildPackage(input: BuildPackageInput): TripPackage {
  const { dest, origin, departDate, nights, style } = input;
  const party = input.party ?? toParty(input.travelers ?? 2);
  const travelers = headcount(party);
  const includeDaily = input.includeDaily ?? false;
  const returnDate = addDays(departDate, nights);
  const month = Number(departDate.slice(5, 7));
  const flightPP = input.flightPP ?? flightEstimateForDate(origin, dest, departDate);
  const rooms = roomsForParty(party);
  const nightly = lodgingNightly(dest, style, month);
  const cost = tripCost(origin, dest, month, nights, party, style, flightPP, undefined, includeDaily);

  const items: PackageItem[] = [
    {
      kind: "vuelo",
      label: `Vuelo ${origin} ⇄ ${dest.iata} (${describeParty(party)}, USD ${flightPP} por adulto)`,
      amountUSD: cost.flights,
      link: flightLinks(origin, dest.iata, departDate, returnDate, travelers)[0].url,
    },
    ...(cost.bags > 0
      ? [{ kind: "extra" as const, label: `Equipaje: ${BAGS_LABEL[party.bags].toLowerCase()} por persona, ida y vuelta (estimado)`, amountUSD: cost.bags }]
      : []),
    {
      kind: "alojamiento",
      label: `Alojamiento ${nights} noches en ${dest.areas[0]} (${rooms} hab. × USD ${nightly})`,
      amountUSD: cost.lodging,
      link: stayLinks(`${dest.areas[0]}, ${dest.name}`, departDate, returnDate, travelers, rooms)[0].url,
    },
    ...(includeDaily
      ? [{ kind: "gastos" as const, label: `Comidas, traslados y actividades (${nights + 1} días, estimado)`, amountUSD: cost.daily }]
      : []),
  ];
  const dailyNote = includeDaily ? "" : `Comidas y paseos aparte: aprox. USD ${cost.daily.toLocaleString("es-AR")} (estimado).`;

  return {
    id: `pkg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    destinationId: dest.id,
    destinationName: dest.name,
    origin,
    departDate,
    returnDate,
    travelers,
    style,
    items,
    totalUSD: cost.total,
    notes: [input.notes, dailyNote].filter(Boolean).join(" ") || undefined,
    createdAt: new Date().toISOString(),
    status: "idea",
  };
}
