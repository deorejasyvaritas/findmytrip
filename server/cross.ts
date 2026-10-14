import type { CrossOption, CrossResult, Destination } from "../shared/types.ts";
import { airportsFor, routeCheapest } from "./providers/flights.ts";

// "Cruzá y volá": a veces conviene salir desde otra ciudad (Montevideo,
// Santiago, San Pablo) aunque haya que sumar el cruce. Comparamos con
// precios reales de Aviasales del mismo mes.

interface Alt {
  code: string;
  name: string;
  /** Cómo se llega desde la ciudad de origen. */
  crossing: string;
  /** Si el cruce es en avión, su código para buscar el precio real; si no, costo fijo estimado. */
  flight?: boolean;
  /** Costo estimado ida y vuelta por persona, en USD (si no hay precio real). */
  estimateUSD: number;
}

const ALTERNATIVES: Record<string, Alt[]> = {
  BUE: [
    { code: "MVD", name: "Montevideo", crossing: "Ferry a Montevideo ida y vuelta (Buquebus, o Colonia Express + bus)", estimateUSD: 120 },
    { code: "SCL", name: "Santiago de Chile", crossing: "Vuelo a Santiago ida y vuelta", flight: true, estimateUSD: 220 },
    { code: "SAO", name: "San Pablo", crossing: "Vuelo a San Pablo ida y vuelta", flight: true, estimateUSD: 280 },
  ],
  MDZ: [{ code: "SCL", name: "Santiago de Chile", crossing: "Bus a Santiago ida y vuelta (cruce de los Andes)", estimateUSD: 70 }],
  COR: [{ code: "SCL", name: "Santiago de Chile", crossing: "Vuelo a Santiago ida y vuelta", flight: true, estimateUSD: 220 }],
};

/** Mínimo ahorro por persona para recomendar el cruce. */
export const MIN_SAVING = 40;

/** Precio a un destino probando el código de ciudad y sus aeropuertos (EZE, AEP...). */
async function priceTo(token: string, origin: string, dest: Destination, month: string): Promise<number | undefined> {
  for (const code of [...new Set([dest.iata, ...airportsFor(dest.iata).split(",")])]) {
    const p = await routeCheapest(token, origin, code, month);
    if (p) return p;
  }
  return undefined;
}

export async function crossAndFly(token: string | undefined, origin: string, dest: Destination, month: string): Promise<CrossResult> {
  const alts = (ALTERNATIVES[origin] ?? []).filter((a) => a.code !== dest.iata);
  if (!token || !alts.length) return { baseUSD: null, options: [] };
  // Una consulta chica por ruta (no el listado de todos los destinos): cuida el CPU.
  const [base, fromAlts, crossings] = await Promise.all([
    priceTo(token, origin, dest, month),
    Promise.all(alts.map((a) => priceTo(token, a.code, dest, month))),
    Promise.all(alts.map((a) => (a.flight ? routeCheapest(token, origin, a.code, month) : Promise.resolve(null)))),
  ]);
  const baseUSD = base ?? null;
  const options: CrossOption[] = [];
  alts.forEach((a, i) => {
    const flightUSD = fromAlts[i];
    if (!flightUSD) return;
    const realCrossing = crossings[i] ?? undefined;
    const crossingUSD = realCrossing ?? a.estimateUSD;
    const totalUSD = flightUSD + crossingUSD;
    options.push({
      origin: a.code,
      name: a.name,
      crossing: a.crossing,
      crossingUSD,
      crossingSource: realCrossing ? "aviasales" : "estimado",
      flightUSD,
      totalUSD,
      savingUSD: baseUSD ? baseUSD - totalUSD : null,
    });
  });
  options.sort((a, b) => a.totalUSD - b.totalUSD);
  return { baseUSD, options };
}
