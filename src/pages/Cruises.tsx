import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CRUISES,
  CRUISE_ZONES,
  cruiseFlightSearch,
  cruiseNightsLabel,
  leavesFromArgentina,
  type CruiseItinerary,
  type CruiseZone,
} from "../../shared/cruises.ts";
import { bestMonthsLabel } from "../../shared/routes.ts";
import Icon from "../components/Icon.tsx";
import { useApp } from "../lib/app-context.tsx";

type Filter = CruiseZone | "argentina";

export default function CruisesPage() {
  const { profile, meta } = useApp();
  const [filter, setFilter] = useState<Filter | null>(null);
  const origin = { code: profile.origin, name: meta?.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin };
  const list = useMemo(
    () => CRUISES.filter((c) => !filter || (filter === "argentina" ? leavesFromArgentina(c) : c.zone === filter)),
    [filter],
  );

  return (
    <div className="stack-lg routes-page">
      <section className="stack">
        <Link to="/" className="back">
          <Icon name="chevronLeft" size={22} />
          Explorar
        </Link>
        <h1>Cruceros</h1>
        <p className="muted subhead">
          Itinerarios típicos para salir desde Buenos Aires o volando al puerto. Las fechas y los precios están en el buscador de cruceros o en el
          sitio de la naviera: acá no inventamos precios.
        </p>
      </section>

      <div className="chips" role="group" aria-label="Zona">
        {(["argentina", ...CRUISE_ZONES] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${filter === f ? " on" : ""}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(filter === f ? null : f)}
          >
            {f === "argentina" ? "Sin vuelo al puerto" : f}
          </button>
        ))}
      </div>

      <section className="routes-grid" aria-label="Cruceros">
        {list.map((c) => (
          <CruiseCard key={c.id} cruise={c} flightUrl={cruiseFlightSearch(c, origin)} />
        ))}
      </section>

      <p className="small muted">
        Las navieras que figuran son las que suelen operar cada ruta; cambian de una temporada a otra. Precios en el sitio de la naviera o del
        buscador, con fecha y camarote elegidos. Revisá siempre qué documentos te piden para cada escala.
      </p>
    </div>
  );
}

function CruiseCard({ cruise: c, flightUrl }: { cruise: CruiseItinerary; flightUrl: string | null }) {
  const titleId = `cruise-${c.id}`;
  return (
    <article className="card route-card cruise-card" aria-labelledby={titleId}>
      <div className="route-body">
        <div className="stack-sm">
          <p className="small muted">{c.zone}</p>
          <h3 id={titleId}>{c.name}</h3>
          <p className="small muted route-meta">
            {cruiseNightsLabel(c)} · Sale de {c.departure}
          </p>
        </div>
        <ol className="route-line" aria-label="Escalas típicas">
          {c.ports.map((p, i) => (
            <li key={`${p}-${i}`}>
              {i > 0 && <Icon name="chevronRight" size={14} />}
              <span>{p}</span>
            </li>
          ))}
        </ol>
        <p className="small">{c.summary}</p>
        <p className="small muted route-season">
          <Icon name="sun" size={14} />
          Temporada: {bestMonthsLabel(c.months)}
        </p>
        <p className="small muted">Suele operar: {c.lines.join(", ")}</p>
        {c.note && (
          <p className="small cruise-note">
            <Icon name="info" size={14} />
            <span>{c.note}</span>
          </p>
        )}
        <div className="route-price">
          <span className="small muted">Precios en el sitio de la naviera o del buscador.</span>
        </div>
        <div className="cruise-actions">
          <a className="button primary" href={c.search.url} target="_blank" rel="noreferrer">
            Ver salidas y precios
            <Icon name="external" size={16} />
          </a>
          {c.official && (
            <a className="button secondary" href={c.official.url} target="_blank" rel="noreferrer">
              {c.official.label}
              <Icon name="external" size={16} />
            </a>
          )}
          {flightUrl && c.flight && (
            <Link className="button secondary" to={flightUrl}>
              <Icon name="plane" size={16} />
              {c.flight.direction === "vuelta" ? `Vuelo de vuelta desde ${c.flight.name}` : `Combinar con vuelo a ${c.flight.name}`}
            </Link>
          )}
        </div>
        {flightUrl && <p className="small muted">El vuelo se abre con fechas de ejemplo de la temporada: cambialas por las de tu salida.</p>}
      </div>
    </article>
  );
}
