import { cached, fetchJSON } from "../cache.ts";
import { DESTINATIONS } from "../data/destinations.ts";

// Fotos ilustrativas de cada destino, tomadas de la imagen principal del
// artículo de Wikipedia (gratis, sin clave). Elegimos artículos de lugares
// emblemáticos para evitar mapas o banderas.
const WIKI_TITLE: Record<string, string> = {
  bariloche: "San_Carlos_de_Bariloche",
  mendoza: "Aconcagua",
  salta: "Quebrada_de_Humahuaca",
  iguazu: "Iguazu_Falls",
  ushuaia: "Ushuaia",
  calafate: "Perito_Moreno_Glacier",
  "puerto-madryn": "Valdes_Peninsula",
  "san-martin": "San_Martín_de_los_Andes",
  rio: "Rio_de_Janeiro",
  florianopolis: "Florianópolis",
  salvador: "Pelourinho",
  maceio: "Maceió",
  "punta-del-este": "Punta_del_Este",
  colonia: "Colonia_del_Sacramento",
  santiago: "Santiago",
  atacama: "San_Pedro_de_Atacama",
  cusco: "Machu_Picchu",
  lima: "Lima",
  cartagena: "Cartagena,_Colombia",
  medellin: "Medellín",
  "san-andres": "San_Andrés_(island)",
  uyuni: "Salar_de_Uyuni",
  galapagos: "Galápagos_Islands",
  "punta-cana": "Punta_Cana",
  cancun: "Cancún",
  "costa-rica": "Arenal_Volcano",
  aruba: "Oranjestad,_Aruba",
  cdmx: "Mexico_City",
  miami: "Miami",
  "nueva-york": "New_York_City",
  madrid: "Madrid",
  roma: "Rome",
  lisboa: "Lisbon",
  barcelona: "Barcelona",
  paris: "Paris",
  grecia: "Santorini",
  croacia: "Dubrovnik",
  tailandia: "Phi_Phi_Islands",
  japon: "Mount_Fuji",
  marruecos: "Chefchaouen",
};

interface WikiSummary {
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
}

async function photoFor(title: string): Promise<string | null> {
  return cached<string>(`photo:${title}`, 30 * 86400, async () => {
    const data = await fetchJSON<WikiSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, "wikipedia", {
      headers: { "Api-User-Agent": "FindMyTrip/1.0 (planificador de viajes personal)" },
    });
    const thumb = data?.thumbnail?.source;
    // Pedimos una versión de 800 px de ancho (suficiente para las tarjetas).
    if (thumb && /\/\d+px-/.test(thumb)) return thumb.replace(/\/\d+px-/, "/800px-");
    return data?.originalimage?.source ?? thumb ?? null;
  });
}

/** { idDestino: urlFoto } para todo el catálogo. */
export async function destinationPhotos(): Promise<Record<string, string>> {
  return (
    (await cached<Record<string, string>>("photos:all:v1", 7 * 86400, async () => {
      const entries = await Promise.all(
        DESTINATIONS.map(async (d) => [d.id, WIKI_TITLE[d.id] ? await photoFor(WIKI_TITLE[d.id]) : null] as const),
      );
      const map = Object.fromEntries(entries.filter((e): e is readonly [string, string] => Boolean(e[1])));
      // No guardamos un resultado vacío (por ejemplo si Wikipedia no respondió).
      return Object.keys(map).length ? map : null;
    })) ?? {}
  );
}
