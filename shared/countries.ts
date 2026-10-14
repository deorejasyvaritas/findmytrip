// Países para "Ya sé a dónde": se puede elegir un país entero (por ejemplo,
// Brasil) en vez de una ciudad. Nombres en español como los del catálogo,
// con alias comunes ("EEUU", "Brazil", "Holanda").
//
// `cities` son las ciudades principales (capital o la más visitada) con
// coordenadas aproximadas: sirven para armar el viaje en países que no tienen
// destinos en el catálogo. "Ya sé a dónde" busca el aeropuerto más cercano y
// los precios reales al armarlo, así que acá no hay montos.

export interface CountryCity {
  name: string;
  lat: number;
  lon: number;
}

export interface Country {
  /** ISO 3166-1 alfa-2. */
  code: string;
  /** Nombre en español, igual que en el catálogo de destinos. */
  name: string;
  aliases: string[];
  cities: CountryCity[];
}

const c = (code: string, name: string, aliases: string[], cities: [string, number, number][]): Country => ({
  code,
  name,
  aliases,
  cities: cities.map(([n, lat, lon]) => ({ name: n, lat, lon })),
});

export const COUNTRIES: Country[] = [
  // Con destinos en el catálogo
  c("AR", "Argentina", [], [["Buenos Aires", -34.6, -58.38]]),
  c("AW", "Aruba", [], [["Oranjestad", 12.52, -70.03]]),
  c("BO", "Bolivia", [], [["La Paz", -16.5, -68.15], ["Uyuni", -20.46, -66.83]]),
  c("BR", "Brasil", ["brazil"], [["Río de Janeiro", -22.91, -43.17]]),
  c("CL", "Chile", [], [["Santiago", -33.45, -70.67]]),
  c("CO", "Colombia", [], [["Bogotá", 4.71, -74.07]]),
  c("CR", "Costa Rica", [], [["San José", 9.93, -84.08]]),
  c("HR", "Croacia", ["croatia", "hrvatska"], [["Dubrovnik", 42.65, 18.09], ["Split", 43.51, 16.44]]),
  c("EC", "Ecuador", [], [["Quito", -0.18, -78.47]]),
  c("ES", "España", ["spain", "espana"], [["Madrid", 40.42, -3.7], ["Barcelona", 41.39, 2.17]]),
  c(
    "US",
    "Estados Unidos",
    ["eeuu", "ee uu", "usa", "eua", "united states", "estados unidos de america"],
    [["Nueva York", 40.71, -74.01], ["Miami", 25.76, -80.19], ["Orlando", 28.54, -81.38]],
  ),
  c("FR", "Francia", ["france"], [["París", 48.86, 2.35]]),
  c("GR", "Grecia", ["greece"], [["Atenas", 37.98, 23.73]]),
  c("IT", "Italia", ["italy"], [["Roma", 41.9, 12.5]]),
  c("JP", "Japón", ["japan"], [["Tokio", 35.68, 139.69]]),
  c("MA", "Marruecos", ["morocco"], [["Marrakech", 31.63, -7.99]]),
  c("MX", "México", ["mejico"], [["Cancún", 21.16, -86.85], ["Ciudad de México", 19.43, -99.13]]),
  c("PE", "Perú", [], [["Lima", -12.05, -77.04], ["Cusco", -13.53, -71.97]]),
  c("PT", "Portugal", [], [["Lisboa", 38.72, -9.14]]),
  c("DO", "República Dominicana", ["dominicana", "rep dominicana", "dominican republic"], [["Punta Cana", 18.58, -68.4]]),
  c("TH", "Tailandia", ["thailand"], [["Bangkok", 13.76, 100.5]]),
  c("UY", "Uruguay", [], [["Montevideo", -34.9, -56.16], ["Punta del Este", -34.96, -54.95]]),
  // Sin destinos en el catálogo (se arma el viaje a sus ciudades principales)
  c("PY", "Paraguay", [], [["Asunción", -25.26, -57.58]]),
  c("VE", "Venezuela", [], [["Caracas", 10.49, -66.88], ["Isla Margarita", 10.99, -63.91]]),
  c("PA", "Panamá", ["panama"], [["Ciudad de Panamá", 8.98, -79.52]]),
  c("CU", "Cuba", [], [["La Habana", 23.11, -82.37], ["Varadero", 23.15, -81.25]]),
  c("JM", "Jamaica", [], [["Montego Bay", 18.47, -77.92]]),
  c("CW", "Curazao", ["curacao"], [["Willemstad", 12.11, -68.93]]),
  c("BS", "Bahamas", [], [["Nasáu", 25.05, -77.35]]),
  c("PR", "Puerto Rico", [], [["San Juan", 18.47, -66.11]]),
  c("GT", "Guatemala", [], [["Antigua Guatemala", 14.56, -90.73]]),
  c("SV", "El Salvador", [], [["San Salvador", 13.69, -89.22]]),
  c("CA", "Canadá", ["canada"], [["Toronto", 43.65, -79.38], ["Vancouver", 49.28, -123.12], ["Montreal", 45.5, -73.57]]),
  c("GB", "Reino Unido", ["uk", "inglaterra", "gran bretana", "united kingdom", "england"], [["Londres", 51.51, -0.13], ["Edimburgo", 55.95, -3.19]]),
  c("IE", "Irlanda", ["ireland"], [["Dublín", 53.35, -6.26]]),
  c("DE", "Alemania", ["germany", "deutschland"], [["Berlín", 52.52, 13.4], ["Múnich", 48.14, 11.58]]),
  c("NL", "Países Bajos", ["holanda", "netherlands"], [["Ámsterdam", 52.37, 4.9]]),
  c("BE", "Bélgica", ["belgium"], [["Bruselas", 50.85, 4.35]]),
  c("CH", "Suiza", ["switzerland"], [["Zúrich", 47.38, 8.54], ["Ginebra", 46.2, 6.14]]),
  c("AT", "Austria", [], [["Viena", 48.21, 16.37]]),
  c("CZ", "República Checa", ["chequia", "czechia"], [["Praga", 50.08, 14.44]]),
  c("HU", "Hungría", ["hungary"], [["Budapest", 47.5, 19.04]]),
  c("PL", "Polonia", ["poland"], [["Cracovia", 50.06, 19.94], ["Varsovia", 52.23, 21.01]]),
  c("NO", "Noruega", ["norway"], [["Oslo", 59.91, 10.75]]),
  c("SE", "Suecia", ["sweden"], [["Estocolmo", 59.33, 18.07]]),
  c("DK", "Dinamarca", ["denmark"], [["Copenhague", 55.68, 12.57]]),
  c("FI", "Finlandia", ["finland"], [["Helsinki", 60.17, 24.94]]),
  c("IS", "Islandia", ["iceland"], [["Reikiavik", 64.15, -21.94]]),
  c("TR", "Turquía", ["turkey", "turkiye"], [["Estambul", 41.01, 28.98], ["Capadocia", 38.64, 34.83]]),
  c("EG", "Egipto", ["egypt"], [["El Cairo", 30.04, 31.24]]),
  c("AE", "Emiratos Árabes Unidos", ["emiratos", "emiratos arabes", "uae", "eau"], [["Dubái", 25.2, 55.27], ["Abu Dabi", 24.45, 54.38]]),
  c("QA", "Catar", ["qatar"], [["Doha", 25.29, 51.53]]),
  c("IL", "Israel", [], [["Tel Aviv", 32.09, 34.78], ["Jerusalén", 31.77, 35.21]]),
  c("JO", "Jordania", ["jordan"], [["Amán", 31.95, 35.93]]),
  c("CN", "China", [], [["Pekín", 39.9, 116.41], ["Shanghái", 31.23, 121.47]]),
  c("KR", "Corea del Sur", ["corea", "south korea"], [["Seúl", 37.57, 126.98]]),
  c("IN", "India", [], [["Nueva Delhi", 28.61, 77.21]]),
  c("ID", "Indonesia", [], [["Bali", -8.65, 115.22]]),
  c("VN", "Vietnam", [], [["Hanói", 21.03, 105.85], ["Ciudad Ho Chi Minh", 10.82, 106.63]]),
  c("SG", "Singapur", ["singapore"], [["Singapur", 1.35, 103.82]]),
  c("MY", "Malasia", ["malaysia"], [["Kuala Lumpur", 3.14, 101.69]]),
  c("PH", "Filipinas", ["philippines"], [["Manila", 14.6, 120.98]]),
  c("MV", "Maldivas", ["maldives"], [["Malé", 4.18, 73.51]]),
  c("AU", "Australia", [], [["Sídney", -33.87, 151.21], ["Melbourne", -37.81, 144.96]]),
  c("NZ", "Nueva Zelanda", ["new zealand"], [["Auckland", -36.85, 174.76], ["Queenstown", -45.03, 168.66]]),
  c("ZA", "Sudáfrica", ["south africa"], [["Ciudad del Cabo", -33.92, 18.42]]),
  c("KE", "Kenia", ["kenya"], [["Nairobi", -1.29, 36.82]]),
  c("TZ", "Tanzania", [], [["Zanzíbar", -6.16, 39.19]]),
];

