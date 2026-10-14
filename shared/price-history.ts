// Cuentas del gráfico "Precio en las últimas semanas" (página del destino).
// Funciones puras: se usan en el navegador y se prueban en tests/price-history.test.ts.

export interface PricePoint {
  t: string; // cuándo se vio (ISO)
  p: number; // precio ida y vuelta por persona, USD
}

export interface PriceSummary {
  points: PricePoint[]; // ordenados por fecha
  min: number;
  minIndex: number; // el más reciente si hay empate
  max: number;
  /** Lo habitual: mediana de lo observado antes del último precio. */
  typical: number;
  current: number;
  /** Diferencia de hoy contra lo habitual, en % (negativo = más barato). */
  deltaPct: number;
  verdict: "below" | "above" | "typical";
}

/** Por debajo de este % de diferencia se considera "lo habitual". */
export const TYPICAL_BAND = 3;
export const MIN_POINTS = 3;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Limpia y resume el historial. Devuelve null si todavía hay pocos datos. */
export function summarizeHistory(raw: PricePoint[], minPoints = MIN_POINTS): PriceSummary | null {
  const points = raw
    .filter((o) => Number.isFinite(o?.p) && o.p > 0 && !Number.isNaN(Date.parse(o.t)))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (points.length < Math.max(2, minPoints)) return null;
  const prices = points.map((o) => o.p);
  const current = prices[prices.length - 1];
  const typical = Math.round(median(prices.slice(0, -1)));
  const min = Math.min(...prices);
  const deltaPct = Math.round((current / typical - 1) * 100);
  return {
    points,
    min,
    minIndex: prices.lastIndexOf(min),
    max: Math.max(...prices),
    typical,
    current,
    deltaPct,
    verdict: Math.abs(deltaPct) < TYPICAL_BAND ? "typical" : deltaPct < 0 ? "below" : "above",
  };
}

/** "Hoy está 12 % por debajo de lo habitual." */
export function historySentence(s: Pick<PriceSummary, "deltaPct" | "verdict">): string {
  if (s.verdict === "typical") return "Hoy está en su precio habitual.";
  const pct = Math.abs(s.deltaPct);
  return `Hoy está ${pct} % ${s.verdict === "below" ? "por debajo" : "por encima"} de lo habitual.`;
}

export interface ChartGeometry {
  /** Posición de cada punto, en % del ancho y del alto (0 arriba). */
  xy: { x: number; y: number }[];
  line: string; // path del trazo, en un viewBox 0 0 100 100
  area: string; // path del relleno bajo la línea
  typicalY: number; // altura de la línea de "habitual", en %
}

/**
 * Ubica los puntos en un lienzo de 100 × 100 (el eje X es el tiempo real, no
 * el orden: los barridos no son parejos). Deja aire arriba y abajo para que la
 * línea no toque los bordes.
 */
export function chartGeometry(s: Pick<PriceSummary, "points" | "min" | "max" | "typical">): ChartGeometry {
  const times = s.points.map((o) => Date.parse(o.t));
  const t0 = times[0];
  const span = Math.max(1, times[times.length - 1] - t0);
  const lo = Math.min(s.min, s.typical);
  const hi = Math.max(s.max, s.typical);
  const pad = Math.max((hi - lo) * 0.2, hi * 0.03, 1);
  const bottom = lo - pad;
  const range = hi + pad - bottom;
  const y = (p: number) => round(100 - ((p - bottom) / range) * 100);
  const xy = s.points.map((o, i) => ({ x: round(((times[i] - t0) / span) * 100), y: y(o.p) }));
  const line = xy.map((pt, i) => `${i ? "L" : "M"}${pt.x} ${pt.y}`).join(" ");
  const area = `${line} L${xy[xy.length - 1].x} 100 L${xy[0].x} 100 Z`;
  return { xy, line, area, typicalY: y(s.typical) };
}

/** Índice del punto más cercano a una posición horizontal (0-100). */
export function nearestIndex(xy: { x: number }[], x: number): number {
  let best = 0;
  for (let i = 1; i < xy.length; i++) if (Math.abs(xy[i].x - x) < Math.abs(xy[best].x - x)) best = i;
  return best;
}

const round = (n: number) => Math.round(n * 100) / 100;
