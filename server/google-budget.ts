import { cached, fetchJSON, loadJSONStrict, trySaveJSON } from "./cache.ts";

// Google (SerpApi) da 250 búsquedas por mes. La app las usa sola, sin pedirle
// nada al usuario, y solo cuando no hay otro precio real. Si quedan pocas,
// deja de usarlas hasta el mes siguiente y la app sigue con los demás precios.
//
// Doble freno:
// - Lo que dice la cuenta de SerpApi (consultarla no gasta búsquedas; se
//   guarda 1 h, así que puede estar un poco atrasado).
// - Un contador propio por mes en KV (`gbudget:YYYY-MM`) que suma cada
//   búsqueda real (las respuestas cacheadas no cuentan).
// Se usa el menor de los dos. Si no se sabe cuántas quedan, no se busca.

export const MONTHLY_SEARCHES = 250;
export const RESERVE = 25;

export const budgetKey = (now = new Date()) => `gbudget:${now.toISOString().slice(0, 7)}`;

export async function googleSearchesLeft(apiKey: string): Promise<number | null> {
  const r = await cached<{ left: number }>("serp:left", 3600, async () => {
    const a = await fetchJSON<{ total_searches_left?: number; plan_searches_left?: number }>(
      `https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`,
      "serpapi-account",
    );
    const left = a?.total_searches_left ?? a?.plan_searches_left;
    return typeof left === "number" ? { left } : null;
  });
  return r?.left ?? null;
}

// Copia en memoria del contador: KV tarda hasta un minuto en mostrar lo último
// que se escribió, así que nos quedamos con el mayor de los dos.
const usedMemo = new Map<string, number>();

/** Búsquedas que hizo la app este mes según el contador propio (null si no se pudo leer). */
export async function googleSearchesUsed(now = new Date()): Promise<number | null> {
  const key = budgetKey(now);
  try {
    const stored = (await loadJSONStrict<number>(key)) ?? 0;
    return Math.max(typeof stored === "number" ? stored : 0, usedMemo.get(key) ?? 0);
  } catch {
    return null;
  }
}

/** Búsquedas disponibles: el menor entre lo que dice la cuenta y el contador propio. */
export function budgetLeft(remote: number | null, used: number | null): number | null {
  if (remote == null || used == null) return null;
  return Math.min(remote, MONTHLY_SEARCHES - used);
}

/** ¿Se puede gastar una búsqueda de Google sin acercarse al límite del mes? */
export async function canUseGoogle(apiKey: string | undefined, now = new Date()): Promise<boolean> {
  if (!apiKey) return false;
  const [remote, used] = await Promise.all([googleSearchesLeft(apiKey).catch(() => null), googleSearchesUsed(now)]);
  const left = budgetLeft(remote, used);
  return left != null && left > RESERVE;
}

/** Anota una búsqueda real (1 escritura de KV por búsqueda: como mucho 250 por mes). */
export async function spendGoogle(now = new Date()): Promise<void> {
  const key = budgetKey(now);
  const used = ((await googleSearchesUsed(now)) ?? usedMemo.get(key) ?? 0) + 1;
  usedMemo.set(key, used);
  // Mes nuevo: el contador anterior ya no sirve (vence solo a los ~40 días).
  await trySaveJSON(key, used, { expirationTtl: 40 * 86400 });
}

/**
 * Única puerta para buscar en SerpApi: revisa el presupuesto del mes, busca y
 * anota la búsqueda. Devuelve null si no hay presupuesto o si falló.
 * Llamala solo dentro de la función de carga de una caché, así los aciertos
 * de caché no gastan.
 */
export async function googleSearch<T extends { error?: string }>(apiKey: string, params: URLSearchParams, label: string): Promise<T | null> {
  if (!(await canUseGoogle(apiKey))) return null;
  const qs = new URLSearchParams(params);
  qs.set("api_key", apiKey);
  await spendGoogle();
  const r = await fetchJSON<T>(`https://serpapi.com/search.json?${qs}`, label);
  return r && !r.error ? r : null;
}
