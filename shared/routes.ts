// Rutas armadas: itinerarios de varias paradas pensados para salir desde
// Argentina (como los "trip finders" de las agencias, pero con precios honestos).
// Cada ruta se abre en "Ya sé a dónde" con las paradas cargadas. Las coordenadas
// salen de la geocodificación de Open-Meteo (la misma fuente que usa /api/geo).

export type RouteStyle = "Playa" | "Ciudad" | "Naturaleza" | "Aventura" | "Cultura" | "Con chicos" | "Mochilero";

export const ROUTE_STYLES: RouteStyle[] = ["Playa", "Ciudad", "Naturaleza", "Aventura", "Cultura", "Con chicos", "Mochilero"];

export interface RouteStop {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  nights: number;
  /** Destino del catálogo con ficha (foto, clima, requisitos). */
  destinationId?: string;
  /** Destino del catálogo cuyo alojamiento promedio usamos como referencia (si no es el mismo). */
  lodgingFrom?: string;
}

export interface CuratedRoute {
  id: string;
  name: string;
  /** Una línea, sin exagerar. */
  summary: string;
  region: string;
  countries: string[];
  styles: RouteStyle[];
  /** Ciudad a la que se vuela primero: códigos IATA de ciudad (el primero que tenga precio) y nombre. */
  flyTo: { codes: string[]; name: string };
  stops: RouteStop[];
  /** Meses recomendados (1-12). */
  bestMonths: number[];
}

const AR = "Argentina";

