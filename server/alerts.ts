import type { AlertSettings, AlertSub, RadarSnapshot } from "../shared/types.ts";
import { describeParty } from "../shared/pricing.ts";
import { fetchJSON, loadJSON, saveJSON } from "./cache.ts";
import { getDestination } from "./data/destinations.ts";
import { tripCost } from "./engine.ts";

// Alertas de cada cuenta: destinos que sigue (aviso cuando el viaje entra en
// su presupuesto) y ofertas del radar. Se envían por Telegram con el bot del
// sitio (gratis); cada cuenta conecta su propio chat.

const subsKey = (user: string) => `alerts:subs:${user}`;
const settingsKey = (user: string) => `alerts:settings:${user}`;
const sentKey = (user: string) => `alerts:sent:${user}`;

export const DEFAULT_SETTINGS: AlertSettings = { radarDeals: true, minDiscount: 25 };

export const listSubs = async (user: string) => (await loadJSON<AlertSub[]>(subsKey(user))) ?? [];
export const saveSubs = (user: string, subs: AlertSub[]) => saveJSON(subsKey(user), subs);
export const getSettings = async (user: string): Promise<AlertSettings> => ({
  ...DEFAULT_SETTINGS,
  ...((await loadJSON<AlertSettings>(settingsKey(user))) ?? {}),
});
export const saveSettings = (user: string, s: AlertSettings) => saveJSON(settingsKey(user), s);

export async function upsertSub(user: string, sub: AlertSub): Promise<AlertSub[]> {
  const subs = (await listSubs(user)).filter((s) => s.id !== sub.id);
  subs.unshift(sub);
  await saveSubs(user, subs);
  return subs;
}

export async function removeSub(user: string, id: string): Promise<AlertSub[]> {
  const subs = (await listSubs(user)).filter((s) => s.id !== id);
  await saveSubs(user, subs);
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

async function botUsername(token: string): Promise<string | null> {
  const me = await fetchJSON<{ ok: boolean; result?: { username?: string } }>(`https://api.telegram.org/bot${token}/getMe`, "telegram");
  return me?.ok ? (me.result?.username ?? null) : null;
}

/** Paso 1: genera un link al bot con un código único para esta cuenta. */
export async function telegramLink(token: string, user: string): Promise<{ ok: boolean; url?: string; bot?: string; error?: string }> {
  const bot = await botUsername(token);
  if (!bot) return { ok: false, error: "El token del bot no es válido. Revisá TELEGRAM_BOT_TOKEN (lo da @BotFather)." };
  const code = crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), "").slice(0, 12);
  await saveSettings(user, { ...(await getSettings(user)), pendingCode: code });
  return { ok: true, bot, url: `https://t.me/${bot}?start=${code}` };
}

