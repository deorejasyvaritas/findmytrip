import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
import Icon from "../components/Icon.tsx";
import PackageCard from "../components/PackageCard.tsx";
import Segmented from "../components/Segmented.tsx";
import TripDetail from "../components/TripDetail.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { copyText, shareOrCopy, shareUrl, type ShareOutcome } from "../lib/share.ts";

const STATUS: { value: TripPackage["status"]; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "armando", label: "Armando" },
  { value: "reservado", label: "Reservado" },
];

export default function Trips() {
  const { packages } = useApp();
  // Viajes compartidos por link: id del paquete -> id del link.
  const [shares, setShares] = useState<Record<string, string>>({});
  useEffect(() => {
    api
      .myShares()
      .then((r) => setShares(r.shares ?? {}))
      .catch(() => setShares({}));
  }, []);
  const { money } = useApp();
  const pending = packages.filter((p) => p.status !== "reservado").reduce((s, p) => s + p.totalUSD, 0);

  if (packages.length === 0) {
    return (
      <div className="stack-lg">
        <h1>Mis viajes</h1>
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
      {STATUS.map(({ value, label }) => {
        const list = packages.filter((p) => p.status === value);
        if (!list.length) return null;
        return (
          <section key={value}>
            <div className="section-head">
              <h2>{label}</h2>
              <span className="small muted">{list.length}</span>
            </div>
            <div className="grid-cards">
              {list.map((p) => (
                <TripCard
                  key={p.id}
                  pkg={p}
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
  shareId,
  onShares,
}: {
  pkg: TripPackage;
  shareId: string | null;
  onShares: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const { updatePackage, removePackage, destinations } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"share" | "unshare" | null>(null);
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

  const flash = (n: Notice) => {
    setNotice(n);
    clearTimeout(timer.current);
    if (n?.tone === "ok") timer.current = setTimeout(() => setNotice(null), 4000);
  };

  const deliver = async (url: string) => {
    const outcome = await shareOrCopy(url, title, text);
    if (outcome === "failed") {
      setManualUrl(url);
      flash({ tone: "ok", text: "Link listo. Copialo desde acá abajo." });
    } else {
      setManualUrl(null);
      flash(NOTICE[outcome]);
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
      badge={
        shareId ? (
          <span className="pkg-badge">
            <span className="badge badge-brand">
              <Icon name="link" size={14} />
              Compartido
            </span>
          </span>
        ) : null
      }
      actions={
        <>
          <Segmented
            label={`Estado de ${p.destinationName}`}
            value={p.status}
            onChange={(status) => updatePackage(p.id, { status })}
            options={STATUS}
          />
          <span className="grow" />
          <Link className="button plain" to={`/destino/${p.destinationId}?month=${p.departDate.slice(0, 7)}`}>
            Ajustar
          </Link>
          <button
            className="icon-btn destructive"
            aria-label={`Borrar el viaje a ${p.destinationName}`}
            onClick={() => {
              if (!confirm(`¿Borrar el viaje a ${p.destinationName}? No se puede deshacer.`)) return;
              // Si estaba compartido, el link también deja de funcionar.
              if (shareId) {
                api.unshare(shareId).catch(() => {});
                onShares((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== p.id)));
              }
              removePackage(p.id);
            }}
          >
            <Icon name="trash" size={18} />
          </button>
        </>
      }
    >
      <div className="trip-more">
        <button type="button" className="secondary" onClick={share} disabled={busy != null} aria-label={`Compartir el viaje a ${p.destinationName}`}>
          <Icon name="share" size={18} />
          {busy === "share" ? "Creando link…" : "Compartir"}
        </button>
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
              "Cualquiera con el link puede ver este viaje, sin poder cambiarlo."
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
          <TripDetail pkg={p} abroad={abroad} onChecklist={(checklist) => updatePackage(p.id, { checklist })} />
        </div>
      )}
    </PackageCard>
  );
}
