import type { AlertSettings, AlertSub, RadarSnapshot } from "../shared/types.ts";
import { describeParty } from "../shared/pricing.ts";
import { fetchJSON, loadJSON, saveJSON } from "./cache.ts";
import { getDestination } from "./data/destinations.ts";
import { tripCost } from "./engine.ts";

// Alertas: destinos que seguís (aviso cuando el viaje entra en tu
// presupuesto) y ofertas del radar. Se envían por Telegram con tu propio bot
// (gratis). Es una app personal: hay un solo usuario y no hay login.

const SUBS_KEY = "alerts:subs";
const SETTINGS_KEY = "alerts:settings";
const SENT_DEALS_KEY = "alerts:sent-deals";

export const DEFAULT_SETTINGS: AlertSettings = { radarDeals: true, minDiscount: 25 };

export const listSubs = async () => (await loadJSON<AlertSub[]>(SUBS_KEY)) ?? [];
export const saveSubs = (subs: AlertSub[]) => saveJSON(SUBS_KEY, subs);
export const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...((await loadJSON<AlertSettings>(SETTINGS_KEY)) ?? {}) });
export const saveSettings = (s: AlertSettings) => saveJSON(SETTINGS_KEY, s);

export async function upsertSub(sub: AlertSub): Promise<AlertSub[]> {
  const subs = (await listSubs()).filter((s) => s.id !== sub.id);
  subs.unshift(sub);
  await saveSubs(subs);
  return subs;
}

export async function removeSub(id: string): Promise<AlertSub[]> {
  const subs = (await listSubs()).filter((s) => s.id !== id);
  await saveSubs(subs);
  return subs;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  const res = await fetchJSON<{ ok: boolean }>(`https://api.telegram.org/bot${token}/sendMessage`, "telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return Boolean(res?.ok);
}

/** Busca el último chat que le escribió al bot y lo guarda como destino de las alertas. */
export async function connectTelegram(token: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const res = await fetchJSON<{
    ok: boolean;
    result: { message?: { chat: { id: number; first_name?: string; username?: string } } }[];
  }>(`https://api.telegram.org/bot${token}/getUpdates?limit=20`, "telegram");
  if (!res?.ok) return { ok: false, error: "No pude hablar con Telegram. Revisá que el token del bot sea correcto." };
  const chat = [...res.result].reverse().find((u) => u.message?.chat)?.message?.chat;
  if (!chat) return { ok: false, error: "Todavía no veo tu mensaje. Abrí tu bot en Telegram, mandale /start y volvé a tocar Conectar." };
  const settings = await getSettings();
  const name = chat.first_name ?? chat.username ?? "vos";
  await saveSettings({ ...settings, telegramChatId: String(chat.id), telegramName: name });
  await sendTelegram(token, String(chat.id), `Listo, ${name}. FindMyTrip te va a avisar acá cuando baje un precio que te interesa.`);
  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// Evaluación (después de cada barrido del radar)
// ---------------------------------------------------------------------------

const money = (n: number) => `USD ${Math.round(n).toLocaleString("es-AR")}`;
const shortDate = (iso?: string) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

export async function evaluateAlerts(
  snap: RadarSnapshot,
  telegram: { token?: string; siteUrl?: string },
): Promise<{ sent: number }> {
  const settings = await getSettings();
  if (!telegram.token || !settings.telegramChatId || !snap.live) return { sent: 0 };
  const chatId = settings.telegramChatId;
  const site = telegram.siteUrl?.replace(/\/$/, "") ?? "";
  const messages: string[] = [];

  // 1) Destinos que seguís: aviso cuando el total estimado entra en tu presupuesto.
  const subs = await listSubs();
  let changed = false;
  for (const sub of subs) {
    if (sub.origin !== snap.origin) continue;
    const dest = getDestination(sub.destinationId);
    const months = snap.byMonth[sub.destinationId];
    if (!dest || !months) continue;
    const candidates = Object.entries(months).filter(([key]) => !sub.month || Number(key.slice(5, 7)) === sub.month);
    if (!candidates.length) continue;
    const [monthKey, offer] = candidates.reduce((a, b) => (b[1].p < a[1].p ? b : a));
    const total = tripCost(sub.origin, dest, Number(monthKey.slice(5, 7)), sub.nights, sub.party, sub.style, offer.p).total;
    const improved = sub.lastNotifiedUSD == null || total < sub.lastNotifiedUSD * 0.97;
    if (total <= sub.targetUSD && improved) {
      messages.push(
        [
          `${dest.name} entró en tu presupuesto`,
          `Total estimado: ${money(total)} (tu objetivo: ${money(sub.targetUSD)})`,
          `Vuelo: ${money(offer.p)} por persona${offer.dep ? `, ${shortDate(offer.dep)} – ${shortDate(offer.ret)}` : ""}`,
          `${describeParty(sub.party)}, ${sub.nights} noches`,
          site ? `${site}/destino/${dest.id}?month=${monthKey}&nights=${sub.nights}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      sub.lastNotifiedUSD = total;
      sub.lastNotifiedAt = snap.updatedAt;
      changed = true;
    }
  }
  if (changed) await saveSubs(subs);

  // 2) Ofertas del radar (como mucho 3 por barrido, sin repetir el mismo precio).
  if (settings.radarDeals) {
    const sent = (await loadJSON<Record<string, number>>(SENT_DEALS_KEY)) ?? {};
    const deals = snap.items.filter((i) => i.isDeal && i.discountPct >= settings.minDiscount && !(sent[i.destinationId] <= i.priceUSD * 1.03));
    for (const d of deals.slice(0, 3)) {
      messages.push(
        [
          `Oferta del radar: ${d.name} a ${money(d.priceUSD)} ida y vuelta`,
          `${d.discountPct} % menos que lo habitual (${money(d.typicalUSD)})${d.isMinimum ? ", el precio más bajo que vimos" : ""}`,
          d.depart ? `${shortDate(d.depart)} – ${shortDate(d.ret)}${d.airline ? ` · ${d.airline}` : ""}` : "",
          site ? `${site}/destino/${d.destinationId}?month=${d.depart?.slice(0, 7) ?? ""}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      sent[d.destinationId] = d.priceUSD;
    }
    if (deals.length) await saveJSON(SENT_DEALS_KEY, sent);
  }

  let count = 0;
  for (const text of messages) if (await sendTelegram(telegram.token, chatId, text)) count++;
  return { sent: count };
}
