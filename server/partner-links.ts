import { cached, fetchJSON } from "./cache.ts";

// Convierte links comunes (Klook, Airalo, Welcome Pickups...) en links con
// comisión usando la API de links de Travelpayouts. Cada link se guarda 30 días.
// Sin TRS (ID del proyecto) devuelve los links tal cual.

interface CreateResponse {
  result?: { links?: { url: string; code: string; partner_url?: string }[] };
}

export async function partnerLinks(
  keys: { token?: string; marker?: string; trs?: string },
  urls: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = Object.fromEntries(urls.map((u) => [u, u]));
  const { token, marker, trs } = keys;
  if (!token || !marker || !trs) return out;
  await Promise.all(
    urls.map(async (url) => {
      const partner = await cached<string>(`plink:${trs}:${url}`, 30 * 86400, async () => {
        const r = await fetchJSON<CreateResponse>("https://api.travelpayouts.com/links/v1/create", "travelpayouts-links", {
          method: "POST",
          headers: { "X-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify({ trs: Number(trs), marker: Number(marker), shorten: false, links: [{ url }] }),
        });
        const link = r?.result?.links?.[0];
        return link?.code === "success" && link.partner_url ? link.partner_url : null;
      });
      if (partner) out[url] = partner;
    }),
  );
  return out;
}
