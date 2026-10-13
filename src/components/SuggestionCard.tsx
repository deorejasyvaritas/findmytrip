import { Link } from "react-router-dom";
import type { PriceSource, Suggestion } from "../../shared/types.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatRange, monthName } from "../lib/format.ts";
import Icon from "./Icon.tsx";

const FIT = {
  dentro: { label: "Entra holgado", cls: "badge-ok" },
  ajustado: { label: "Entra justo", cls: "badge-tint" },
  estirando: { label: "Un poco más", cls: "badge-warn" },
};
export const SOURCE_LABEL: Record<PriceSource, string> = {
  google: "Precio real de hoy",
  aviasales: "Visto en los últimos días",
  estimado: "Precio estimado",
};

export default function SuggestionCard({ s, nights }: { s: Suggestion; nights: number }) {
  const { money } = useApp();
  const d = s.destination;
  const q = new URLSearchParams({ month: `${s.year}-${String(s.month).padStart(2, "0")}`, nights: String(nights) });
  if (s.depart) q.set("depart", s.depart);
  const when = s.depart && s.ret ? formatRange(s.depart, s.ret) : `${capitalize(monthName(s.month))} ${s.year}`;
  return (
    <Link to={`/destino/${d.id}?${q}`} className="card suggestion">
      <div className="suggestion-head">
        <div>
          <h3>{d.name}</h3>
          <p className="small muted">
            {d.country} · {when}
          </p>
        </div>
        <span className={`badge ${FIT[s.fit].cls}`}>{FIT[s.fit].label}</span>
      </div>
      <p className="blurb">{d.blurb}</p>
      <div className="price-row">
        <div>
          <div className="price">{money(s.cost.total)}</div>
          <div className="small muted">Total · {money(s.cost.perPerson)} por persona</div>
        </div>
        <div className="breakdown">
          <span className={s.flightSource !== "estimado" ? "real" : ""}>
            <Icon name="plane" size={14} /> {money(s.cost.flights)}
          </span>
          <span className={s.lodgingSource !== "estimado" ? "real" : ""}>
            <Icon name="bed" size={14} /> {money(s.cost.lodging)}
          </span>
          <span>
            <Icon name="utensils" size={14} /> {money(s.cost.daily)}
          </span>
        </div>
      </div>
      {s.reasons.length > 0 && (
        <ul className="reasons">
          {s.reasons.slice(0, 3).map((r) => (
            <li key={r}>
              <Icon name="check" size={14} />
              {r}
            </li>
          ))}
        </ul>
      )}
      <div className="card-foot">
        <span className={`source ${s.flightSource !== "estimado" ? "live" : ""}`}>
          {SOURCE_LABEL[s.flightSource]}
          {s.airline ? ` · ${s.airline}` : ""}
        </span>
        <span>{d.docs}</span>
      </div>
    </Link>
  );
}

/** Tarjeta vacía con la forma de una sugerencia, mientras se busca. */
export function SuggestionSkeleton() {
  return (
    <div className="card skeleton" aria-hidden="true">
      <div className="sk" style={{ width: "55%", height: 20 }} />
      <div className="sk" style={{ width: "35%", height: 12 }} />
      <div className="sk" style={{ width: "100%", height: 12 }} />
      <div className="sk" style={{ width: "80%", height: 12 }} />
      <div className="sk" style={{ width: "40%", height: 28, marginTop: 8 }} />
    </div>
  );
}
