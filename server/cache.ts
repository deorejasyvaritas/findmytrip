// Caché para respuestas de APIs externas, para no gastar cuota repitiendo
// búsquedas. Usa Cloudflare KV (gratis, compartido entre visitas y que sí
// funciona en *.workers.dev) y una copia en memoria del Worker. Sin KV (tests)
// queda solo la memoria.

export interface KVStore {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

let store: KVStore | null = null;

/** Se llama al inicio de cada request con el binding de KV (si existe). */
export function useCacheStore(kv: KVStore | undefined): void {
  store = kv ?? null;
}

const memory = new Map<string, { until: number; value: unknown }>();

function fromMemory<T>(key: string): T | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.until < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value as T;
}

/** Valor cacheado sin ir a la API (null si no hay). */
export async function peek<T>(key: string): Promise<T | null> {
  const mem = fromMemory<T>(key);
  if (mem != null) return mem;
  if (!store) return null;
  try {
    return ((await store.get(key, "json")) as T | null) ?? null;
  } catch {
    return null;
  }
}

/** Devuelve el valor cacheado o ejecuta `load`. No cachea `null`. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = await peek<T>(key);
  if (hit != null) return hit;

  const value = await load();
  if (value == null) return null;
  memory.set(key, { until: Date.now() + ttlSeconds * 1000, value });
  if (store) {
    try {
      // KV exige al menos 60 s de vida.
      await store.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) });
    } catch (err) {
      console.warn("[cache] no se pudo guardar en KV:", (err as Error).message);
    }
  }
  return value;
}

/** fetch JSON con timeout; devuelve null ante cualquier error. */
export async function fetchJSON<T>(url: string, label: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
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

// Datos persistentes (historial del radar, alertas): sin vencimiento.
const persistent = new Map<string, unknown>();

export async function loadJSON<T>(key: string): Promise<T | null> {
  if (!store) return (persistent.get(key) as T | undefined) ?? null;
  try {
    return ((await store.get(key, "json")) as T | null) ?? null;
  } catch {
    return null;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  if (!store) {
    persistent.set(key, value);
    return;
  }
  await store.put(key, JSON.stringify(value));
}

/** Borra un dato persistente (si el KV no permite borrar, lo deja en null). */
export async function deleteJSON(key: string): Promise<void> {
  if (!store) {
    persistent.delete(key);
    return;
  }
  if (store.delete) await store.delete(key);
  else await store.put(key, "null");
}