export const ROUTES: CuratedRoute[] = [
  {
    id: "nordeste-brasil",
    name: "Nordeste de Brasil",
    summary: "Piscinas naturales y playas de agua tibia, de Pernambuco a Bahía.",
    region: "Sudamérica",
    countries: ["Brasil"],
    styles: ["Playa", "Con chicos"],
    flyTo: { codes: ["REC"], name: "Recife" },
    stops: [
      { name: "Porto de Galinhas", region: "Estado de Pernambuco", country: "Brasil", lat: -8.505, lon: -35.006, nights: 4, destinationId: "porto-de-galinhas" },
      { name: "Maragogi", region: "Estado de Alagoas", country: "Brasil", lat: -9.012, lon: -35.222, nights: 3, destinationId: "maragogi" },
      { name: "Maceió", region: "Estado de Alagoas", country: "Brasil", lat: -9.666, lon: -35.735, nights: 3, destinationId: "maceio" },
      { name: "Salvador", region: "Bahía", country: "Brasil", lat: -12.976, lon: -38.491, nights: 4, destinationId: "salvador" },
    ],
    bestMonths: [9, 10, 11, 12, 1, 2, 3],
  },
  {
    id: "nordeste-playas",
    name: "Porto de Galinhas y Maragogi",
    summary: "Piscinas naturales y resorts frente al mar, con solo un cambio de hotel.",
    region: "Sudamérica",
    countries: ["Brasil"],
    styles: ["Playa", "Con chicos"],
    flyTo: { codes: ["REC", "MCZ"], name: "Recife" },
    stops: [
      { name: "Porto de Galinhas", region: "Estado de Pernambuco", country: "Brasil", lat: -8.505, lon: -35.006, nights: 5, destinationId: "porto-de-galinhas" },
      { name: "Maragogi", region: "Estado de Alagoas", country: "Brasil", lat: -9.012, lon: -35.222, nights: 4, destinationId: "maragogi" },
    ],
    bestMonths: [9, 10, 11, 12, 1, 2],
  },
  {
    id: "parques-brasil",
    name: "Beto Carrero y Florianópolis",
    summary: "El parque temático más grande de Latinoamérica y después playas en la isla.",
    region: "Sudamérica",
    countries: ["Brasil"],
    styles: ["Con chicos", "Playa"],
    flyTo: { codes: ["NVT", "FLN"], name: "Navegantes" },
    stops: [
      { name: "Penha", region: "Estado de Santa Catarina", country: "Brasil", lat: -26.77, lon: -48.646, nights: 3, destinationId: "beto-carrero" },
      { name: "Florianópolis", region: "Estado de Santa Catarina", country: "Brasil", lat: -27.597, lon: -48.549, nights: 4, destinationId: "florianopolis" },
    ],
    bestMonths: [1, 2, 3, 11, 12],
  },
  {
    id: "rio-costa-verde",
    name: "Río y la Costa Verde",
    summary: "Río de Janeiro y después el pueblo colonial de Paraty e Ilha Grande, sin autos.",
    region: "Sudamérica",
    countries: ["Brasil"],
    styles: ["Playa", "Naturaleza", "Con chicos"],
    flyTo: { codes: ["RIO"], name: "Río de Janeiro" },
    stops: [
      { name: "Río de Janeiro", region: "Estado de Río de Janeiro", country: "Brasil", lat: -22.906, lon: -43.182, nights: 4, destinationId: "rio" },
      { name: "Paraty", region: "Estado de Río de Janeiro", country: "Brasil", lat: -23.218, lon: -44.713, nights: 3, lodgingFrom: "rio" },
      { name: "Ilha Grande", region: "Estado de Río de Janeiro", country: "Brasil", lat: -23.14, lon: -44.169, nights: 3, lodgingFrom: "rio" },
    ],
    bestMonths: [3, 4, 5, 9, 10, 11],
  },
  {
    id: "patagonia-lagos",
    name: "Patagonia de lagos",
    summary: "Bariloche y la Ruta de los Siete Lagos hasta San Martín de los Andes, por tierra.",
    region: AR,
    countries: [AR],
    styles: ["Naturaleza", "Aventura", "Con chicos"],
    flyTo: { codes: ["BRC"], name: "Bariloche" },
    stops: [
      { name: "Bariloche", region: "Provincia de Río Negro", country: AR, lat: -41.146, lon: -71.308, nights: 3, destinationId: "bariloche" },
      { name: "Villa La Angostura", region: "Provincia del Neuquén", country: AR, lat: -40.762, lon: -71.646, nights: 2, lodgingFrom: "bariloche" },
      { name: "San Martín de los Andes", region: "Provincia del Neuquén", country: AR, lat: -40.158, lon: -71.353, nights: 2, destinationId: "san-martin" },
    ],
    bestMonths: [11, 12, 1, 2, 3],
  },
  {
    id: "patagonia-austral",
    name: "Glaciares y fin del mundo",
    summary: "Perito Moreno, los senderos de El Chaltén y el Canal Beagle en Ushuaia.",
    region: AR,
    countries: [AR],
    styles: ["Naturaleza", "Aventura"],
    flyTo: { codes: ["FTE"], name: "El Calafate" },
    stops: [
      { name: "El Calafate", region: "Provincia de Santa Cruz", country: AR, lat: -50.341, lon: -72.277, nights: 3, destinationId: "calafate" },
      { name: "El Chaltén", region: "Provincia de Santa Cruz", country: AR, lat: -49.33, lon: -72.886, nights: 3, lodgingFrom: "calafate" },
      { name: "Ushuaia", region: "Provincia de Tierra del Fuego", country: AR, lat: -54.811, lon: -68.316, nights: 3, destinationId: "ushuaia" },
    ],
    bestMonths: [11, 12, 1, 2, 3],
  },
  {
    id: "norte-argentino",
    name: "Norte argentino",
    summary: "Cerros de colores en la Quebrada, la ciudad de Salta y los viñedos de Cafayate.",
    region: AR,
    countries: [AR],
    styles: ["Naturaleza", "Cultura", "Con chicos"],
    flyTo: { codes: ["JUJ", "SLA"], name: "Jujuy" },
    stops: [
      { name: "Purmamarca", region: "Provincia de Jujuy", country: AR, lat: -23.746, lon: -65.5, nights: 2, lodgingFrom: "salta" },
      { name: "Salta", region: "Provincia de Salta", country: AR, lat: -24.806, lon: -65.42, nights: 2, destinationId: "salta" },
      { name: "Cafayate", region: "Provincia de Salta", country: AR, lat: -26.073, lon: -65.978, nights: 2, lodgingFrom: "salta" },
    ],
    bestMonths: [4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: "chile-punta-a-punta",
    name: "Chile de punta a punta",
    summary: "Santiago, el desierto de Atacama y los lagos y volcanes del sur.",
    region: "Sudamérica",
    countries: ["Chile"],
    styles: ["Naturaleza", "Aventura"],
    flyTo: { codes: ["SCL"], name: "Santiago" },
    stops: [
      { name: "Santiago", region: "Región Metropolitana de Santiago", country: "Chile", lat: -33.457, lon: -70.648, nights: 3, destinationId: "santiago" },
      { name: "San Pedro de Atacama", region: "Región de Antofagasta", country: "Chile", lat: -22.911, lon: -68.201, nights: 4, destinationId: "atacama" },
      { name: "Puerto Varas", region: "Región de Los Lagos", country: "Chile", lat: -41.319, lon: -72.985, nights: 4, lodgingFrom: "bariloche" },
    ],
    bestMonths: [10, 11, 12, 1, 2, 3],
  },
  {
    id: "santiago-valparaiso",
    name: "Santiago y Valparaíso",
    summary: "Escapada corta: la capital chilena, viñedos cercanos y los cerros de Valparaíso.",
    region: "Sudamérica",
    countries: ["Chile"],
    styles: ["Ciudad", "Cultura"],
    flyTo: { codes: ["SCL"], name: "Santiago" },
    stops: [
      { name: "Santiago", region: "Región Metropolitana de Santiago", country: "Chile", lat: -33.457, lon: -70.648, nights: 3, destinationId: "santiago" },
      { name: "Valparaíso", region: "Región de Valparaíso", country: "Chile", lat: -33.047, lon: -71.613, nights: 2, lodgingFrom: "santiago" },
    ],
    bestMonths: [10, 11, 12, 1, 2, 3, 4],
  },
  {
    id: "peru-clasico",
    name: "Perú clásico",
    summary: "Lima, Arequipa, Cusco y Machu Picchu desde Aguas Calientes.",
    region: "Sudamérica",
    countries: ["Perú"],
    styles: ["Cultura", "Aventura", "Mochilero"],
    flyTo: { codes: ["LIM"], name: "Lima" },
    stops: [
      { name: "Lima", region: "Provincia de Lima", country: "Perú", lat: -12.043, lon: -77.028, nights: 3, destinationId: "lima" },
      { name: "Arequipa", region: "Departamento de Arequipa", country: "Perú", lat: -16.399, lon: -71.537, nights: 3, lodgingFrom: "lima" },
      { name: "Cusco", region: "Departamento de Cusco", country: "Perú", lat: -13.532, lon: -71.967, nights: 4, destinationId: "cusco" },
      { name: "Aguas Calientes", region: "Departamento de Cusco", country: "Perú", lat: -13.155, lon: -72.525, nights: 1, lodgingFrom: "cusco" },
    ],
    bestMonths: [4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: "bolivia-andina",
    name: "Bolivia andina",
    summary: "La Paz, el Salar de Uyuni y la ciudad blanca de Sucre. Altura y caminos largos.",
    region: "Sudamérica",
    countries: ["Bolivia"],
    styles: ["Aventura", "Naturaleza", "Mochilero"],
    flyTo: { codes: ["LPB"], name: "La Paz" },
    stops: [
      { name: "La Paz", region: "Departamento de La Paz", country: "Bolivia", lat: -16.5, lon: -68.15, nights: 3, lodgingFrom: "uyuni" },
      { name: "Uyuni", region: "Departamento de Potosí", country: "Bolivia", lat: -20.46, lon: -66.825, nights: 3, destinationId: "uyuni" },
      { name: "Sucre", region: "Departamento de Chuquisaca", country: "Bolivia", lat: -19.033, lon: -65.263, nights: 2, lodgingFrom: "uyuni" },
    ],
    bestMonths: [4, 5, 6, 7, 8, 9, 10],
  },
  {
    id: "colombia",
    name: "Colombia",
    summary: "Bogotá, la Medellín de la eterna primavera y el Caribe en Cartagena.",
    region: "Sudamérica",
    countries: ["Colombia"],
    styles: ["Ciudad", "Cultura", "Playa"],
    flyTo: { codes: ["BOG"], name: "Bogotá" },
    stops: [
      { name: "Bogotá", region: "Bogotá D.C.", country: "Colombia", lat: 4.61, lon: -74.082, nights: 3, lodgingFrom: "medellin" },
      { name: "Medellín", region: "Antioquia", country: "Colombia", lat: 6.245, lon: -75.572, nights: 3, destinationId: "medellin" },
      { name: "Cartagena", region: "Departamento de Bolívar", country: "Colombia", lat: 10.398, lon: -75.493, nights: 4, destinationId: "cartagena" },
    ],
    bestMonths: [12, 1, 2, 3, 7, 8],
  },
  {
    id: "caribe-mexicano",
    name: "Caribe mexicano",
    summary: "Cancún, la isla de Holbox y las ruinas frente al mar en Tulum.",
    region: "Caribe y Centroamérica",
    countries: ["México"],
    styles: ["Playa", "Con chicos"],
    flyTo: { codes: ["CUN"], name: "Cancún" },
    stops: [
      { name: "Cancún", region: "Estado de Quintana Roo", country: "México", lat: 21.174, lon: -86.847, nights: 3, destinationId: "cancun" },
      { name: "Holbox", region: "Estado de Quintana Roo", country: "México", lat: 21.522, lon: -87.379, nights: 3, lodgingFrom: "cancun" },
      { name: "Tulum", region: "Estado de Quintana Roo", country: "México", lat: 20.212, lon: -87.463, nights: 4, lodgingFrom: "cancun" },
    ],
    bestMonths: [12, 1, 2, 3, 4],
  },
  {
    id: "costa-rica",
    name: "Costa Rica",
    summary: "Volcán Arenal, el bosque nuboso de Monteverde y la playa de Manuel Antonio.",
    region: "Caribe y Centroamérica",
    countries: ["Costa Rica"],
    styles: ["Naturaleza", "Aventura", "Con chicos"],
    flyTo: { codes: ["SJO"], name: "San José" },
    stops: [
      { name: "San José", region: "Provincia de San José", country: "Costa Rica", lat: 9.934, lon: -84.085, nights: 1, destinationId: "costa-rica" },
      { name: "La Fortuna", region: "Provincia de Alajuela", country: "Costa Rica", lat: 10.471, lon: -84.645, nights: 3, lodgingFrom: "costa-rica" },
      { name: "Monteverde", region: "Provincia de Puntarenas", country: "Costa Rica", lat: 10.317, lon: -84.825, nights: 2, lodgingFrom: "costa-rica" },
      { name: "Quepos", region: "Provincia de Puntarenas", country: "Costa Rica", lat: 9.431, lon: -84.162, nights: 3, lodgingFrom: "costa-rica" },
    ],
    bestMonths: [12, 1, 2, 3, 4],
  },
  {
    id: "nueva-york-washington",
    name: "Nueva York y Washington",
    summary: "Museos, barrios y parques en Nueva York, con tren a la capital.",
    region: "Norteamérica",
    countries: ["Estados Unidos"],
    styles: ["Ciudad", "Cultura"],
    flyTo: { codes: ["NYC"], name: "Nueva York" },
    stops: [
      { name: "Nueva York", region: "Nueva York", country: "Estados Unidos", lat: 40.714, lon: -74.006, nights: 4, destinationId: "nueva-york" },
      { name: "Washington", region: "Distrito de Columbia", country: "Estados Unidos", lat: 38.895, lon: -77.036, nights: 2, lodgingFrom: "nueva-york" },
    ],
    bestMonths: [4, 5, 6, 9, 10, 12],
  },
  {
    id: "orlando-miami",
    name: "Orlando y Miami",
    summary: "Parques temáticos en Orlando y después playa y compras en Miami.",
    region: "Norteamérica",
    countries: ["Estados Unidos"],
    styles: ["Con chicos", "Playa", "Ciudad"],
    flyTo: { codes: ["ORL", "MCO"], name: "Orlando" },
    stops: [
      { name: "Orlando", region: "Florida", country: "Estados Unidos", lat: 28.538, lon: -81.379, nights: 6, destinationId: "orlando" },
      { name: "Miami", region: "Florida", country: "Estados Unidos", lat: 25.774, lon: -80.194, nights: 4, destinationId: "miami" },
    ],
    bestMonths: [3, 4, 5, 10, 11, 12],
  },
  {
    id: "california-parques",
    name: "California con parques",
    summary: "Disneyland y Universal Studios en Los Ángeles, y después playas y el zoológico de San Diego.",
    region: "Norteamérica",
    countries: ["Estados Unidos"],
    styles: ["Con chicos", "Ciudad", "Playa"],
    flyTo: { codes: ["LAX"], name: "Los Ángeles" },
    stops: [
      { name: "Anaheim", region: "California", country: "Estados Unidos", lat: 33.836, lon: -117.914, nights: 3, lodgingFrom: "los-angeles" },
      { name: "Los Ángeles", region: "California", country: "Estados Unidos", lat: 34.052, lon: -118.244, nights: 4, destinationId: "los-angeles" },
      { name: "San Diego", region: "California", country: "Estados Unidos", lat: 32.716, lon: -117.165, nights: 3, lodgingFrom: "los-angeles" },
    ],
    bestMonths: [4, 5, 6, 9, 10],
  },
  {
    id: "europa-clasica",
    name: "Europa clásica",
    summary: "Tres capitales en dos semanas: Madrid, París y Roma.",
    region: "Europa",
    countries: ["España", "Francia", "Italia"],
    styles: ["Ciudad", "Cultura"],
    flyTo: { codes: ["MAD"], name: "Madrid" },
    stops: [
      { name: "Madrid", region: "Comunidad de Madrid", country: "España", lat: 40.416, lon: -3.703, nights: 4, destinationId: "madrid" },
      { name: "París", region: "Isla de Francia", country: "Francia", lat: 48.853, lon: 2.349, nights: 4, destinationId: "paris" },
      { name: "Roma", region: "Lacio", country: "Italia", lat: 41.892, lon: 12.511, nights: 4, destinationId: "roma" },
    ],
    bestMonths: [4, 5, 6, 9, 10],
  },
  {
    id: "espana-portugal",
    name: "España y Portugal",
    summary: "Madrid, Sevilla, Lisboa y Oporto, todo en tren o micro.",
    region: "Europa",
    countries: ["España", "Portugal"],
    styles: ["Ciudad", "Cultura"],
    flyTo: { codes: ["MAD"], name: "Madrid" },
    stops: [
      { name: "Madrid", region: "Comunidad de Madrid", country: "España", lat: 40.416, lon: -3.703, nights: 3, destinationId: "madrid" },
      { name: "Sevilla", region: "Andalucía", country: "España", lat: 37.383, lon: -5.973, nights: 3, lodgingFrom: "madrid" },
      { name: "Lisboa", region: "Distrito de Lisboa", country: "Portugal", lat: 38.725, lon: -9.15, nights: 3, destinationId: "lisboa" },
      { name: "Oporto", region: "Oporto", country: "Portugal", lat: 41.148, lon: -8.611, nights: 2, lodgingFrom: "lisboa" },
    ],
    bestMonths: [4, 5, 6, 9, 10],
  },
  {
    id: "espana-marruecos",
    name: "España y Marruecos",
    summary: "Madrid y Sevilla, y un vuelo corto hasta los zocos de Marrakech.",
    region: "Europa",
    countries: ["España", "Marruecos"],
    styles: ["Cultura", "Ciudad"],
    flyTo: { codes: ["MAD"], name: "Madrid" },
    stops: [
      { name: "Madrid", region: "Comunidad de Madrid", country: "España", lat: 40.416, lon: -3.703, nights: 3, destinationId: "madrid" },
      { name: "Sevilla", region: "Andalucía", country: "España", lat: 37.383, lon: -5.973, nights: 3, lodgingFrom: "madrid" },
      { name: "Marrakech", region: "Marrakech-Safí", country: "Marruecos", lat: 31.634, lon: -8.0, nights: 4, destinationId: "marruecos" },
    ],
    bestMonths: [3, 4, 5, 10, 11],
  },
  {
    id: "italia",
    name: "Italia",
    summary: "Roma, Florencia y Venecia, unidas por tren rápido.",
    region: "Europa",
    countries: ["Italia"],
    styles: ["Ciudad", "Cultura"],
    flyTo: { codes: ["ROM"], name: "Roma" },
    stops: [
      { name: "Roma", region: "Lacio", country: "Italia", lat: 41.892, lon: 12.511, nights: 4, destinationId: "roma" },
      { name: "Florencia", region: "Toscana", country: "Italia", lat: 43.779, lon: 11.246, nights: 3, lodgingFrom: "roma" },
      { name: "Venecia", region: "Véneto", country: "Italia", lat: 45.437, lon: 12.333, nights: 3, lodgingFrom: "roma" },
    ],
    bestMonths: [4, 5, 6, 9, 10],
  },
  {
    id: "tailandia",
    name: "Tailandia: templos e islas",
    summary: "Bangkok, los templos y montañas de Chiang Mai y las playas de Phuket.",
    region: "Asia",
    countries: ["Tailandia"],
    styles: ["Playa", "Cultura", "Mochilero"],
    flyTo: { codes: ["BKK"], name: "Bangkok" },
    stops: [
      { name: "Bangkok", region: "Bangkok", country: "Tailandia", lat: 13.754, lon: 100.501, nights: 4, destinationId: "tailandia" },
      { name: "Chiang Mai", region: "Provincia de Chiang Mai", country: "Tailandia", lat: 18.79, lon: 98.985, nights: 4, lodgingFrom: "tailandia" },
      { name: "Phuket", region: "Provincia de Phuket", country: "Tailandia", lat: 7.891, lon: 98.398, nights: 6, lodgingFrom: "tailandia" },
    ],
    bestMonths: [11, 12, 1, 2, 3],
  },
  {
    id: "japon",
    name: "Japón",
    summary: "Tokio, los templos de Kioto y la comida callejera de Osaka, en tren bala.",
    region: "Asia",
    countries: ["Japón"],
    styles: ["Ciudad", "Cultura"],
    flyTo: { codes: ["TYO"], name: "Tokio" },
    stops: [
      { name: "Tokio", region: "Tokio", country: "Japón", lat: 35.69, lon: 139.692, nights: 5, destinationId: "japon" },
      { name: "Kioto", region: "Prefectura de Kioto", country: "Japón", lat: 35.021, lon: 135.754, nights: 4, destinationId: "japon" },
      { name: "Osaka", region: "Prefectura de Osaka", country: "Japón", lat: 34.694, lon: 135.501, nights: 2, destinationId: "japon" },
    ],
    bestMonths: [3, 4, 5, 10, 11],
  },
];

// ---------------------------------------------------------------------------
// Cálculos sobre la ruta
// ---------------------------------------------------------------------------

export const routeNights = (r: CuratedRoute) => r.stops.reduce((n, s) => n + s.nights, 0);
/** Días de viaje: las noches más el día de vuelta. */
export const routeDays = (r: CuratedRoute) => routeNights(r) + 1;

export type DurationBand = "corta" | "media" | "larga";
export const DURATION_BANDS: { id: DurationBand; label: string; min: number; max: number }[] = [
  { id: "corta", label: "Hasta 7 días", min: 1, max: 7 },
  { id: "media", label: "8 a 14 días", min: 8, max: 14 },
  { id: "larga", label: "15 o más", min: 15, max: Infinity },
];
export const inBand = (r: CuratedRoute, band: DurationBand) => {
  const b = DURATION_BANDS.find((x) => x.id === band)!;
  const d = routeDays(r);
  return d >= b.min && d <= b.max;
};

/** Países de todas las rutas, del que más aparece al que menos. */
export function routeCountries(list: CuratedRoute[] = ROUTES): string[] {
  const count = new Map<string, number>();
  for (const r of list) for (const c of r.countries) count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([c]) => c);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Más de esta distancia en línea recta entre paradas se cotiza como vuelo (igual que "Ya sé a dónde"). */
export const FLIGHT_OVER_KM = 500;

export interface RouteHop {
  from: string;
  to: string;
  kind: "flight" | "ground";
  /** Km aproximados por ruta (30 % más que en línea recta). */
  km: number;
}

export function routeHops(r: CuratedRoute): RouteHop[] {
  return r.stops.slice(1).map((b, i) => {
    const a = r.stops[i];
    const straight = haversineKm(a.lat, a.lon, b.lat, b.lon);
    return { from: a.name, to: b.name, kind: straight > FLIGHT_OVER_KM ? "flight" : "ground", km: Math.round(straight * 1.3) };
  });
}

/**
 * Parada en el formato de la URL de "Ya sé a dónde" (`stop=`), el mismo que
 * arma `stopParam` en FullSearch: nombre~región~país~lat~lon~noches~ficha.
 */
export const routeStopParam = (s: RouteStop) => [s.name, s.region, s.country, s.lat, s.lon, s.nights, s.destinationId ?? ""].join("~");

/** Parámetros para abrir la ruta en "Ya sé a dónde" (fecha y grupo los elige la persona). */
export function routeSearchParams(r: CuratedRoute, extra: Record<string, string> = {}): URLSearchParams {
  const q = new URLSearchParams({ tipo: "viaje", ...extra });
  for (const s of r.stops) q.append("stop", routeStopParam(s));
  return q;
}

// ---------------------------------------------------------------------------
// Precio "desde": solo con datos reales
// ---------------------------------------------------------------------------

/** Lo que calcula /api/routes para cada ruta, por persona y en USD. */
export interface RouteQuote {
  /** Vuelo ida y vuelta más barato visto para el mes (Aviasales). null = sin dato real. */
  flightUSD: number | null;
  /** Ciudad del vuelo cotizado. */
  flightTo: string | null;
  /** Alojamiento promedio de la zona, por persona en habitación doble, todas las noches. null = sin referencia. */
  lodgingUSD: number | null;
  /** Traslados por tierra entre paradas (micro o tren, estimado). */
  groundUSD: number;
  /** Tramos entre paradas que son vuelos: no están en el estimado. */
  internalFlights: number;
  /** El viaje vuelve desde otra ciudad: el pasaje real puede cambiar. */
  openJaw: boolean;
}

export interface RoutesResponse {
  origin: string;
  month: string;
  quotes: Record<string, RouteQuote>;
}

export type RoutePrice =
  | { kind: "estimate"; perPersonUSD: number; basis: string }
  | { kind: "live"; label: "Ver precio de hoy"; reason: string };

const roundTo10 = (n: number) => Math.round(n / 10) * 10;

/**
 * Cómo mostrar el precio de una ruta. Solo hay número si tenemos el vuelo real
 * del mes y una referencia de alojamiento para todas las paradas; si no, se
 * invita a ver el precio de hoy (que arma el viaje con datos en vivo).
 */
export function routePrice(q: RouteQuote | null | undefined, monthName = "este mes"): RoutePrice {
  if (!q || q.flightUSD == null || q.flightUSD <= 0) {
    return { kind: "live", label: "Ver precio de hoy", reason: `Todavía no hay vuelos vistos para ${monthName}.` };
  }
  if (q.lodgingUSD == null) {
    return { kind: "live", label: "Ver precio de hoy", reason: "Sin referencia de alojamiento para alguna parada." };
  }
  const parts = [`vuelo ida y vuelta a ${q.flightTo ?? "la primera parada"} más barato visto para ${monthName}`, "alojamiento promedio en habitación doble"];
  if (q.groundUSD > 0) parts.push("traslados por tierra estimados");
  let basis = `Estimado con ${joinEs(parts)}.`;
  if (q.internalFlights > 0) basis += ` No incluye ${q.internalFlights === 1 ? "el vuelo interno" : `${q.internalFlights} vuelos internos`}.`;
  if (q.openJaw) basis += " Volver desde otra ciudad puede cambiar el pasaje.";
  return { kind: "estimate", perPersonUSD: roundTo10(q.flightUSD + q.lodgingUSD + q.groundUSD), basis };
}

function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Meses recomendados en tramos: [9,10,11,12,1,2,3] → "sep a mar"; [12,1,2,3,7,8] → "jul a ago y dic a mar". */
export function bestMonthsLabel(months: number[]): string {
  const set = new Set(months);
  if (set.size === 0) return "";
  if (set.size === 12) return "todo el año";
  // Arrancamos en un mes cuyo anterior no está, para no cortar un tramo que cruza el año.
  const start = [...set].sort((a, b) => a - b).find((m) => !set.has(m === 1 ? 12 : m - 1))!;
  const runs: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((start - 1 + i) % 12) + 1;
    if (!set.has(m)) continue;
    const prev = m === 1 ? 12 : m - 1;
    const last = runs[runs.length - 1];
    if (last && last[1] === prev) last[1] = m;
    else runs.push([m, m]);
  }
  return joinEs(runs.map(([a, b]) => (a === b ? MONTH_SHORT[a - 1] : `${MONTH_SHORT[a - 1]} a ${MONTH_SHORT[b - 1]}`)));
}
