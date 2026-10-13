import { cached, fetchJSON } from "./cache.ts";

// Convierte links comunes (Klook, Airalo, Welcome Pickups...) en links con
// comisión usando la API de links de Travelpayouts. Cada link se guarda 30 días.
// Sin TRS (ID del proyecto) devuelve los links tal cual.

// Programas con su ID (p) y campaña, tal como aparecen en los links del panel de Travelpayouts.
// Para estos armamos el link directo, sin llamar a la API.
const PROGRAMS: Record<string, { p: number; campaign: number }> = {
  "welcomepickups.com": { p: 8919, campaign: 627 },
  "klook.com": { p: 4110, campaign: 137 },
  "airalo.com": { p: 8310, campaign: 541 },
  "ektatraveling.com": { p: 5869, campaign: 225 },
};

export function directPartnerLink(url: string, marker: string, trs: string): string | null {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const prog = PROGRAMS[host];
  if (!prog) return null;
  const qs = new URLSearchParams({ campaign_id: String(prog.campaign), marker, p: String(prog.p), trs, u: url });
  return `https://tp.media/r?${qs}`;
}

interface CreateResponse {
  result?: { links?: { url: string; code: string; partner_url?: string }[] };
}

export async function partnerLinks(
  keys: { token?: string; marker?: string; trs?: string },
  urls: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = Object.fromEntries(urls.map((u) => [u, u]));
  const { token, marker, trs } = keys;
  if (!marker || !trs) return out;
  const pending: string[] = [];
  for (const url of urls) {
    const direct = directPartnerLink(url, marker, trs);
    if (direct) out[url] = direct;
    else pending.push(url);
  }
  if (!token) return out;
  await Promise.all(
    pending.map(async (url) => {
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
