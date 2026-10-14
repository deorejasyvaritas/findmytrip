// Cuentas del lado de la web para comparar destinos y armar alertas desde los
// resultados. Siguen las mismas reglas que tripCost (server/engine.ts): el
// alojamiento varía con la raíz de la temporada y comidas y paseos van aparte.

import type { Destination, Party, Style } from "./types.ts";
import { bagsCost, dailyUnits, fareUnits, headcount, roomsForParty } from "./pricing.ts";

/** Alojamiento por habitación y por noche para un estilo y un mes (1-12). */
export const lodgingFor = (dest: Destination, style: Style, month: number) =>
  Math.round(dest.lodgingUSD[style] * Math.sqrt(dest.season[month - 1] ?? 1));

export interface TripEstimate {
  flights: number;
  bags: number;
  lodging: number;
  /** Comidas y paseos (aparte del total). */
  daily: number;
  /** Vuelos + equipaje + alojamiento. */
  total: number;
  perPerson: number;
}

export function estimateTrip(dest: Destination, flightPP: number, month: number, nights: number, party: Party, style: Style): TripEstimate {
  const flights = Math.round(flightPP * fareUnits(party));
  const bags = bagsCost(party, dest.region);
  const lodging = lodgingFor(dest, style, month) * nights * roomsForParty(party);
  const daily = Math.round(dest.dailyUSD[style] * (nights + 1) * dailyUnits(party));
  const total = Math.round(flights + bags + lodging);
  return { flights, bags, lodging, daily, total, perPerson: Math.round(total / headcount(party)) };
}

/** Índices de los valores más bajos (puede haber empate); vacío si hay menos de dos datos. */
export function lowest(values: (number | null | undefined)[]): Set<number> {
  const known = values.filter((v): v is number => typeof v === "number");
  if (known.length < 2) return new Set();
  const min = Math.min(...known);
  if (known.every((v) => v === min)) return new Set();
  return new Set(values.flatMap((v, i) => (v === min ? [i] : [])));
}
