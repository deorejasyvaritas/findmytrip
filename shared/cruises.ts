// Cruceros: itinerarios típicos que se pueden hacer saliendo desde Argentina o
// volando al puerto. No tenemos una fuente gratis de precios de cruceros (las
// navieras no publican una API y no se puede scrapear), así que acá no hay
// precios: cada itinerario lleva a las salidas reales en un buscador de cruceros
// y, cuando el puerto está afuera, a la búsqueda de vuelos de la app.
//
// Fuentes de los links (revisadas el 2026-10-14, todas devuelven la página):
// - crucero.com.ar: buscador de cruceros con páginas por destino (/d-...),
//   puerto de salida (/pd-...) y naviera (/c-...). Muestra fechas y precios de cada salida.
// - australis.com: sitio oficial de Cruceros Australis (Ushuaia y Punta Arenas).
// Las navieras que "suelen operar" cada ruta salen de sus temporadas publicadas;
// cambian de un año a otro, por eso se muestran como orientación.

export type CruiseZone = "Sudamérica" | "Patagonia y Antártida" | "Caribe" | "Europa" | "Alaska";

export const CRUISE_ZONES: CruiseZone[] = ["Sudamérica", "Patagonia y Antártida", "Caribe", "Europa", "Alaska"];

export interface CruiseLink {
  label: string;
  url: string;
}

export interface CruiseItinerary {
  id: string;
  name: string;
  /** Una línea, sin exagerar. */
  summary: string;
  zone: CruiseZone;
  /** Puerto de salida (y de llegada si no es circular). */
  departure: string;
  /** Escalas típicas, en orden. */
  ports: string[];
  /** Noches típicas: mínimo y máximo. */
  nights: [number, number];
  /** Meses en los que suele haber salidas (1-12). */
  months: number[];
  /** Navieras que suelen operar la ruta (no garantizado). */
  lines: string[];
  /** Salidas y precios reales. */
  search: CruiseLink;
  /** Sitio oficial de la naviera, si la ruta la opera casi solo una. */
  official?: CruiseLink;
  /**
   * Vuelo para llegar al puerto (o volver, si el crucero termina en otra ciudad).
   * Sin vuelo: el crucero sale de Buenos Aires.
   */
  flight?: { code: string; name: string; direction: "ida" | "vuelta" };
  /** Aviso importante (documentación, solo ida, etc.). */
  note?: string;
}

const CRUCERO_AR = "https://www.crucero.com.ar";
const search = (path: string, label: string): CruiseLink => ({ label, url: `${CRUCERO_AR}/${path}` });