/** Paso 2: busca el mensaje "/start CÓDIGO" y guarda ese chat para las alertas. */
export async function connectTelegram(token: string, user: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const settings = await getSettings(user);
  const bot = await botUsername(token);
  if (!bot) return { ok: false, error: "El token del bot no es válido. Revisá TELEGRAM_BOT_TOKEN (lo da @BotFather)." };
  if (!settings.pendingCode) return { ok: false, error: "Tocá primero \"Abrir Telegram\"." };
  const res = await fetchJSON<{
    ok: boolean;
    description?: string;
    result: { message?: { text?: string; chat: { id: number; first_name?: string; username?: string } } }[];
  }>(`https://api.telegram.org/bot${token}/getUpdates?limit=100&allowed_updates=${encodeURIComponent('["message"]')}`, "telegram");
  if (!res?.ok) {
    return { ok: false, error: "Telegram no respondió. Si el bot tiene un webhook configurado, hay que quitarlo (deleteWebhook)." };
  }
  const match = [...res.result].reverse().find((u) => u.message?.text?.trim() === `/start ${settings.pendingCode}`)?.message;
  if (!match) {
    return {
      ok: false,
      error: res.result.length
        ? `@${bot} recibió mensajes, pero no el código de esta cuenta. Tocá "Abrir Telegram" y apretá Iniciar en el chat que se abre.`
        : `Todavía no llegó ningún mensaje a @${bot}. Tocá "Abrir Telegram", apretá Iniciar y volvé a tocar "Ya lo envié".`,
    };
  }
  const name = match.chat.first_name ?? match.chat.username ?? "vos";
  await saveSettings(user, { ...settings, pendingCode: undefined, telegramChatId: String(match.chat.id), telegramName: name });
  await sendTelegram(token, String(match.chat.id), `Listo, ${name}. FindMyTrip te va a avisar acá cuando baje un precio que te interesa.`);
  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// Evaluación (después de cada barrido del radar)
// ---------------------------------------------------------------------------

const money = (n: number) => `USD ${Math.round(n).toLocaleString("es-AR")}`;
const shortDate = (iso?: string) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

type MonthOffer = RadarSnapshot["byMonth"][string][string];
/** Diferencia de noches aceptada entre la oferta y lo que pidió el usuario (como el calendario). */
export const ALERT_NIGHTS_TOLERANCE = 2;

/**
 * La oferta más barata que sirve para un destino seguido: del mes elegido,
 * sin salidas pasadas y con una estadía parecida a la pedida. Las noches
 * son las de las fechas de la oferta (si las tiene), así el total y el
 * mensaje cuentan lo mismo.
 */
export function pickAlertOffer(
  sub: Pick<AlertSub, "month" | "nights">,
  months: Record<string, MonthOffer>,
  today = new Date(),
): { monthKey: string; offer: MonthOffer; nights: number } | null {
  const todayISO = today.toISOString().slice(0, 10);
  let best: { monthKey: string; offer: MonthOffer; nights: number } | null = null;
  for (const [monthKey, offer] of Object.entries(months)) {
    if (sub.month && Number(monthKey.slice(5, 7)) !== sub.month) continue;
    if (offer.dep && offer.dep <= todayISO) continue;
    let nights = sub.nights;
    if (offer.dep && offer.ret) {
      nights = Math.max(1, Math.round((Date.parse(offer.ret) - Date.parse(offer.dep)) / 86400000));
      if (Math.abs(nights - sub.nights) > ALERT_NIGHTS_TOLERANCE) continue;
    }
    if (!best || offer.p < best.offer.p) best = { monthKey, offer, nights };
  }
  return best;
}

export async function evaluateAlerts(
  user: string,
  snap: RadarSnapshot,
  telegram: { token?: string; siteUrl?: string },
): Promise<{ sent: number }> {
  const settings = await getSettings(user);
  if (!telegram.token || !settings.telegramChatId || !snap.live) return { sent: 0 };
  const chatId = settings.telegramChatId;
  const site = telegram.siteUrl?.replace(/\/$/, "") ?? "";
  const messages: string[] = [];

  // 1) Destinos que seguís: aviso cuando el total estimado entra en tu presupuesto.
  const subs = await listSubs(user);
  let changed = false;
  for (const sub of subs) {
    if (sub.origin !== snap.origin) continue;
    const dest = getDestination(sub.destinationId);
    const months = snap.byMonth[sub.destinationId];
    if (!dest || !months) continue;
    const pick = pickAlertOffer(sub, months);
    if (!pick) continue;
    const { monthKey, offer, nights } = pick;
    const total = tripCost(sub.origin, dest, Number(monthKey.slice(5, 7)), nights, sub.party, sub.style, offer.p).total;
    const improved = sub.lastNotifiedUSD == null || total < sub.lastNotifiedUSD * 0.97;
    if (total <= sub.targetUSD && improved) {
      messages.push(
        [
          `${dest.name} entró en tu presupuesto`,
          `Total estimado: ${money(total)} (tu objetivo: ${money(sub.targetUSD)})`,
          `Vuelo: ${money(offer.p)} por persona${offer.dep ? `, ${shortDate(offer.dep)} – ${shortDate(offer.ret)}` : ""}`,
          `${describeParty(sub.party)}, ${nights} noches`,
          site ? `${site}/destino/${dest.id}?month=${monthKey}&nights=${nights}${offer.dep ? `&depart=${offer.dep}` : ""}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      sub.lastNotifiedUSD = total;
      sub.lastNotifiedAt = snap.updatedAt;
      changed = true;
    }
  }
  if (changed) await saveSubs(user, subs);

  // 2) Ofertas del radar (como mucho 3 por barrido, sin repetir el mismo precio).
  if (settings.radarDeals && (settings.origin ?? "BUE") === snap.origin) {
    const sent = (await loadJSON<Record<string, number>>(sentKey(user))) ?? {};
    const todayISO = new Date().toISOString().slice(0, 10);
    const deals = snap.items.filter((i) => (!i.depart || i.depart > todayISO) && i.isDeal && i.discountPct >= settings.minDiscount && !(sent[i.destinationId] <= i.priceUSD * 1.03));
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
    if (deals.length) await saveJSON(sentKey(user), sent);
  }

  let count = 0;
  for (const text of messages) if (await sendTelegram(telegram.token, chatId, text)) count++;
  return { sent: count };
}
