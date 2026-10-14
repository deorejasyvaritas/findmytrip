import { cached, fetchJSON } from "../cache.ts";
import { aggregateClimate, climateRange, roundCoord, type ClimateMonth, type OpenMeteoDaily } from "../../shared/climate.ts";

// Clima esperado por mes con el archivo histórico de Open-Meteo (gratis, sin clave).
// Se piden los últimos 4 años completos una sola vez y se guardan en KV ya
// resumidos (12 filas): así las visitas siguientes no gastan CPU del Worker.

const TTL = 90 * 24 * 3600;

export async function climateFor(lat: number, lon: number, now = new Date()): Promise<ClimateMonth[] | null> {
  const la = roundCoord(lat);
  const lo = roundCoord(lon);
  return cached(`climate:v1:${la},${lo}`, TTL, async () => {
    const { start, end } = climateRange(now);
    const qs = new URLSearchParams({
      latitude: String(la),
      longitude: String(lo),
      start_date: start,
      end_date: end,
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
      timezone: "auto",
    });
    const r = await fetchJSON<{ daily?: OpenMeteoDaily }>(`https://archive-api.open-meteo.com/v1/archive?${qs}`, "clima");
    if (!r?.daily?.time?.length) return null;
    const months = aggregateClimate(r.daily);
    return months.length === 12 ? months : null;
  });
}