export const CRUISES: CruiseItinerary[] = [
  {
    id: "buenos-aires-brasil",
    name: "Buenos Aires, Uruguay y Brasil",
    summary: "El clásico del verano: sale y vuelve a Buenos Aires, sin vuelos ni pasaporte.",
    zone: "Sudamérica",
    departure: "Buenos Aires",
    ports: ["Buenos Aires", "Punta del Este o Montevideo", "Balneário Camboriú o Itajaí", "Santos o Ilhabela", "Río de Janeiro", "Buenos Aires"],
    nights: [7, 9],
    months: [11, 12, 1, 2, 3, 4],
    lines: ["MSC Cruceros", "Costa Cruceros"],
    search: search("pd-48-buenos-aires", "Salidas desde Buenos Aires"),
    note: "Si el recorrido es solo por Uruguay y Brasil suele alcanzar el DNI tarjeta: confirmalo con la naviera al reservar.",
  },
  {
    id: "brasil-santos",
    name: "Costa de Brasil desde Santos",
    summary: "Minicruceros y semanas por Ilhabela, Búzios, Río y Santa Catarina, en el verano de allá.",
    zone: "Sudamérica",
    departure: "Santos (São Paulo)",
    ports: ["Santos", "Ilhabela", "Búzios", "Río de Janeiro", "Balneário Camboriú", "Santos"],
    nights: [3, 8],
    months: [11, 12, 1, 2, 3, 4],
    lines: ["MSC Cruceros", "Costa Cruceros"],
    search: search("d-125-brasil", "Cruceros por Brasil"),
    flight: { code: "SAO", name: "San Pablo", direction: "ida" },
    note: "El puerto de Santos queda a unas 2 horas del aeropuerto de Guarulhos.",
  },
  {
    id: "cabo-de-hornos",
    name: "Cabo de Hornos y fiordos chilenos",
    summary: "De Buenos Aires a Valparaíso por la Patagonia, Ushuaia y el Cabo de Hornos (o al revés).",
    zone: "Patagonia y Antártida",
    departure: "Buenos Aires (llega a Valparaíso o San Antonio)",
    ports: ["Buenos Aires", "Montevideo", "Puerto Madryn", "Ushuaia", "Cabo de Hornos", "Punta Arenas", "Fiordos chilenos", "Puerto Montt", "Valparaíso"],
    nights: [13, 16],
    months: [11, 12, 1, 2, 3],
    lines: ["Princess Cruises", "Holland America", "Celebrity Cruises", "Norwegian Cruise Line", "Oceania Cruises"],
    search: search("d-464-argentina", "Cruceros por Argentina"),
    flight: { code: "SCL", name: "Santiago de Chile", direction: "vuelta" },
    note: "Es solo ida: sumá el vuelo de vuelta desde Santiago. Algunas salidas paran en Malvinas.",
  },
  {
    id: "australis",
    name: "Ushuaia a Punta Arenas por los fiordos",
    summary: "Barcos chicos de expedición por el Canal Beagle, glaciares y el Cabo de Hornos.",
    zone: "Patagonia y Antártida",
    departure: "Ushuaia (llega a Punta Arenas, o al revés)",
    ports: ["Ushuaia", "Cabo de Hornos", "Bahía Wulaia", "Glaciar Pía", "Avenida de los Glaciares", "Punta Arenas"],
    nights: [4, 4],
    months: [9, 10, 11, 12, 1, 2, 3, 4],
    lines: ["Cruceros Australis"],
    search: search("c-151-cruceros-australis", "Salidas de Australis"),
    official: { label: "Sitio oficial de Australis", url: "https://www.australis.com/es/" },
    flight: { code: "USH", name: "Ushuaia", direction: "ida" },
    note: "Es solo ida: para volver desde Punta Arenas hay vuelos vía Santiago o bus a Río Gallegos.",
  },
  {
    id: "antartida",
    name: "Antártida desde Ushuaia",
    summary: "Expediciones al continente blanco cruzando el Pasaje de Drake. Caro y de cupos limitados.",
    zone: "Patagonia y Antártida",
    departure: "Ushuaia",
    ports: ["Ushuaia", "Pasaje de Drake", "Islas Shetland del Sur", "Península Antártica", "Ushuaia"],
    nights: [9, 12],
    months: [11, 12, 1, 2, 3],
    lines: ["Quark Expeditions", "HX Hurtigruten", "Ponant", "Lindblad National Geographic"],
    search: search("d-347-antartico", "Cruceros a la Antártida"),
    flight: { code: "USH", name: "Ushuaia", direction: "ida" },
  },
  {
    id: "caribe-miami",
    name: "Caribe desde Miami",
    summary: "Bahamas, México y las islas del Caribe en 3 a 7 noches. Se combina con unos días en Miami u Orlando.",
    zone: "Caribe",
    departure: "Miami",
    ports: ["Miami", "Nassau (Bahamas)", "Isla privada de la naviera", "Cozumel", "Gran Caimán o Jamaica", "Miami"],
    nights: [3, 7],
    months: [1, 2, 3, 4, 5, 11, 12],
    lines: ["Royal Caribbean", "MSC Cruceros", "Norwegian Cruise Line", "Carnival", "Celebrity Cruises"],
    search: search("pd-199-miami", "Salidas desde Miami"),
    flight: { code: "MIA", name: "Miami", direction: "ida" },
    note: "Necesitás pasaporte y visa de Estados Unidos. De junio a noviembre es temporada de huracanes.",
  },
  {
    id: "caribe-canaveral",
    name: "Bahamas desde Port Canaveral",
    summary: "El puerto de Orlando: cruceros cortos a Bahamas, incluidos los de Disney. Ideal para sumar a un viaje de parques.",
    zone: "Caribe",
    departure: "Port Canaveral (a 1 hora de Orlando)",
    ports: ["Port Canaveral", "Nassau (Bahamas)", "Isla privada de la naviera", "Port Canaveral"],
    nights: [3, 7],
    months: [1, 2, 3, 4, 5, 10, 11, 12],
    lines: ["Disney Cruise Line", "Royal Caribbean", "Carnival", "MSC Cruceros"],
    search: search("pd-186-puerto-canaveral", "Salidas desde Port Canaveral"),
    flight: { code: "MCO", name: "Orlando", direction: "ida" },
    note: "Necesitás pasaporte y visa de Estados Unidos.",
  },
  {
    id: "mediterraneo",
    name: "Mediterráneo desde Barcelona",
    summary: "Una semana por Francia e Italia durmiendo en el barco: una ciudad distinta cada día.",
    zone: "Europa",
    departure: "Barcelona",
    ports: ["Barcelona", "Marsella", "Génova", "Civitavecchia (Roma)", "Nápoles", "Palma de Mallorca", "Barcelona"],
    nights: [7, 7],
    months: [4, 5, 6, 7, 8, 9, 10],
    lines: ["MSC Cruceros", "Costa Cruceros", "Royal Caribbean", "Norwegian Cruise Line"],
    search: search("pd-455-barcelona", "Salidas desde Barcelona"),
    flight: { code: "BCN", name: "Barcelona", direction: "ida" },
    note: "Muchos itinerarios también se pueden empezar en Génova o Civitavecchia.",
  },
  {
    id: "fiordos-noruegos",
    name: "Fiordos noruegos",
    summary: "Geiranger, Bergen y pueblos entre montañas, con días larguísimos en verano.",
    zone: "Europa",
    departure: "Copenhague, Kiel o Hamburgo (según la naviera)",
    ports: ["Copenhague", "Geiranger", "Hellesylt", "Bergen", "Flåm", "Stavanger", "Copenhague"],
    nights: [7, 10],
    months: [5, 6, 7, 8, 9],
    lines: ["MSC Cruceros", "Costa Cruceros", "Royal Caribbean", "HX Hurtigruten"],
    search: search("d-41-fiordos-escandinavia", "Cruceros por los fiordos"),
    flight: { code: "CPH", name: "Copenhague", direction: "ida" },
    note: "Revisá el puerto de salida antes de sacar el vuelo: no todos salen de Copenhague.",
  },
  {
    id: "alaska",
    name: "Alaska desde Seattle",
    summary: "Glaciares, ballenas y pueblos de la fiebre del oro por el Pasaje Interior.",
    zone: "Alaska",
    departure: "Seattle",
    ports: ["Seattle", "Juneau", "Skagway", "Glacier Bay o Tracy Arm", "Ketchikan", "Victoria (Canadá)", "Seattle"],
    nights: [7, 7],
    months: [5, 6, 7, 8, 9],
    lines: ["Princess Cruises", "Holland America", "Royal Caribbean", "Norwegian Cruise Line", "Celebrity Cruises"],
    search: search("pd-439-seattle", "Salidas desde Seattle"),
    flight: { code: "SEA", name: "Seattle", direction: "ida" },
    note: "Necesitás pasaporte y visa de Estados Unidos. Si para en Canadá, revisá si te piden visa o eTA canadiense.",
  },
];

