import { Link } from "react-router-dom";
import type { Suggestion } from "../../shared/types.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, monthName } from "../lib/format.ts";

const FIT_LABEL = { dentro: "Entra holgado", ajustado: "Entra justo", estirando: "Estirando un poco" };

export default function SuggestionCard({ s, nights }: { s: Suggestion; nights: number }) {
  const { money } = useApp();
  const d = s.destination;
  const q = new URLSearchParams({ month: `${s.year}-${String(s.month).padStart(2, "0")}`, nights: String(nights) });
  return (
    <Link to={`/destino/${d.id}?${q}`} className="card suggestion">
      <div className="suggestion-head">
        <div>
          <h3>{d.name}</h3>
          <p className="muted small">
            {d.country} · {capitalize(monthName(s.month))} {s.year}
          </p>
        </div>
        <span className={`fit fit-${s.fit}`}>{FIT_LABEL[s.fit]}</span>
      </div>
      <p className="blurb">{d.blurb}</p>
      <div className="price-row">
        <div>
          <div className="price">{money(s.cost.total)}</div>
          <div className="muted small">total · {money(s.cost.perPerson)} p/p</div>
        </div>
        <div className="breakdown small muted">
          <span>✈ {money(s.cost.flights)}</span>
          <span>🛏 {money(s.cost.lodging)}</span>
          <span>🍽 {money(s.cost.daily)}</span>
        </div>
      </div>
      {s.reasons.length > 0 && (
        <ul className="reasons small">
          {s.reasons.slice(0, 3).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="card-foot small muted">
        <span>{d.docs}</span>
        <span>{s.flightSource === "en vivo" ? "● vuelo en vivo" : "vuelo estimado"}</span>
      </div>
    </Link>
  );
}
