import { cached, fetchJSON } from "../cache.ts";

// Cotización real del dólar tarjeta (lo que pagás con tarjeta en el exterior),
// de dolarapi.com: gratis y sin clave.

export async function usdArsRate(fallback: number): Promise<{ rate: number; source: string }> {
  const data = await cached<{ venta?: number; nombre?: string }>("fx:tarjeta", 3600, () =>
    fetchJSON("https://dolarapi.com/v1/dolares/tarjeta", "dolarapi"),
  );
  if (data?.venta && data.venta > 0) {
    return { rate: Math.round(data.venta), source: `Dólar ${data.nombre ?? "tarjeta"} (dolarapi.com)` };
  }
  return { rate: fallback, source: "Cotización fija de respaldo" };
}

/** Percepción que suma el dólar tarjeta sobre el oficial (para el respaldo sin conexión). */
export const CARD_PERCEPTION = 1.3;

// Dólar oficial: lo que cuesta en pesos un viaje dentro de Argentina (vuelos y
// hoteles se pagan en pesos, sin percepciones). También de dolarapi.com.
export async function usdArsOfficialRate(cardFallback: number): Promise<{ rate: number; source: string }> {
  const data = await cached<{ venta?: number; nombre?: string }>("fx:oficial", 3600, () =>
    fetchJSON("https://dolarapi.com/v1/dolares/oficial", "dolarapi"),
  );
  if (data?.venta && data.venta > 0) {
    return { rate: Math.round(data.venta), source: `Dólar ${data.nombre ?? "oficial"} (dolarapi.com)` };
  }
  return { rate: Math.round(cardFallback / CARD_PERCEPTION), source: "Cotización fija de respaldo" };
}
