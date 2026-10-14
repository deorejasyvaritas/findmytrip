import { useId, useState, type FormEvent } from "react";
import type { ChecklistItem, TripPackage } from "../../shared/types.ts";
import { checklistProgress, dayPlan, defaultChecklist } from "../../shared/itinerary.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate } from "../lib/format.ts";
import Icon from "./Icon.tsx";

// Detalle de un viaje guardado: presupuesto día por día y checklist antes de viajar.

const VISIBLE_DAYS = 10;
const KIND_LABEL = { ida: "Salida", destino: "En destino", vuelta: "Vuelta", "ida-vuelta": "En el día" } as const;

export default function TripDetail({
  pkg,
  abroad,
  onChecklist,
}: {
  pkg: TripPackage;
  abroad: boolean;
  onChecklist: (list: ChecklistItem[]) => void;
}) {
  return (
    <div className="trip-detail">
      <DayByDay pkg={pkg} domestic={!abroad} />
      <Checklist list={pkg.checklist ?? defaultChecklist(abroad)} onChange={onChecklist} />
    </div>
  );
}

function DayByDay({ pkg, domestic }: { pkg: TripPackage; domestic: boolean }) {
  const app = useApp();
  // Mismo cambio que la tarjeta del viaje: dentro de Argentina, pesos al oficial.
  const money = (usd: number) => app.money(usd, { domestic });
  const [all, setAll] = useState(false);
  const titleId = useId();
  const plan = dayPlan(pkg);

  if (!plan) {
    return (
      <section aria-labelledby={titleId} className="stack-sm">
        <h4 id={titleId}>Día por día</h4>
        <p className="small muted">Este viaje no tiene fechas válidas. Tocá Ajustar para elegirlas de nuevo.</p>
      </section>
    );
  }

  const days = all ? plan.days : plan.days.slice(0, VISIBLE_DAYS);
  return (
    <section aria-labelledby={titleId} className="stack">
      <div className="detail-head">
        <h4 id={titleId}>Día por día</h4>
        <span className="small muted">
          {plan.days.length} {plan.days.length === 1 ? "día" : "días"} · {plan.nights} {plan.nights === 1 ? "noche" : "noches"}
        </span>
      </div>
      <ul className="detail-facts small">
        {plan.nights > 0 && plan.lodgingPerNightUSD > 0 && (
          <li>
            <Icon name="bed" size={16} />
            <span>Alojamiento: {money(plan.lodgingPerNightUSD)} por noche</span>
          </li>
        )}
        <li>
          <Icon name="utensils" size={16} />
          {plan.spendPerDayUSD != null ? (
            <span>Comidas y paseos: {money(plan.spendPerDayUSD)} por día (estimado)</span>
          ) : (
            <span>Comidas y paseos no están incluidos en este viaje: sumalos aparte.</span>
          )}
        </li>
        {plan.upfrontUSD > 0 && (
          <li>
            <Icon name="plane" size={16} />
            <span>Vuelos y extras: {money(plan.upfrontUSD)}, se pagan antes de viajar.</span>
          </li>
        )}
      </ul>
      <ol className="day-list">
        {days.map((d) => (
          <li key={d.n} className={`day day-${d.kind}`}>
            <span className="day-n" aria-hidden="true">
              {d.n}
            </span>
            <span className="grow stack-sm" style={{ gap: 2 }}>
              <span className="small muted">
                <span className="visually-hidden">Día {d.n}, </span>
                {capitalize(formatDate(d.date, { weekday: "short", day: "numeric", month: "short" }))} · {KIND_LABEL[d.kind]}
              </span>
              <strong className="day-title">{d.title}</strong>
              {(d.lodgingUSD > 0 || d.spendUSD != null) && (
                <span className="small muted">
                  {[d.lodgingUSD > 0 ? `Alojamiento ${money(d.lodgingUSD)}` : null, d.spendUSD != null ? `Gastos ${money(d.spendUSD)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </span>
            <span className="day-total">{d.totalUSD > 0 ? money(d.totalUSD) : "—"}</span>
          </li>
        ))}
      </ol>
      {plan.days.length > VISIBLE_DAYS && (
        <button type="button" className="ghost day-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Ver menos" : `Ver los ${plan.days.length} días`}
          <Icon name="chevronDown" size={16} className={all ? "flip" : undefined} />
        </button>
      )}
    </section>
  );
}

function Checklist({ list, onChange }: { list: ChecklistItem[]; onChange: (list: ChecklistItem[]) => void }) {
  const [draft, setDraft] = useState("");
  const titleId = useId();
  const { done, total } = checklistProgress(list);
  const pct = total ? Math.round((done / total) * 100) : 0;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const label = draft.trim().slice(0, 120);
    if (!label) return;
    onChange([...list, { id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, label, done: false }]);
    setDraft("");
  };

  return (
    <section aria-labelledby={titleId} className="stack">
      <div className="detail-head">
        <h4 id={titleId}>Antes de viajar</h4>
        <span className="small muted" aria-live="polite">
          {total ? `${done} de ${total} ${done === 1 ? "listo" : "listos"}` : "Sin tareas"}
        </span>
      </div>
      {total > 0 && (
        <div className="progress" role="progressbar" aria-labelledby={titleId} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {total > 0 ? (
        <ul className="todo-list">
          {list.map((t) => (
            <li key={t.id}>
              <label className="check grow">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) => onChange(list.map((x) => (x.id === t.id ? { ...x, done: e.target.checked } : x)))}
                />
                <span className={t.done ? "todo-done" : undefined}>{t.label}</span>
              </label>
              <button
                type="button"
                className="icon-btn todo-remove"
                aria-label={`Quitar "${t.label}"`}
                onClick={() => onChange(list.filter((x) => x.id !== t.id))}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">No quedan tareas. Sumá las que necesites abajo.</p>
      )}
      <form className="todo-add" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Agregar una tarea"
          aria-label="Nueva tarea"
          maxLength={120}
        />
        <button type="submit" className="secondary" disabled={!draft.trim()}>
          Agregar
        </button>
      </form>
    </section>
  );
}
