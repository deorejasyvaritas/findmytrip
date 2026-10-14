import type { Destination } from "./types.ts";

// Extras opcionales del viaje con programas de Travelpayouts. Los links se
// convierten en links con comisión en el servidor (API de links de Travelpayouts).

export interface Extra {
  kind: "traslado" | "auto" | "esim" | "excursiones" | "entradas" | "seguro";
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
  "punta-del-este": "uruguay",
  "costa-rica": "costa-rica",
  aruba: "aruba",
  cancun: "mexico",
  miami: "usa",
  lisboa: "portugal",
  grecia: "greece",
  croacia: "croatia",
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
  // Entradas a museos y atracciones: Tiqets casi no tiene oferta dentro de Argentina.
  if (abroad) {
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
