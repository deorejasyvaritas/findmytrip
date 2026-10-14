// Clima esperado por mes, a partir del historial diario de Open-Meteo.
// Lógica pura (sin fetch) para poder usarla en el Worker, en la app y en los tests.

/** Promedio de un mes del año (1 = enero). Datos compactos para guardar en KV. */
export interface ClimateMonth {
  m: number;
  /** Máxima y mínima promedio, en °C (redondeadas). */
  tmax: number;
  tmin: number;
  /** Lluvia total promedio del mes, en mm. */
  rainMm: number;
  /** Días con 1 mm o más de lluvia, promedio. */
  rainDays: number;
}

/** Respuesta diaria del archivo histórico de Open-Meteo (solo lo que usamos). */
export interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: (number | null)[];
  temperature_2m_min: (number | null)[];
  precipitation_sum: (number | null)[];
}

/** A partir de este valor el día cuenta como "de lluvia" (criterio usual de los servicios meteorológicos). */
export const RAIN_DAY_MM = 1;

/** Agrupa el historial diario en 12 filas, una por mes. Meses sin datos quedan afuera. */
export function aggregateClimate(daily: OpenMeteoDaily): ClimateMonth[] {
  const acc = Array.from({ length: 12 }, () => ({ tmax: 0, nMax: 0, tmin: 0, nMin: 0, rain: 0, rainDays: 0, nRain: 0 }));
  for (let i = 0; i < daily.time.length; i++) {
    const m = Number(daily.time[i].slice(5, 7)) - 1;
    const a = acc[m];
    if (!a) continue;
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    const p = daily.precipitation_sum[i];
    if (hi != null) (a.tmax += hi), a.nMax++;
    if (lo != null) (a.tmin += lo), a.nMin++;
    if (p != null) {
      a.rain += p;
      a.nRain++;
      if (p >= RAIN_DAY_MM) a.rainDays++;
    }
  }
  const out: ClimateMonth[] = [];
  acc.forEach((a, i) => {
    if (!a.nMax || !a.nMin) return;
    // Los totales del mes se escalan a la cantidad de días del mes (así un año con huecos no baja el promedio).
    const perMonth = a.nRain ? DAYS_IN_MONTH[i] / a.nRain : 0;
    out.push({
      m: i + 1,
      tmax: Math.round(a.tmax / a.nMax),
      tmin: Math.round(a.tmin / a.nMin),
      rainMm: Math.round(a.rain * perMonth),
      rainDays: Math.round(a.rainDays * perMonth),
    });
  });
  return out;
}

const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type ClimateTone = "snow" | "cold" | "rain" | "hot" | "beach" | "warm" | "mild" | "cool";

/** Resumen en palabras simples: "Calor de playa", "Templado", "Frío, puede nevar"... */
export function climateSummary(c: Pick<ClimateMonth, "tmax" | "tmin" | "rainMm" | "rainDays">): { label: string; tone: ClimateTone } {
  if (c.tmax <= 8 && c.tmin <= 0) return { label: "Frío, puede nevar", tone: "snow" };
  if (c.tmax < 14) return { label: c.tmin <= 0 ? "Frío, con heladas" : "Frío", tone: "cold" };
  // Por milímetros y no solo por días: los modelos marcan muchos días de llovizna en el trópico.
  if (c.rainMm >= 150 || (c.rainDays >= 18 && c.rainMm >= 100))
    return c.tmax >= 24 ? { label: "Temporada de lluvias", tone: "rain" } : { label: "Lluvioso", tone: "rain" };
  if (c.tmax >= 33) return { label: "Mucho calor", tone: "hot" };
  if (c.tmax >= 27 && c.tmin >= 20) return { label: "Calor de playa", tone: "beach" };
  if (c.tmax >= 27) return { label: "Caluroso", tone: "warm" };
  if (c.tmax >= 20) return { label: "Templado", tone: "mild" };
  return { label: "Fresco", tone: "cool" };
}

/** "8 días de lluvia (90 mm)" o "Casi sin lluvia". */
export function rainText(c: Pick<ClimateMonth, "rainMm" | "rainDays">): string {
  if (c.rainDays <= 1 && c.rainMm < 15) return "Casi sin lluvia";
  return `${c.rainDays} ${c.rainDays === 1 ? "día" : "días"} de lluvia (${c.rainMm} mm)`;
}

/**
 * Redondea coordenadas para compartir la caché entre lugares cercanos (~10 km).
 * No más grueso: en zonas de montaña mover el punto cambia la altura y el clima.
 */
export const roundCoord = (x: number) => Math.round(x * 10) / 10;

/** Años completos que se promedian: los últimos `years` antes del año en curso. */
export function climateRange(now: Date, years = 4): { start: string; end: string } {
  const y = now.getUTCFullYear();
  return { start: `${y - years}-01-01`, end: `${y - 1}-12-31` };
}
