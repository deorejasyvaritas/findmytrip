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
const MEMORY_MAX = 3000;

function remember(key: string, ttlSeconds: number, value: unknown): void {
  // Tope para que la copia en memoria no crezca sin límite (autocompletado, etc.).
  if (memory.size >= MEMORY_MAX) {
    let drop = Math.ceil(MEMORY_MAX / 10);
    for (const k of memory.keys()) {
      memory.delete(k);
      if (--drop <= 0) break;
    }
  }
  memory.set(key, { until: Date.now() + ttlSeconds * 1000, value });
}

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
  remember(key, ttlSeconds, value);
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

// ---------------------------------------------------------------------------
// Caché "de borde" (Cache API de Cloudflare): gratis y sin gastar escrituras de
// KV (el plan gratuito da 1000 por día). Es por centro de datos y puede
// borrarse en cualquier momento: sirve para datos baratos de volver a pedir
// (autocompletado, tarifas de un hotel). Ojo: en *.workers.dev la Cache API no
// guarda nada (solo funciona con dominio propio); ahí queda la copia en memoria.
// En local (vite dev, tests) puede no existir `caches.default`.
// ---------------------------------------------------------------------------

interface EdgeCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

function edgeCache(): EdgeCache | null {
  try {
    return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

const edgeRequest = (key: string) => new Request(`https://edge-cache.findmytrip.internal/${encodeURIComponent(key)}`);

/** Valor guardado en la caché de borde (o en memoria). null si no hay o si falla. */
export async function edgeGet<T>(key: string): Promise<T | null> {
  const mem = fromMemory<T>(key);
  if (mem != null) return mem;
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const res = await cache.match(edgeRequest(key));
    return res ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Guarda en la caché de borde y en memoria. Nunca falla. */
export async function edgePut(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  remember(key, ttlSeconds, value);
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(
      edgeRequest(key),
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.max(1, Math.round(ttlSeconds))}` },
      }),
    );
  } catch (err) {
    console.warn("[cache] no se pudo guardar en la caché de borde:", (err as Error).message);
  }
}

/** Como `cached`, pero sin KV: caché de borde + memoria. No cachea `null`. */
export async function edgeCached<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = await edgeGet<T>(key);
  if (hit != null) return hit;
  const value = await load();
  if (value == null) return null;
  await edgePut(key, value, ttlSeconds);
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

/** Error al leer o escribir en KV (cuota agotada, falla momentánea): no es "no existe". */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

/** Lee un dato persistente; ante un error de KV devuelve null (para datos no críticos). */
export async function loadJSON<T>(key: string): Promise<T | null> {
  try {
    return await loadJSONStrict<T>(key);
  } catch {
    return null;
  }
}

/**
 * Lee un dato persistente distinguiendo "no existe" (null) de "no se pudo leer"
 * (lanza StorageError). Para datos críticos como las cuentas: tratar una falla
 * de KV como "no existe" regeneraba la clave de sesión o reabría el registro.
 */
export async function loadJSONStrict<T>(key: string): Promise<T | null> {
  if (!store) return (persistent.get(key) as T | undefined) ?? null;
  try {
    return ((await store.get(key, "json")) as T | null) ?? null;
  } catch (err) {
    throw new StorageError(`No se pudo leer ${key}`, { cause: err });
  }
}

/** Guarda un dato persistente. Si KV falla (por ejemplo, cuota diaria agotada) lanza StorageError. */
export async function saveJSON(key: string, value: unknown, options?: { expirationTtl?: number }): Promise<void> {
  if (!store) {
    persistent.set(key, value);
    return;
  }
  try {
    await store.put(key, JSON.stringify(value), options?.expirationTtl ? { expirationTtl: Math.max(60, options.expirationTtl) } : undefined);
  } catch (err) {
    throw new StorageError(`No se pudo guardar ${key}`, { cause: err });
  }
}

/** Como saveJSON, pero nunca falla: devuelve si se pudo guardar. */
export async function trySaveJSON(key: string, value: unknown, options?: { expirationTtl?: number }): Promise<boolean> {
  try {
    await saveJSON(key, value, options);
    return true;
  } catch (err) {
    console.warn("[kv]", (err as Error).message);
    return false;
  }
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
