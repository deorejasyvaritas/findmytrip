// Configuración del Worker. En local se lee de `.dev.vars`; en Cloudflare,
// de los "secrets" del proyecto (wrangler secret put ...).
export interface Env {
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
