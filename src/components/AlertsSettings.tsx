import { useEffect, useState } from "react";
import type { AlertSettings, AlertSub } from "../../shared/types.ts";
import { describeParty } from "../../shared/pricing.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, monthName } from "../lib/format.ts";
import Icon from "./Icon.tsx";

/** Alertas por Telegram: conexión del bot, ofertas del radar y destinos seguidos. */
export default function AlertsSettings() {
  const { destinations, money, removeWatch, watchlist, profile } = useApp();
  const [data, setData] = useState<{ subs: AlertSub[]; settings: AlertSettings; telegram: boolean } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkOpened, setLinkOpened] = useState(false);

  useEffect(() => {
    api.alerts().then(setData).catch(() => setData(null));
  }, []);

  // Desde "Avisarme si baja" se llega con #alertas: bajamos hasta acá cuando ya cargó.
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded || window.location.hash !== "#alertas") return;
    requestAnimationFrame(() => {
      document.getElementById("alertas")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loaded]);

  if (!data) return null;
  const { settings } = data;
  const connected = Boolean(settings.telegramChatId);

  // Paso 1: abre el bot con un código único; paso 2: confirmamos que llegó.
  async function openTelegram() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.telegramLink();
      if (res.ok && res.url) {
        setLinkOpened(true);
        window.open(res.url, "_blank", "noopener");
        setStatus({ ok: true, text: `Se abrió @${res.bot}. Apretá "Iniciar" (o "Start") en ese chat y volvé acá.` });
      } else setStatus({ ok: false, text: res.error ?? "No se pudo generar el link." });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.telegramConnect();
      setStatus({ ok: res.ok, text: res.ok ? `Conectado. Te mandé un mensaje de bienvenida, ${res.name}.` : (res.error ?? "No se pudo conectar.") });
      if (res.ok) setLinkOpened(false);
      setData(await api.alerts());
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await api.telegramTest();
      setStatus({ ok: res.ok, text: res.ok ? "Listo, revisá Telegram." : (res.error ?? "No se pudo enviar.") });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function update(patch: Partial<Pick<AlertSettings, "radarDeals" | "minDiscount">>) {
    const next = { radarDeals: settings.radarDeals, minDiscount: settings.minDiscount, origin: profile.origin, ...patch };
    setData({ ...data!, settings: { ...settings, ...next } });
    await api.alertSettings(next).catch(() => {});
  }

  async function remove(sub: AlertSub) {
    const local = watchlist.find((w) => w.destinationId === sub.destinationId);
    if (local) removeWatch(local.id);
    else await api.deleteAlert(sub.id).catch(() => {});
    setData({ ...data!, subs: data!.subs.filter((s) => s.id !== sub.id) });
  }

  return (
    <section id="alertas" className="alerts-anchor">
      <p className="grouped-title">Alertas</p>
      <div className="grouped">
        <div className="list-row list-row-block">
          <div className="row gap">
            <span className="alert-icon">
              <Icon name="bell" size={18} />
            </span>
            <div className="grow">
              <div className="headline">Telegram</div>
              <div className="small muted">
                {connected
                  ? `Conectado${settings.telegramName ? ` con ${settings.telegramName}` : ""}. Te avisamos ahí cuando baja un precio.`
                  : data.telegram
                    ? "Tocá Abrir Telegram, apretá Iniciar en el chat del bot y después Ya lo envié."
                    : "Falta crear tu bot (gratis, 2 minutos). Seguí los pasos de abajo."}
              </div>
            </div>
            {data.telegram && connected && (
              <button type="button" className="plain" onClick={test} disabled={busy}>
                {busy ? "Un momento…" : "Enviar prueba"}
              </button>
            )}
            {data.telegram && !connected && (
              <div className="row gap-sm wrap">
                <button type="button" className={linkOpened ? "secondary" : "primary"} onClick={openTelegram} disabled={busy}>
                  Abrir Telegram
                </button>
                {linkOpened && (
                  <button type="button" className="primary" onClick={connect} disabled={busy}>
                    {busy ? "Un momento…" : "Ya lo envié"}
                  </button>
                )}
              </div>
            )}
          </div>
          {!data.telegram && (
            <ol className="steps small">
              <li>
                En Telegram, buscá <strong>@BotFather</strong>, mandale <code>/newbot</code> y elegí un nombre. Te da un token.
              </li>
              <li>
                En CMD, dentro de la carpeta del proyecto: <code>echo TU_TOKEN| npx wrangler secret put TELEGRAM_BOT_TOKEN</code>
              </li>
              <li>Recargá esta página y tocá Abrir Telegram.</li>
            </ol>
          )}
          {status && (
            <p className={`small ${status.ok ? "success" : "error"}`} role="status">
              {status.text}
            </p>
          )}
        </div>
        <label className="list-row">
          <span className="grow">
            Avisarme de ofertas del radar
            <span className="small muted" style={{ display: "block" }}>
              Desde tu ciudad, como mucho 3 avisos por barrido
            </span>
          </span>
          <input type="checkbox" className="switch" checked={settings.radarDeals} onChange={(e) => update({ radarDeals: e.target.checked })} />
        </label>
        {settings.radarDeals && (
          <label className="list-row">
            <span className="grow">Descuento mínimo</span>
            <select value={settings.minDiscount} onChange={(e) => update({ minDiscount: Number(e.target.value) })}>
              {[15, 20, 25, 30, 40, 50].map((d) => (
                <option key={d} value={d}>
                  {d} % o más
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {data.subs.length > 0 && (
        <>
          <p className="grouped-title" style={{ marginTop: 24 }}>
            Destinos que seguís
          </p>
          <div className="grouped">
            {data.subs.map((s) => {
              const d = destinations.find((x) => x.id === s.destinationId);
              return (
                <div key={s.id} className="list-row">
                  <div className="grow">
                    <div className="headline">{d?.name ?? s.destinationId}</div>
                    <div className="small muted">
                      Avisar si el total baja de {money(s.targetUSD)} · {s.nights} noches ·{" "}
                      {s.month ? capitalize(monthName(s.month)) : "cualquier mes"} · {describeParty(s.party)}
                      {s.lastNotifiedUSD ? ` · último aviso ${money(s.lastNotifiedUSD)}` : ""}
                    </div>
                  </div>
                  <button type="button" className="icon-btn" aria-label={`Dejar de seguir ${d?.name ?? ""}`} onClick={() => remove(s)}>
                    <Icon name="trash" size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="grouped-note">Para seguir un destino, abrilo y tocá "Avisarme si baja".</p>
    </section>
  );
}
