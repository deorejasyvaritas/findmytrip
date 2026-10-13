// Configuración del Worker. En local se lee de `.dev.vars`; en Cloudflare,
// de los "secrets" del proyecto (wrangler secret put ...).
import type { KVStore } from "./cache.ts";

export interface Env {
  /** KV de Cloudflare para cachear búsquedas (se crea solo en el primer deploy). */
  CACHE?: KVStore;
  /** Tu ID de afiliado de Travelpayouts (para ganar comisión con los links de Aviasales). */
  TRAVELPAYOUTS_MARKER?: string;
  /** Opcional (pago por uso): habilita el agente conversacional. */
  ANTHROPIC_API_KEY?: string;
  /** Gratis: precios reales de vuelos (Aviasales Data API). */
  TRAVELPAYOUTS_TOKEN?: string;
  /** Gratis hasta 250 búsquedas/mes: hoteles y vuelos de Google. */
  SERPAPI_KEY?: string;
  /** Cotización de respaldo si no responde dolarapi.com. */
  USD_ARS_RATE?: string;
}

export const has = (v: string | undefined): v is string => Boolean(v && v.trim());

/** Limpia espacios y saltos de línea que se cuelan al pegar las claves. */
export function config(env: Env): Env {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return {
    ANTHROPIC_API_KEY: clean(env.ANTHROPIC_API_KEY),
    TRAVELPAYOUTS_TOKEN: clean(env.TRAVELPAYOUTS_TOKEN),
    SERPAPI_KEY: clean(env.SERPAPI_KEY),
    USD_ARS_RATE: clean(env.USD_ARS_RATE),
    TRAVELPAYOUTS_MARKER: clean(env.TRAVELPAYOUTS_MARKER),
    CACHE: env.CACHE,
  };
}
