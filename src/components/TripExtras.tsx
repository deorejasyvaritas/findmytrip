import { useEffect, useState } from "react";
import type { Extra } from "../../shared/extras.ts";
import { api } from "../lib/api.ts";
import type { IconName } from "../lib/icons.ts";
import Icon from "./Icon.tsx";

const ICON: Record<Extra["kind"], IconName> = {
  traslado: "plane",
  auto: "car",
  esim: "globe",
  excursiones: "star",
  entradas: "ticket",
  seguro: "shield",
};

/** Extras opcionales: no se suman al total, se reservan aparte. */
export default function TripExtras({ destId }: { destId: string }) {
  const [extras, setExtras] = useState<Extra[]>([]);

  useEffect(() => {
    api
      .extras(destId)
      .then((r) => setExtras(r.extras))
      .catch(() => setExtras([]));
  }, [destId]);

  if (!extras.length) return null;
  return (
    <section aria-labelledby="extras-title">
      <div className="section-head">
        <h2 id="extras-title">Completá el viaje</h2>
        <span className="small muted">Opcional, se reserva aparte</span>
      </div>
      <div className="extras-grid">
        {extras.map((x) => (
          <a key={x.kind} className="card extra" href={x.url} target="_blank" rel="noreferrer sponsored">
            <span className="extra-icon">
              <Icon name={ICON[x.kind]} size={20} />
            </span>
            <span className="stack-sm grow" style={{ gap: 2 }}>
              <strong>{x.title}</strong>
              <span className="small muted">{x.description}</span>
              <span className="small extra-provider">
                Ver en {x.provider} <Icon name="external" size={14} />
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
