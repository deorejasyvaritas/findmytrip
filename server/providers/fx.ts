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
