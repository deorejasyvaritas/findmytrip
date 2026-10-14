import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
import { othersLabel, type CTrip } from "../../shared/ctrip.ts";
import { defaultChecklist } from "../../shared/itinerary.ts";
import Icon from "../components/Icon.tsx";
import PackageCard from "../components/PackageCard.tsx";
import Segmented from "../components/Segmented.tsx";
import TripDetail from "../components/TripDetail.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { copyText, shareOrCopy, shareUrl, type ShareOutcome } from "../lib/share.ts";
import { usePriceCheck } from "../lib/price-check.ts";
import { isDomestic, pesoRate } from "../lib/format.ts";

const STATUS: { value: TripPackage["status"]; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "armando", label: "Armando" },
  { value: "reservado", label: "Reservado" },
];

export default function Trips() {
  const { packages: own, sharedTrips, sharedNotice, clearSharedNotice } = useApp();
  // Viajes propios y viajes con otros, juntos. Un viaje propio que pasó a ser
  // compartido se muestra una sola vez (como compartido).
  const sharedPkgIds = new Set(sharedTrips.map((t) => t.pkg.id));
  const entries: { pkg: TripPackage; ctrip: CTrip | null }[] = [
    ...sharedTrips.map((t) => ({ pkg: t.pkg, ctrip: t })),
    ...own.filter((p) => !sharedPkgIds.has(p.id)).map((p) => ({ pkg: p, ctrip: null })),
  ];
  const packages = entries.map((e) => e.pkg);
  // Viajes compartidos por link: id del paquete -> id del link.
  const [shares, setShares] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .myShares()
      .then((r) => setShares(r.shares ?? {}))
      .catch(() => setShares({}));
  }, []);
  const { money, meta, destinations, profile } = useApp();
  // Los viajes por Argentina se muestran en pesos al oficial: para sumarlos con el resto
  // (dólar tarjeta) los pasamos a su equivalente en dólares tarjeta.
  const rates = { card: meta?.usdArsRate ?? 1450, official: meta?.usdArsOfficialRate };
  const domesticFactor = profile.currency === "ARS" ? pesoRate(rates, true) / pesoRate(rates, false) : 1;
  const pending = packages
    .filter((p) => p.status !== "reservado")
    .reduce((s, p) => s + p.totalUSD * (isDomestic(destinations.find((d) => d.id === p.destinationId)?.region) ? domesticFactor : 1), 0);

  const notice = sharedNotice ? (
    <p className="error small" role="alert">
      {sharedNotice}{" "}
      <button type="button" className="link" onClick={clearSharedNotice}>
        Entendido
      </button>
    </p>
  ) : null;

  if (packages.length === 0) {
    return (
      <div className="stack-lg">
        <h1>Mis viajes</h1>
        {notice}
        <div className="card empty">
          <Icon name="bookmark" size={32} />
          <h3>Todavía no guardaste ningún viaje</h3>
          <p className="muted">
            Cuando un destino te guste, armá el paquete y tocá Guardar. Acá vas a tener todo junto: vuelo, alojamiento y gastos.
          </p>
          <Link to="/" className="button primary">
            Explorar destinos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div>
        <h1>Mis viajes</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {packages.length} {packages.length === 1 ? "viaje" : "viajes"} · {money(pending)} en planes sin reservar
        </p>
      </div>
      {notice}
      {STATUS.map(({ value, label }) => {
        const list = entries.filter((e) => e.pkg.status === value);
        if (!list.length) return null;
        return (
          <section key={value}>
            <div className="section-head">
              <h2>{label}</h2>
              <span className="small muted">{list.length}</span>
            </div>
            <div className="grid-cards">
              {list.map(({ pkg: p, ctrip }) => (
                // Misma key antes y después de compartirlo con otros: la tarjeta no se reinicia.
                <TripCard
                  key={p.id}
                  pkg={p}
                  ctrip={ctrip}
                  shareId={shares[p.id] ?? null}
                  onShares={(fn) => setShares((prev) => fn(prev))}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type Notice = { tone: "ok" | "error"; text: string } | null;

const NOTICE: Record<ShareOutcome, Notice> = {
  shared: null,
  cancelled: null,
  copied: { tone: "ok", text: "Link copiado. Pegalo donde quieras: el viaje se ve sin iniciar sesión." },
  failed: null,
};

function TripCard({
  pkg: p,
  ctrip,
  shareId,
  onShares,
}: {
  pkg: TripPackage;
  ctrip: CTrip | null;
  shareId: string | null;
  onShares: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const { updatePackage, removePackage, destinations, me, shareWithOthers, updateSharedTrip, deleteSharedTrip } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"share" | "unshare" | "invite" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // Si no se pudo copiar solo, mostramos el link para copiarlo a mano.
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const detailId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => clearTimeout(timer.current);
  }, []);

  const country = destinations.find((d) => d.id === p.destinationId)?.country;
  const abroad = country ? country !== "Argentina" : true;
  const title = `Viaje a ${p.destinationName}`;
  const text = `Mirá el viaje a ${p.destinationName} que armé en FindMyTrip`;
  const isOwner = !ctrip || ctrip.owner === me;
  const others = ctrip ? othersLabel(ctrip.members, me) : "";
  // Mismos cambios que en un viaje propio; si es compartido, se guarda para todos.
  const update = (patch: Partial<TripPackage>) =>
    ctrip ? updateSharedTrip(ctrip.id, patch, defaultChecklist(abroad)) : updatePackage(p.id, patch);
  // Revisar precios: a mano o, si los precios tienen más de un día, una vez al abrir Mis viajes.
  const check = usePriceCheck(p, update, true);

  const flash = (n: Notice) => {
    setNotice(n);
    clearTimeout(timer.current);
    if (n?.tone === "ok") timer.current = setTimeout(() => setNotice(null), 4000);
  };

  const deliver = async (url: string, opts: { title: string; text: string; copied: Notice } = { title, text, copied: NOTICE.copied }) => {
    const outcome = await shareOrCopy(url, opts.title, opts.text);
    if (outcome === "failed") {
      setManualUrl(url);
      flash({ tone: "ok", text: "Link listo. Copialo desde acá abajo." });
    } else {
      setManualUrl(null);
      flash(outcome === "copied" ? opts.copied : NOTICE[outcome]);
    }
  };

  // Invitar: el viaje pasa a ser compartido (si no lo era) y se crea un link para una persona.
  const invite = async () => {
    setNotice(null);
    setBusy("invite");
    try {
      let trip = ctrip;
      if (!trip) {
        trip = await shareWithOthers(p);
        removePackage(p.id);
      }
      const r = await api.inviteCTrip(trip.id);
      await deliver(shareUrl(r.path), {
        title: `Sumate al viaje a ${p.destinationName}`,
        text: `Te invito a armar juntos el viaje a ${p.destinationName} en FindMyTrip`,
        copied: { tone: "ok", text: "Invitación copiada. Sirve para una persona y vence en 7 días." },
      });
    } catch (err) {
      flash({ tone: "error", text: (err as Error).message || "No pudimos crear la invitación. Probá de nuevo." });
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setNotice(null);
    if (shareId) {
      // Ya estaba compartido: abrimos la hoja enseguida (mientras dura el toque)
      // y actualizamos la copia pública con los datos de ahora.
      api.share(p).catch(() => {});
      await deliver(shareUrl(`/v/${shareId}`));
      return;
    }
    setBusy("share");
    try {
      const r = await api.share(p);
      onShares((prev) => ({ ...prev, [p.id]: r.id }));
      await deliver(shareUrl(r.path));
    } catch (err) {
      flash({ tone: "error", text: (err as Error).message || "No pudimos crear el link. Probá de nuevo." });
    } finally {
      setBusy(null);
    }
  };

  const unshare = async () => {
    if (!shareId) return;
    if (!confirm(`¿Dejar de compartir el viaje a ${p.destinationName}? El link va a dejar de funcionar.`)) return;
    setBusy("unshare");
    try {
      await api.unshare(shareId);
      onShares((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== p.id)));
      setManualUrl(null);
      flash({ tone: "ok", text: "Listo, el link ya no funciona." });
    } catch (err) {
      flash({ tone: "error", text: (err as Error).message || "No pudimos dejar de compartir. Probá de nuevo." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <PackageCard
      pkg={p}
      check={check}
      badge={
        shareId || others ? (
          <span className="pkg-badge">
            {others && (
              <span className="badge badge-tint">
                <Icon name="users" size={14} />
                Compartido con {others}
              </span>
            )}
            {shareId && (
              <span className="badge badge-brand">
                <Icon name="link" size={14} />
                {others ? "Link público" : "Compartido"}
              </span>
            )}
          </span>
        ) : null
      }
      actions={
        <>
          <Segmented
            label={`Estado de ${p.destinationName}`}
            value={p.status}
            onChange={(status) => update({ status })}
            options={STATUS}
          />
          <span className="grow" />
          <Link className="button plain" to={`/destino/${p.destinationId}?month=${p.departDate.slice(0, 7)}`}>
            Ajustar
          </Link>
          {isOwner && (
            <button
              className="icon-btn destructive"
              aria-label={`Borrar el viaje a ${p.destinationName}`}
              onClick={async () => {
                const question = others
                  ? `¿Borrar el viaje a ${p.destinationName} para todos? ${others} también lo van a perder. No se puede deshacer.`
                  : `¿Borrar el viaje a ${p.destinationName}? No se puede deshacer.`;
                if (!confirm(question)) return;
                if (ctrip) {
                  try {
                    await deleteSharedTrip(ctrip.id);
                  } catch (err) {
                    flash({ tone: "error", text: (err as Error).message || "No pudimos borrar el viaje. Probá de nuevo." });
                    return;
                  }
                } else removePackage(p.id);
                // Si estaba compartido por link, el link también deja de funcionar.
                if (shareId) {
                  api.unshare(shareId).catch(() => {});
                  onShares((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== p.id)));
                }
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </>
      }
    >
      <div className="trip-more">
        <div className="trip-more-actions">
          <button type="button" className="secondary" onClick={share} disabled={busy != null} aria-label={`Compartir el viaje a ${p.destinationName}`}>
            <Icon name="share" size={18} />
            {busy === "share" ? "Creando link…" : "Compartir"}
          </button>
          {isOwner && (
            <button type="button" className="secondary" onClick={invite} disabled={busy != null} aria-label={`Invitar a alguien al viaje a ${p.destinationName}`}>
              <Icon name="userPlus" size={18} />
              {busy === "invite" ? "Creando invitación…" : "Invitar a alguien"}
            </button>
          )}
        </div>
        <button
          type="button"
          className="ghost trip-toggle"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Ocultar detalle" : "Ver detalle"}
          <Icon name="chevronDown" size={16} className={open ? "flip" : undefined} />
        </button>
      </div>
      {(notice || shareId || manualUrl) && (
        <div className="share-status small">
          <p role="status" aria-live="polite" className={notice?.tone === "error" ? "error" : notice ? "success" : "muted"}>
            {notice ? (
              <>
                {notice.tone === "ok" && <Icon name="check" size={14} />}
                {notice.text}
              </>
            ) : shareId ? (
              "Cualquiera con el link público puede ver este viaje, sin poder cambiarlo."
            ) : null}
          </p>
          {manualUrl && (
            <div className="share-manual">
              <input readOnly value={manualUrl} aria-label="Link para compartir" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  const r = await copyText(manualUrl);
                  flash(r === "copied" ? NOTICE.copied : { tone: "error", text: "Seleccioná el link y copialo a mano." });
                }}
              >
                Copiar
              </button>
            </div>
          )}
          {shareId && (
            <button type="button" className="link destructive" onClick={unshare} disabled={busy != null}>
              {busy === "unshare" ? "Dejando de compartir…" : "Dejar de compartir"}
            </button>
          )}
        </div>
      )}
      {open && (
        <div id={detailId}>
          {ctrip && <TripMembers trip={ctrip} />}
          <TripDetail pkg={p} abroad={abroad} onChecklist={(checklist) => update({ checklist })} />
        </div>
      )}
    </PackageCard>
  );
}

/** Quiénes viajan: cada uno puede irse; quien armó el viaje puede sacar a otros. */
function TripMembers({ trip }: { trip: CTrip }) {
  const { me, removeSharedMember } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const isOwner = trip.owner === me;
  const place = trip.pkg.destinationName;

  const remove = async (user: string) => {
    const leaving = user === me;
    const question = leaving
      ? `¿Dejar el viaje a ${place}? Ya no lo vas a ver en Mis viajes. Para volver, te tienen que invitar de nuevo.`
      : `¿Quitar a ${user} del viaje a ${place}? Ya no lo va a poder ver ni editar.`;
    if (!confirm(question)) return;
    setBusy(user);
    setError(null);
    try {
      await removeSharedMember(trip.id, user);
    } catch (err) {
      setError((err as Error).message || "No pudimos hacer el cambio. Probá de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby={titleId} className="stack-sm trip-members">
      <div className="detail-head">
        <h4 id={titleId}>Viajan</h4>
        <span className="small muted">
          {trip.members.length} {trip.members.length === 1 ? "persona" : "personas"}
        </span>
      </div>
      <ul className="member-list">
        {trip.members.map((m) => (
          <li key={m}>
            <span className="member-avatar" aria-hidden="true">
              {m.slice(0, 1).toUpperCase()}
            </span>
            <span className="grow member-name">
              <span>{m === me ? `${m} (vos)` : m}</span>
              {m === trip.owner && <span className="small muted">Armó el viaje</span>}
            </span>
            {m !== trip.owner && (m === me || isOwner) && (
              <button type="button" className="link destructive" onClick={() => remove(m)} disabled={busy != null}>
                {m === me ? (busy === m ? "Saliendo…" : "Dejar el viaje") : busy === m ? "Quitando…" : "Quitar"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="small muted">
        {trip.members.length > 1
          ? "Todos pueden cambiar el estado y la lista de tareas. Los cambios de los demás aparecen al volver a la app."
          : "Todavía no se sumó nadie. Tocá Invitar a alguien y mandale el link."}
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
