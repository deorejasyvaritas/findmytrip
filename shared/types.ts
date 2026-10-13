// Tipos compartidos entre el servidor (API) y el cliente (web).

export type Style = "low" | "mid" | "high";

export type Interest =
  | "playa"
  | "montaña"
  | "ciudad"
  | "gastronomía"
  | "aventura"
  | "nieve"
  | "cultura"
  | "naturaleza"
  | "relax"
  | "noche"
  | "compras";

export type Region =
  | "Argentina"
  | "Sudamérica"
  | "Caribe y Centroamérica"
  | "Norteamérica"
  | "Europa"
  | "Asia"
  | "África y Medio Oriente";

export interface Origin {
  code: string; // código IATA de ciudad/aeropuerto (BUE, COR, ...)
  name: string;
  lat: number;
  lon: number;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  region: Region;
  iata: string;
  lat: number;
  lon: number;
  tags: Interest[];
  /** Vuelo ida y vuelta por persona desde Buenos Aires, en USD, temporada media. */
  baseFlightUSD: number;
  /** Horas de vuelo aproximadas desde Buenos Aires (sin escalas largas). */
  flightHours: number;
  /** Gasto diario por persona (comida, transporte local, actividades) en USD. */
  dailyUSD: Record<Style, number>;
  /** Alojamiento por habitación doble por noche en USD. */
  lodgingUSD: Record<Style, number>;
  /** Multiplicador de demanda por mes (índice 0 = enero). */
  season: number[];
  /** Meses recomendados por clima (1-12). */
  bestMonths: number[];
  /** Documentación para viajeros argentinos (orientativo, verificar siempre). */
  docs: string;
  /** Destino menos obvio que suele quedar fuera del radar. */
  hiddenGem?: boolean;
  blurb: string;
  highlights: string[];
  areas: string[];
}

export interface Profile {
  name: string;
  origin: string;
  travelers: number;
  style: Style;
  interests: Interest[];
  currency: "USD" | "ARS";
  visited: string[]; // ids de destinos ya visitados
  maxFlightHours: number | null;
}

export interface ExploreRequest {
  origin: string;
  budgetUSD: number; // presupuesto total del grupo
  travelers: number;
  nights: number;
  /** Mes (1-12) o null si las fechas son flexibles. */
  month: number | null;
  year?: number;
  style: Style;
  interests: Interest[];
  regions?: Region[];
  exclude?: string[]; // ids a excluir (ej. ya visitados)
  maxFlightHours?: number | null;
  /** Ids que el usuario ya tiene en mente: se usan para destacar alternativas. */
  known?: string[];
}

export interface CostBreakdown {
  flights: number;
  lodging: number;
  daily: number;
  total: number;
  perPerson: number;
}

export interface Suggestion {
  destination: Destination;
  month: number;
  year: number;
  cost: CostBreakdown;
  score: number;
  fit: "dentro" | "ajustado" | "estirando";
  reasons: string[];
  isAlternative: boolean; // algo que el usuario probablemente no estaba considerando
  /** google = Google Flights/Hotels hoy · aviasales = visto por usuarios en los últimos días. */
  flightSource: PriceSource;
  lodgingSource: PriceSource;
  /** Fechas concretas del precio real (si las hay). */
  depart?: string;
  ret?: string;
  airline?: string;
  link?: string;
}

export type PriceSource = "google" | "aviasales" | "estimado";

/** Precio real conocido de un destino para un mes. */
export interface RealPrice {
  month: number;
  flightPP: number; // ida y vuelta por persona
  hotelNight?: number;
  depart?: string;
  ret?: string;
  airline?: string;
  link?: string;
  source: "google" | "aviasales";
}

/** Destino que encontró Google y no está en nuestro catálogo. */
export interface ExtraDestination {
  name: string;
  country: string;
  airport: string;
  flightPP: number;
  hotelNight: number | null;
  depart: string;
  ret: string | null;
  airline: string | null;
  link: string | null;
  thumbnail: string | null;
  stops: number | null;
}

export interface ExploreResponse {
  suggestions: Suggestion[];
  alternatives: Suggestion[];
  /** Más destinos con precio real de Google, fuera del catálogo. */
  extra: ExtraDestination[];
  considered: number;
}

export interface FlightDay {
  date: string; // YYYY-MM-DD (salida)
  returnDate: string;
  priceUSD: number; // ida y vuelta por persona
  source: "estimado" | "en vivo";
  airline?: string;
  stops?: number;
}

export interface FlightCalendar {
  origin: string;
  destination: string;
  month: string; // YYYY-MM
  nights: number;
  days: FlightDay[];
  cheapest: FlightDay | null;
  live: boolean;
}

export interface MonthPrice {
  month: number;
  year: number;
  flightUSD: number;
  totalPerPersonUSD: number;
  best: boolean;
}

export interface StayOption {
  tier: Style;
  label: string;
  nightlyUSD: number;
  totalUSD: number;
  rooms: number;
  area: string;
  description: string;
  links: { label: string; url: string }[];
  source: "estimado" | "en vivo";
}

export interface PackageItem {
  kind: "vuelo" | "alojamiento" | "gastos" | "extra";
  label: string;
  amountUSD: number;
  link?: string;
}

export interface TripPackage {
  id: string;
  destinationId: string;
  destinationName: string;
  origin: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  style: Style;
  items: PackageItem[];
  totalUSD: number;
  notes?: string;
  createdAt: string;
  status: "idea" | "armando" | "reservado";
}

export interface WatchItem {
  id: string;
  destinationId: string;
  targetUSD: number; // presupuesto total objetivo del grupo
  month: number | null;
  nights: number;
  createdAt: string;
}

export interface FlightOffer {
  priceUSD: number; // ida y vuelta por persona
  airlines: string[];
  stops: number;
  durationMin: number | null;
  departTime: string | null;
}

/** Cotización exacta de Google Flights para un par de fechas. */
export interface FlightQuote {
  depart: string;
  returnDate: string;
  offers: FlightOffer[];
  lowestUSD: number;
  typicalRangeUSD: [number, number] | null;
  priceLevel: string | null; // "low" | "typical" | "high"
  url: string | null;
}

export interface RealHotel {
  name: string;
  nightlyUSD: number;
  totalUSD: number;
  rating: number | null;
  reviews: number | null;
  stars: number | null;
  type: string | null;
  thumbnail: string | null;
  link: string | null;
}

export interface HotelQuote {
  checkin: string;
  checkout: string;
  hotels: RealHotel[];
  /** Precio por noche de referencia para cada estilo (percentiles reales). */
  tiers: Record<Style, number>;
}

export interface Meta {
  origins: Origin[];
  interests: Interest[];
  regions: Region[];
  /** Vuelos reales para explorar y calendarios (Travelpayouts). */
  liveFlights: boolean;
  /** Cotización exacta de vuelos y hoteles reales (SerpApi / Google). */
  googleQuotes: boolean;
  agent: boolean;
  usdArsRate: number;
  usdArsSource: string;
  /** ID de afiliado de Travelpayouts para los links de Aviasales. */
  marker: string | null;
}
