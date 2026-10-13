import type { Destination, PackageItem, Style, TripPackage } from "../shared/types.ts";
import { flightLinks, stayLinks } from "../shared/links.ts";
import { addDays, flightEstimateForDate, lodgingNightly, roomsFor } from "./engine.ts";

export interface BuildPackageInput {
  dest: Destination;
  origin: string;
  departDate: string;
  nights: number;
  travelers: number;
  style: Style;
  /** Precio de vuelo por persona elegido (si no, se estima para la fecha). */
  flightPP?: number;
  notes?: string;
}

export function buildPackage(input: BuildPackageInput): TripPackage {
  const { dest, origin, departDate, nights, travelers, style } = input;
  const returnDate = addDays(departDate, nights);
  const month = Number(departDate.slice(5, 7));
  const flightPP = input.flightPP ?? flightEstimateForDate(origin, dest, departDate);
  const rooms = roomsFor(travelers);
  const nightly = lodgingNightly(dest, style, month);

  const items: PackageItem[] = [
    {
      kind: "vuelo",
      label: `Vuelo ${origin} ⇄ ${dest.iata} (${travelers} × USD ${flightPP})`,
      amountUSD: flightPP * travelers,
      link: flightLinks(origin, dest.iata, departDate, returnDate, travelers)[0].url,
    },
    {
      kind: "alojamiento",
      label: `Alojamiento ${nights} noches en ${dest.areas[0]} (${rooms} hab. × USD ${nightly})`,
      amountUSD: nightly * nights * rooms,
      link: stayLinks(`${dest.areas[0]}, ${dest.name}`, departDate, returnDate, travelers, rooms)[0].url,
    },
    {
      kind: "gastos",
      label: `Comidas, traslados y actividades (${nights + 1} días × ${travelers} × USD ${dest.dailyUSD[style]})`,
      amountUSD: dest.dailyUSD[style] * (nights + 1) * travelers,
    },
  ];

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
    totalUSD: items.reduce((s, i) => s + i.amountUSD, 0),
    notes: input.notes,
    createdAt: new Date().toISOString(),
    status: "idea",
  };
}
