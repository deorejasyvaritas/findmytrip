import { useId, useState, type ReactNode } from "react";
import {
  CANCILLERIA_URL,
  MINORS_NOTE,
  MINORS_URL,
  VERIFY_NOTE,
  VISA_LABEL,
  entryRequirements,
  entrySummary,
  type EntryRequirements as Req,
} from "../../shared/entry-requirements.ts";
import { formatDate } from "../lib/format.ts";
import type { IconName } from "../lib/icons.ts";
import Icon from "./Icon.tsx";

// Requisitos de entrada para viajeros argentinos: tarjeta en la ficha del
// destino y una línea (con detalle desplegable) en las paradas del viaje.

const VISA_BADGE: Record<Req["visa"], string> = { no: "badge-ok", si: "badge-warn", autorizacion: "badge-tint" };

function Row({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <li>
      <Icon name={icon} size={20} />
      <span className="entry-text">
        <strong>{title}</strong>
        <span className="small muted">{children}</span>
      </span>
    </li>
  );
}

function Source({ r }: { r: Req | null }) {
  return (
    <p className="small muted entry-source">
      <Icon name="info" size={14} />
      <span>
        {VERIFY_NOTE}{" "}
        <a href={r?.source.url ?? CANCILLERIA_URL} target="_blank" rel="noreferrer">
          {r?.source.label ?? "Cancillería argentina"}
        </a>
        {r && <> · Revisado el {formatDate(r.lastReviewed, { day: "numeric", month: "long", year: "numeric" })}</>}
      </span>
    </p>
  );
}

/** Lista de requisitos (sin el marco de tarjeta). */
export function EntryDetails({ country }: { country: string }) {
  const r = entryRequirements(country);
  if (!r)
    return (
      <div className="entry">
        <p className="small">
          Todavía no tenemos los requisitos de {country || "este país"} revisados. Fuera del Mercosur, en general vas a necesitar pasaporte; consultá
          la visa en el consulado del país.
        </p>
        <Source r={null} />
      </div>
    );
  return (
    <div className="entry">
      <ul className="entry-list">
        <Row icon="idCard" title={r.document === "dni" ? "DNI o pasaporte" : "Pasaporte"}>
          {r.documentNote}
        </Row>
        {!r.domestic && (
          <Row icon="stamp" title={VISA_LABEL[r.visa]}>
            {r.visaNote}
          </Row>
        )}
        {!r.domestic && (
          <Row icon="clock" title="Estadía máxima">
            {r.stay}
          </Row>
        )}
        {r.forms?.map((f) => (
          <Row key={f} icon="clipboard" title="Antes de viajar">
            {f}
          </Row>
        ))}
        {r.vaccines && (
          <Row icon="syringe" title={r.vaccineRequired ? "Vacuna obligatoria" : "Vacunas recomendadas"}>
            {r.vaccines}
          </Row>
        )}
        {r.insurance && (
          <Row icon="shield" title="Seguro médico">
            {r.insurance}
          </Row>
        )}
        {!r.domestic && (
          <Row icon="users" title="Menores de edad">
            {MINORS_NOTE.replace(/^Menores de 18: /, "")}{" "}
            <a href={MINORS_URL} target="_blank" rel="noreferrer">
              Cómo tramitarla
            </a>
          </Row>
        )}
      </ul>
      <Source r={r} />
    </div>
  );
}

/** Tarjeta "Para entrar" de la ficha del destino. */
export function EntryCard({ country }: { country: string }) {
  const r = entryRequirements(country);
  const titleId = useId();
  return (
    <section className="card entry-card" aria-labelledby={titleId}>
      <div className="section-head">
        <h2 id={titleId}>Para entrar</h2>
        {r && !r.domestic && <span className={`badge ${VISA_BADGE[r.visa]}`}>{VISA_LABEL[r.visa]}</span>}
      </div>
      <EntryDetails country={country} />
    </section>
  );
}

/** Una línea para las paradas del viaje, con el detalle a un toque. */
export function EntryLine({ country }: { country: string }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const r = entryRequirements(country);
  return (
    <div className="entry-line">
      <p className="small info-line">
        <Icon name="idCard" size={16} />
        <span className="grow">
          <strong>Para entrar:</strong> <span className="muted">{r ? entrySummary(r) : "requisitos sin revisar, consultá en Cancillería"}</span>
        </span>
        <button type="button" className="link small" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((v) => !v)}>
          {open ? "Ocultar" : "Ver detalle"}
        </button>
      </p>
      {open && (
        <div id={detailsId} className="entry-pop">
          <EntryDetails country={country} />
        </div>
      )}
    </div>
  );
}
