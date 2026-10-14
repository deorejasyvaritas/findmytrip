// Genera server/data/airports.json: lista compacta de aeropuertos con vuelos
// comerciales, a partir de la lista pública de Travelpayouts (gratis, sin clave).
// El Worker la importa directo: así no descarga ni parsea 2,4 MB en cada
// pedido (el plan gratuito de Workers da 10 ms de CPU por pedido).
//
// Para actualizarla (cada tanto, cambia poco):
//   node scripts/airports.mjs
// o con un archivo ya descargado:
//   node scripts/airports.mjs ruta/a/airports.json
//
// Cada fila: [código IATA, código de ciudad, latitud, longitud, nombre].

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = "https://api.travelpayouts.com/data/es/airports.json";
const OUT = fileURLToPath(new URL("../server/data/airports.json", import.meta.url));

const raw = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : await (await fetch(SOURCE)).json();
if (!Array.isArray(raw)) throw new Error("La respuesta no es una lista de aeropuertos");

const round = (n) => Math.round(n * 1000) / 1000;
const rows = raw
  .filter((a) => a.flightable && a.iata_type === "airport" && a.coordinates && typeof a.code === "string")
  .map((a) => [a.code, a.city_code ?? a.code, round(a.coordinates.lat), round(a.coordinates.lon), a.name ?? a.name_translations?.en ?? a.code])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

writeFileSync(OUT, `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${rows.length} aeropuertos en ${OUT}`);
