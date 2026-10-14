import { useState } from "react";
import { Link } from "react-router-dom";
import type { LongWeekendInfo, Party, PriceSource, Style, Suggestion } from "../../shared/types.ts";
import { partyToParams } from "../../shared/pricing.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate, formatRange, isDomestic, monthName } from "../lib/format.ts";
import { CompareToggle } from "./Compare.tsx";
import Icon from "./Icon.tsx";
import WatchButton from "./WatchButton.tsx";

const FIT = {
  dentro: { label: "Entra holgado", cls: "badge-ok" },
  ajustado: { label: "Entra justo", cls: "badge-tint" },
  estirando: { label: "Un poco más", cls: "badge-warn" },
};
export const SOURCE_LABEL: Record<PriceSource, string> = {
  google: "Google Flights, últimas 24 h",
  aviasales: "Visto en los últimos días",
  estimado: "Precio estimado",
};

export default function SuggestionCard({
  s,
  nights,
  party,
  range,
  style,
}: {
  s: Suggestion;
  nights: number;
  party?: Party;
  /** Ventana de salida de la búsqueda: la ficha arranca en un día dentro de ella. */
  range?: { from: string; to: string };
  /** Alojamiento de la búsqueda (para la alerta). */
  style?: Style;
}) {
  const app = useApp();
  const { photos } = app;
  const d = s.destination;
  // Dentro de Argentina se paga en pesos al oficial; afuera, con dólar tarjeta.
  const domestic = isDomestic(d.region);
  const money = (usd: number) => app.money(usd, { domestic });
  const hint = app.moneyHint(domestic);
  // Fin de semana largo: las noches son las de esa opción.
  const optNights = s.nights ?? nights;
  const q = new URLSearchParams({
    month: `${s.year}-${String(s.month).padStart(2, "0")}`,
    nights: String(optNights),
    ...(party ? partyToParams(party) : {}),
  });
  if (s.depart) q.set("depart", s.depart);
  // La ficha abre con el mismo régimen (ej. all inclusive).
  if (s.cost.mealPlan) q.set("meal", s.cost.mealPlan);
  if (range) {
    q.set("from", range.from);
    q.set("to", range.to);
  }
  const when = s.depart && s.ret ? formatRange(s.depart, s.ret) : `${capitalize(monthName(s.month))} ${s.year}`;
  // Lo que se compara con la alerta: vuelo, equipaje y alojamiento (sin comidas ni paseos).
  const target = s.cost.total - (s.cost.dailyIncluded ? s.cost.daily : 0);
  // Toda la tarjeta lleva a la ficha (el link se estira por CSS); los botones de abajo quedan por encima.
  return (
    <article className="card suggestion">
      <Photo src={photos[d.id]} name={d.name} />
      <div className="suggestion-head">
        <div>
          <h3>
            <Link to={`/destino/${d.id}?${q}`} className="suggestion-link">
              {d.name}
            </Link>
          </h3>
          <p className="small muted">
            {d.country} · {when}
          </p>
          {s.longWeekend && (
            <p className="long-weekend-tag small">
              <Icon name="calendar" size={14} />
              {describeLongWeekend(s.longWeekend)}
            </p>
          )}
        </div>
        <span className={`badge ${FIT[s.fit].cls}`}>{FIT[s.fit].label}</span>
      </div>
      <p className="blurb">{d.blurb}</p>
      <div className="price-row">
        <div>
          <div className="price">{money(s.cost.total)}</div>
          <div className="small muted">
            {s.cost.dailyIncluded ? "Total" : s.cost.mealPlan === "all" ? "Vuelo y all inclusive" : "Vuelo y alojamiento"} · {money(s.cost.perPerson)} por persona
          </div>
          {s.cost.mealPlan && (
            <div className="small muted">
              {s.cost.mealPlan === "all"
                ? "Estimado all inclusive: comidas y bebidas incluidas"
                : s.cost.mealPlan === "breakfast"
                  ? "Alojamiento con desayuno (estimado)"
                  : "Alojamiento con media pensión (estimado)"}
            </div>
          )}
          {hint && <div className="small muted">{hint}</div>}
        </div>
        <div className="breakdown">
          <span className={s.flightSource !== "estimado" ? "real" : ""}>
            <Icon name="plane" size={14} /> {money(s.cost.flights)}
          </span>
          <span className={s.lodgingSource !== "estimado" ? "real" : ""} title={s.cost.mealPlan === "all" ? "Estimado all inclusive" : undefined}>
            <Icon name="bed" size={14} /> {money(s.cost.lodging)}
          </span>
          {s.cost.bags > 0 && (
            <span>
              <Icon name="luggage" size={14} /> {money(s.cost.bags)}
            </span>
          )}
          <span
            title={
              s.cost.mealPlan === "all"
                ? "Traslados y paseos aparte (estimado): las comidas van en el all inclusive"
                : s.cost.dailyIncluded
                  ? "Comidas y paseos (estimado)"
                  : "Comidas y paseos aparte (estimado)"
            }
          >
            <Icon name="utensils" size={14} /> {s.cost.dailyIncluded ? "" : "+"}
            {money(s.cost.daily)}
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
          {s.flightSource === "aviasales" && !s.depart ? "Mínimo del mes, visto en los últimos días" : SOURCE_LABEL[s.flightSource]}
          {s.airline ? ` · ${s.airline}` : ""}
          {s.direct ? " · directo" : ""}
        </span>
        <span>{d.docs}</span>
      </div>
      <div className="card-actions">
        <CompareToggle id={d.id} name={d.name} />
        <WatchButton
          destinationId={d.id}
          name={d.name}
          targetUSD={target}
          month={s.month}
          nights={optNights}
          party={party}
          style={style}
        />
      </div>
    </article>
  );
}

/** "Fin de semana largo de Carnaval, 6 al 9 feb" */
export function describeLongWeekend(w: LongWeekendInfo): string {
  const sameMonth = w.from.slice(0, 7) === w.to.slice(0, 7);
  const from = sameMonth ? String(Number(w.from.slice(8, 10))) : formatDate(w.from);
  return `Fin de semana largo de ${w.reason}, ${from} al ${formatDate(w.to)}`;
}

/** Foto ilustrativa arriba de la tarjeta; si no hay, un fondo de marca. */
export function Photo({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="photo" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{name}</span>
      )}
    </div>
  );
}

/** Tarjeta vacía con la forma de una sugerencia, mientras se busca. */
export function SuggestionSkeleton() {
  return (
    <div className="card skeleton" aria-hidden="true">
      <div className="sk photo" />
      <div className="sk" style={{ width: "55%", height: 20 }} />
      <div className="sk" style={{ width: "35%", height: 12 }} />
      <div className="sk" style={{ width: "100%", height: 12 }} />
      <div className="sk" style={{ width: "80%", height: 12 }} />
      <div className="sk" style={{ width: "40%", height: 28, marginTop: 8 }} />
    </div>
  );
}
