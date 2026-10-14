import { cached, fetchJSON } from "./cache.ts";

// Google (SerpApi) da 250 búsquedas por mes. La app las usa sola, sin pedirle
// nada al usuario, y solo cuando no hay otro precio real. Si quedan pocas,
// deja de usarlas hasta el mes siguiente y la app sigue con los demás precios.

const RESERVE = 25;

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

/** ¿Se puede gastar una búsqueda de Google sin acercarse al límite del mes? */
export async function canUseGoogle(apiKey: string | undefined): Promise<boolean> {
  if (!apiKey) return false;
  const left = await googleSearchesLeft(apiKey).catch(() => null);
  return left == null || left > RESERVE;
}
