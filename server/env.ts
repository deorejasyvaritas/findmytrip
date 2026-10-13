// Configuración del Worker. En local se lee de `.dev.vars`; en Cloudflare,
// de los "secrets" del proyecto (wrangler secret put ...).
import type { WorkersAI } from "./agent.ts";
import type { KVStore } from "./cache.ts";

export interface Env {
  /** Workers AI de Cloudflare: agente gratis (cuota diaria) si no hay clave de Claude. */
  AI?: WorkersAI;
  /** KV de Cloudflare para cachear búsquedas (se crea solo en el primer deploy). */
  CACHE?: KVStore;
  /** Tu ID de afiliado de Travelpayouts (para ganar comisión con los links de Aviasales). */
  TRAVELPAYOUTS_MARKER?: string;
  /** ID del proyecto en Travelpayouts ("trs"): para convertir links de Klook, Airalo, etc. en links con comisión. */
  TRAVELPAYOUTS_TRS?: string;
  /** Opcional (pago por uso): habilita el agente conversacional. */
  ANTHROPIC_API_KEY?: string;
  /** Gratis: precios reales de vuelos (Aviasales Data API). */
  TRAVELPAYOUTS_TOKEN?: string;
  /** Gratis hasta 250 búsquedas/mes: hoteles y vuelos de Google. */
  SERPAPI_KEY?: string;
  /** Gratis: tu bot de Telegram (BotFather) para recibir alertas. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Dirección pública del sitio, para los links de las alertas. */
  SITE_URL?: string;
  /** Ciudades de salida que barre el radar automático (ej. "BUE,COR"). */
  RADAR_ORIGINS?: string;
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
    TRAVELPAYOUTS_TRS: clean(env.TRAVELPAYOUTS_TRS),
    TELEGRAM_BOT_TOKEN: clean(env.TELEGRAM_BOT_TOKEN),
    SITE_URL: clean(env.SITE_URL),
    RADAR_ORIGINS: clean(env.RADAR_ORIGINS),
    CACHE: env.CACHE,
    AI: env.AI,
  };
}