/** Noches como texto ("7 a 9 noches"). */
export function cruiseNightsLabel(c: CruiseItinerary): string {
  const [a, b] = c.nights;
  return a === b ? `${a} noches` : `${a} a ${b} noches`;
}

/** Sale de la Argentina: no hace falta vuelo para llegar al puerto. */
export const leavesFromArgentina = (c: CruiseItinerary) => !c.flight || c.flight.direction === "vuelta";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => ymd(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000));

/** Primera fecha de temporada desde dentro de un mes (fechas de ejemplo para la búsqueda de vuelos). */
export function sampleDeparture(months: number[], now = new Date()): string {
  const soon = new Date(now.getTime() + 30 * 86400000);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth() + i, 1));
    if (!months.includes(d.getUTCMonth() + 1)) continue;
    return i === 0 ? ymd(soon) : ymd(d);
  }
  return ymd(soon);
}

/** Link a la búsqueda de vuelos de la app para llegar al puerto (o volver desde el puerto final). */
export function cruiseFlightSearch(c: CruiseItinerary, origin: { code: string; name: string }, now = new Date()): string | null {
  if (!c.flight || c.flight.code === origin.code) return null;
  const start = sampleDeparture(c.months, now);
  const home = `${origin.code}|${origin.name}`;
  const port = `${c.flight.code}|${c.flight.name}`;
  if (c.flight.direction === "vuelta") {
    // Crucero de solo ida que sale de Argentina: vuelo de vuelta desde el puerto final.
    const q = new URLSearchParams({ tipo: "vuelos", from: port, to: home, depart: addDays(start, c.nights[0]) });
    return `/buscar?${q}`;
  }
  // Llegar un día antes del embarque y volver un día después del desembarco.
  const q = new URLSearchParams({ tipo: "vuelos", from: home, to: port, depart: addDays(start, -1), ret: addDays(start, c.nights[0] + 1) });
  return `/buscar?${q}`;
}
