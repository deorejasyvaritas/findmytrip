import { cached, fetchJSON, peek } from "../cache.ts";
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
  thumbnail?: { source?: string; width?: number };
  originalimage?: { source?: string; width?: number };
}

// Wikimedia exige identificarse y solo sirve miniaturas en anchos estándar.
const HEADERS = {
  "User-Agent": "FindMyTrip/1.0 (planificador de viajes personal; contacto via workers.dev)",
  "Api-User-Agent": "FindMyTrip/1.0 (planificador de viajes personal)",
};
const STANDARD_WIDTH = 960;

export function pickImage(data: WikiSummary | null): string | null {
  const original = data?.originalimage;
  const thumb = data?.thumbnail?.source;
  // Si el original es chico, se usa tal cual (pedir una miniatura más grande que el original falla).
  if (original?.source && (original.width ?? 0) <= STANDARD_WIDTH) return original.source;
  if (thumb && /\/\d+px-/.test(thumb)) return thumb.replace(/\/\d+px-/, `/${STANDARD_WIDTH}px-`);
  return original?.source ?? thumb ?? null;
}

async function photoFor(title: string): Promise<string | null> {
  return cached<string>(`photo:v2:${title}`, 30 * 86400, async () =>
    pickImage(
      await fetchJSON<WikiSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, "wikipedia", {
        headers: HEADERS,
      }),
    ),
  );
}

/** { idDestino: urlFoto } para todo el catálogo. */
export async function destinationPhotos(): Promise<Record<string, string>> {
  const all = await cached<Record<string, string>>("photos:all:v2", 7 * 86400, async () => {
    const map: Record<string, string> = {};
    // De a 8 por vez, para no recibir "demasiados pedidos" de Wikipedia.
    const ids = DESTINATIONS.map((d) => d.id).filter((id) => WIKI_TITLE[id]);
    for (let i = 0; i < ids.length; i += 8) {
      const batch = await Promise.all(ids.slice(i, i + 8).map(async (id) => [id, await photoFor(WIKI_TITLE[id])] as const));
      for (const [id, url] of batch) if (url) map[id] = url;
    }
    // Solo guardamos el conjunto si está casi completo; si no, se reintenta la próxima vez
    // (las fotos individuales que sí llegaron quedan en caché igual).
    return Object.keys(map).length >= ids.length * 0.8 ? map : null;
  });
  if (all) return all;
  const partial: Record<string, string> = {};
  for (const d of DESTINATIONS) {
    const url = WIKI_TITLE[d.id] ? await peek<string>(`photo:v2:${WIKI_TITLE[d.id]}`) : null;
    if (url) partial[d.id] = url;
  }
  return partial;
}