/** Sin tildes, en minúscula, sin puntos ("EE.UU." → "eeuu") y con un solo espacio. */
export function normCountry(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const keysOf = (x: Country) => [normCountry(x.name), ...x.aliases.map(normCountry)];
const BY_KEY = new Map<string, Country>();
for (const x of COUNTRIES) for (const k of keysOf(x)) if (!BY_KEY.has(k)) BY_KEY.set(k, x);
const BY_CODE = new Map(COUNTRIES.map((x) => [x.code, x]));

export const countryByCode = (code: string | null | undefined): Country | null => (code ? (BY_CODE.get(code.toUpperCase()) ?? null) : null);

/** Código ISO de un nombre de país del catálogo o de un alias ("Brasil" → "BR"). */
export const countryCodeOf = (name: string | null | undefined): string | null => (name ? (BY_KEY.get(normCountry(name))?.code ?? null) : null);

/** Desde cuántas letras sugerimos un país por el comienzo del nombre ("bras" → Brasil). */
const PREFIX_MIN = 4;

/**
 * Países que coinciden con lo que se escribe en "¿A dónde vas?". Nombre o alias
 * completo siempre ("Peru", "EEUU"); por el comienzo del nombre o de un alias
 * desde 4 letras, para no tapar ciudades mientras se escribe ("Mar del Plata").
 */
export function matchCountries(text: string, limit = 2): Country[] {
  const q = normCountry(text);
  if (q.length < 2) return [];
  const exact = BY_KEY.get(q);
  if (exact) return [exact];
  if (q.length < PREFIX_MIN) return [];
  return COUNTRIES.filter((x) => keysOf(x).some((k) => k.startsWith(q))).slice(0, limit);
}
