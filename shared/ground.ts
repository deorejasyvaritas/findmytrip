// Costo estimado de los traslados por tierra entre paradas ("Ya sé a dónde").
// Modelo simple y documentado: precio por km del medio más usado en cada país
// (micro de larga distancia o tren), con un pasaje mínimo. Para tramos cortos
// se suma la alternativa de un transfer privado (por vehículo).
// Valores de referencia 2025-2026 en USD, redondeados; el precio real depende
// de la empresa, la clase y la anticipación: siempre se muestra como estimado.

import type { GroundEstimate, Party } from "./types.ts";

interface Fare {
  mode: GroundEstimate["mode"];
  /** USD por km por persona. */
  perKm: number;
  /** Pasaje mínimo por persona. */
  min: number;
  /** Nivel de precios para el transfer privado. */
  level: "bajo" | "medio" | "alto";
}

const bus = (perKm: number, min: number, level: Fare["level"] = "medio"): Fare => ({ mode: "micro", perKm, min, level });
const train = (perKm: number, min: number, level: Fare["level"] = "alto"): Fare => ({ mode: "tren", perKm, min, level });
const either = (perKm: number, min: number, level: Fare["level"] = "alto"): Fare => ({ mode: "micro o tren", perKm, min, level });

// Clave: nombre del país en minúsculas y sin acentos (como lo devuelve la geocodificación en español).
const BY_COUNTRY: Record<string, Fare> = {
  // Sudamérica: micro de larga distancia
  argentina: bus(0.07, 8),
  brasil: bus(0.065, 8),
  chile: bus(0.05, 6),
  uruguay: bus(0.07, 5),
  paraguay: bus(0.05, 5, "bajo"),
  bolivia: bus(0.03, 4, "bajo"),
  peru: bus(0.04, 5, "bajo"),
  ecuador: bus(0.03, 4, "bajo"),
  colombia: bus(0.05, 6, "bajo"),
  venezuela: bus(0.04, 5, "bajo"),
  // Centro y Norteamérica
  mexico: bus(0.07, 8),
  "costa rica": bus(0.05, 5),
  panama: bus(0.05, 5),
  guatemala: bus(0.04, 4, "bajo"),
  cuba: bus(0.06, 8),
  "republica dominicana": bus(0.06, 6),
  "estados unidos": bus(0.1, 15, "alto"),
  canada: bus(0.12, 18, "alto"),
  // Europa: tren (o micro donde es lo habitual)
  espana: either(0.15, 12),
  portugal: either(0.1, 8, "medio"),
  francia: train(0.18, 15),
  italia: train(0.14, 10),
  alemania: train(0.2, 15),
  suiza: train(0.35, 20),
  austria: train(0.15, 12),
  "paises bajos": train(0.2, 10),
  belgica: train(0.18, 10),
  "reino unido": train(0.25, 15),
  irlanda: either(0.15, 12),
  grecia: bus(0.1, 8, "medio"),
  croacia: bus(0.08, 8, "medio"),
  eslovenia: bus(0.08, 8, "medio"),
  hungria: train(0.08, 6, "medio"),
  "republica checa": train(0.07, 6, "medio"),
  polonia: train(0.07, 6, "medio"),
  turquia: bus(0.05, 8, "medio"),
  // Asia, África y Medio Oriente
  japon: train(0.25, 15),
  "corea del sur": train(0.12, 10, "medio"),
  china: train(0.1, 8, "medio"),
  tailandia: bus(0.03, 5, "bajo"),
  vietnam: bus(0.03, 5, "bajo"),
  camboya: bus(0.03, 6, "bajo"),
  indonesia: bus(0.04, 5, "bajo"),
  malasia: bus(0.03, 5, "bajo"),
  india: train(0.02, 3, "bajo"),
  marruecos: either(0.04, 5, "bajo"),
  egipto: either(0.03, 5, "bajo"),
};

// Sin dato del país: un valor intermedio, conservador.
const DEFAULT: Fare = bus(0.08, 10);

// Transfer privado (auto con chofer, hasta 3 personas), por vehículo: USD por km y mínimo.
export const TRANSFER: Record<Fare["level"], { perKm: number; min: number }> = {
  bajo: { perKm: 0.6, min: 25 },
  medio: { perKm: 1, min: 40 },
  alto: { perKm: 1.8, min: 70 },
};

/** Solo se ofrece transfer privado en tramos cortos. */
export const TRANSFER_MAX_KM = 150;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const ALIASES: Record<string, string> = {
  brazil: "brasil",
  spain: "espana",
  france: "francia",
  italy: "italia",
  germany: "alemania",
  "united states": "estados unidos",
  "ee. uu.": "estados unidos",
  "ee.uu.": "estados unidos",
  usa: "estados unidos",
  "united kingdom": "reino unido",
  japan: "japon",
  thailand: "tailandia",
  netherlands: "paises bajos",
  holanda: "paises bajos",
  morocco: "marruecos",
  switzerland: "suiza",
  greece: "grecia",
  croatia: "croacia",
};

export function fareFor(country: string): Fare {
  const key = norm(country);
  return BY_COUNTRY[ALIASES[key] ?? key] ?? DEFAULT;
}

export const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** Link de búsqueda en Rome2Rio (horarios, empresas y precios por tramo). */
export const rome2rioUrl = (from: string, to: string) => {
  const slug = (s: string) => encodeURIComponent(s.trim().replace(/\s+/g, "-"));
  return `https://www.rome2rio.com/s/${slug(from)}/${slug(to)}`;
};

/**
 * Costo estimado de un tramo por tierra. Si cruza de país, promedia las dos tarifas.
 * El pasaje es por persona; el transfer privado, por vehículo (solo tramos de hasta 150 km).
 */
export function groundEstimate(km: number, fromCountry: string, toCountry: string, fromName: string, toName: string): GroundEstimate {
  const a = fareFor(fromCountry);
  const b = fareFor(toCountry);
  const perKm = (a.perKm + b.perKm) / 2;
  const min = Math.max(a.min, b.min);
  const dist = Math.max(0, km);
  const perPerson = round5(Math.max(min, dist * perKm));
  const t = TRANSFER[a.level === "alto" || b.level === "alto" ? "alto" : a.level === "medio" || b.level === "medio" ? "medio" : "bajo"];
  const transfer = dist <= TRANSFER_MAX_KM ? round5(Math.max(t.min, dist * t.perKm)) : null;
  return { mode: a.mode === b.mode ? a.mode : "micro o tren", perPerson, transfer, rome2rioUrl: rome2rioUrl(fromName, toName) };
}

/** Pasajes que paga el grupo: los bebés (menos de 2 años) viajan a upa. */
export const groundSeats = (p: Party) => p.adults + p.childAges.filter((a) => a >= 2).length;

/** Total del grupo para los tramos por tierra (micro o tren, el pasaje estimado). */
export function groundTotal(legs: { ground?: GroundEstimate | null }[], p: Party): number {
  return legs.reduce((sum, l) => sum + (l.ground ? l.ground.perPerson * groundSeats(p) : 0), 0);
}
