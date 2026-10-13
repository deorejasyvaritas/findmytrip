// Caché para respuestas de APIs externas. En Cloudflare usamos la Cache API
// (gratis); en tests/Node cae a un Map en memoria.

interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

const memory = new Map<string, { at: number; ttl: number; value: unknown }>();

function edgeCache(): EdgeCache | null {
  const c = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return c?.default ?? null;
}

/** Devuelve el valor cacheado o ejecuta `load`. No cachea `null`. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  // La Cache API necesita una URL como clave.
  const url = `https://cache.findmytrip.internal/${encodeURIComponent(key)}`;
  const edge = edgeCache();
  if (edge) {
    const hit = await edge.match(url);
    if (hit) return (await hit.json()) as T;
  } else {
    const hit = memory.get(url);
    if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.value as T;
  }

  const value = await load();
  if (value == null) return null;
  if (edge) {
    await edge.put(
      url,
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` },
      }),
    );
  } else {
    memory.set(url, { at: Date.now(), ttl: ttlSeconds, value });
  }
  return value;
}

/** fetch JSON con timeout; devuelve null ante cualquier error. */
export async function fetchJSON<T>(url: string, label: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.warn(`[${label}] HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[${label}] error:`, (err as Error).message);
    return null;
  }
}
