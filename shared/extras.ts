import type { Destination } from "./types.ts";

// Extras opcionales del viaje con programas de Travelpayouts. Los links se
// convierten en links con comisión en el servidor (API de links de Travelpayouts).

export interface Extra {
  kind: "traslado" | "esim" | "excursiones" | "seguro";
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
      title: "Excursiones y entradas",
      description: `Tours, actividades y entradas en ${city}, con cancelación flexible.`,
      provider: "Klook",
      url: `https://www.klook.com/es/search/result/?query=${encodeURIComponent(city)}`,
    },
  ];
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
  return out;
}
