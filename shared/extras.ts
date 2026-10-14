import type { Destination } from "./types.ts";

// Extras opcionales del viaje con programas de Travelpayouts. Los links se
// convierten en links con comisión en el servidor (API de links de Travelpayouts).

export interface Extra {
  kind: "traslado" | "auto" | "esim" | "excursiones" | "entradas" | "parques" | "seguro";
  title: string;
  description: string;
  provider: string;
  url: string;
}

// Nombre del país en inglés tal como lo usa Airalo en sus páginas (airalo.com/<pais>-esim).
const AIRALO: Record<string, string> = {
  Brasil: "brazil",
  Uruguay: "uruguay",
  Chile: "chile",
  Perú: "peru",
  Colombia: "colombia",
  Bolivia: "bolivia",
  Ecuador: "ecuador",
  "República Dominicana": "dominican-republic",
  México: "mexico",
  "Costa Rica": "costa-rica",
  Aruba: "aruba",
  "Estados Unidos": "united-states",
  España: "spain",
  Italia: "italy",
  Portugal: "portugal",
  Francia: "france",
  Grecia: "greece",
  Croacia: "croatia",
  Tailandia: "thailand",
  Japón: "japan",
  Marruecos: "morocco",
};

// Alquiler de auto (Localrent): solo donde conviene moverse en auto (rutas,
// playas o pueblos dispersos). En ciudades grandes (Nueva York, París, Tokio)
// o islas chicas y destinos de excursión guiada no suma: ahí no se ofrece.
// Valor: país tal como aparece en las páginas de Localrent (localrent.com/es/<pais>/).
const CAR_COUNTRY: Record<string, string> = {
  bariloche: "argentina",
  mendoza: "argentina",
  salta: "argentina",
  ushuaia: "argentina",
  calafate: "argentina",
  "puerto-madryn": "argentina",
  "san-martin": "argentina",
  florianopolis: "brazil",
  maceio: "brazil",
  maragogi: "brazil",
  "porto-de-galinhas": "brazil",
  natal: "brazil",
  fortaleza: "brazil",
  "beto-carrero": "brazil",
  gramado: "brazil",
  "punta-del-este": "uruguay",
  "costa-rica": "costa-rica",
  aruba: "aruba",
  cancun: "mexico",
  miami: "usa",
  orlando: "usa",
  "los-angeles": "usa",
  lisboa: "portugal",
  grecia: "greece",
  croacia: "croatia",
};

// Entradas a parques de atracciones (destinos con el interés "parques").
// Klook (programa 4110 de Travelpayouts) vende entradas de Disney y Universal;
// los parques de Brasil se venden en su sitio oficial (sin comisión, pero es
// donde está el precio real). Sin precios: se ven en el sitio al elegir fecha.
interface ParkTickets {
  parks: string;
  provider: string;
  url: string;
}
const klook = (q: string) => `https://www.klook.com/es/search/result/?query=${encodeURIComponent(q)}`;
export const PARK_TICKETS: Record<string, ParkTickets> = {
  orlando: { parks: "Walt Disney World, Universal y SeaWorld", provider: "Klook", url: klook("Walt Disney World") },
  "los-angeles": { parks: "Disneyland y Universal Studios Hollywood", provider: "Klook", url: klook("Disneyland California") },
  paris: { parks: "Disneyland Paris", provider: "Klook", url: klook("Disneyland Paris") },
  japon: { parks: "Tokyo Disneyland, DisneySea y Universal Studios Japan", provider: "Klook", url: klook("Tokyo Disney Resort") },
  cancun: { parks: "Xcaret y Xel-Há", provider: "Klook", url: klook("Xcaret") },
  "beto-carrero": { parks: "Beto Carrero World", provider: "Beto Carrero World (sitio oficial)", url: "https://www.betocarrero.com.br/" },
  gramado: { parks: "Snowland", provider: "Snowland (sitio oficial)", url: "https://www.snowland.com.br/" },
  fortaleza: { parks: "Beach Park", provider: "Beach Park (sitio oficial)", url: "https://beachpark.com.br/" },
};

/** Máximo de tarjetas de extras para que la grilla quede prolija. */
export const MAX_EXTRAS = 6;

export function extrasFor(dest: Destination): Extra[] {
  const city = dest.name.split(" y ")[0];
  const abroad = dest.country !== "Argentina";
  const out: Extra[] = [
    {
      kind: "traslado",
      title: "Traslado del aeropuerto",
      description: "Chofer esperándote con tu nombre, precio fijo reservado de antemano.",
      provider: "Welcome Pickups",
      url: "https://www.welcomepickups.com/",
    },
    {
      kind: "excursiones",
      title: "Excursiones y tours",
      description: `Tours y actividades en ${city}, con cancelación flexible.`,
      provider: "Klook",
      url: `https://www.klook.com/es/search/result/?query=${encodeURIComponent(city)}`,
    },
  ];
  const car = CAR_COUNTRY[dest.id];
  if (car) {
    out.splice(1, 0, {
      kind: "auto",
      title: "Alquiler de auto",
      description: `Autos de empresas locales en ${dest.country === "Argentina" ? city : dest.country}, con el precio final a la vista antes de reservar.`,
      provider: "Localrent",
      url: `https://localrent.com/es/${car}/`,
    });
  }
  // Entradas a parques: van segundas para que no queden afuera del máximo de tarjetas.
  // Reemplazan a la tarjeta genérica de Tiqets (no hace falta mostrar las dos).
  const park = dest.tags.includes("parques") ? PARK_TICKETS[dest.id] : undefined;
  if (park) {
    out.splice(1, 0, {
      kind: "parques",
      title: "Entradas a parques",
      description: `${park.parks}: entradas con fecha. El precio se ve en el sitio al elegir el día.`,
      provider: park.provider,
      url: park.url,
    });
  }
  // Entradas a museos y atracciones: Tiqets casi no tiene oferta dentro de Argentina.
  if (abroad && !park) {
    out.push({
      kind: "entradas",
      title: "Entradas y atracciones",
      description: `Museos, miradores y atracciones de ${city} con entrada digital, sin hacer la fila.`,
      provider: "Tiqets",
      url: `https://www.tiqets.com/es/search?q=${encodeURIComponent(city)}`,
    });
  }
  const airalo = AIRALO[dest.country];
  if (abroad && airalo) {
    out.push({
      kind: "esim",
      title: "Chip de datos (eSIM)",
      description: `Internet en ${dest.country} desde que aterrizás, sin roaming ni cambiar de chip.`,
      provider: "Airalo",
      url: `https://www.airalo.com/${airalo}-esim`,
    });
  }
  if (abroad) {
    out.push({
      kind: "seguro",
      title: "Seguro de viaje",
      description: "Asistencia médica y equipaje. Algunos países la piden para entrar.",
      provider: "EKTA",
      url: "https://ektatraveling.com/",
    });
  }
  return out.slice(0, MAX_EXTRAS);
}
