import { useMemo } from "react";
import type { Party, When } from "../../shared/types.ts";
import { capitalize, formatDate, monthShort } from "../lib/format.ts";
import Segmented from "./Segmented.tsx";
import Stepper from "./Stepper.tsx";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function upcomingMonthList() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  });
}

/** Texto corto para el resumen del campo "Cuándo". */
export function describeWhen(w: When): string {
  switch (w.kind) {
    case "flexible":
      return "Flexible";
    case "months":
      if (!w.months.length) return "Elegí meses";
      return w.months.map((m) => capitalize(monthShort(m.month))).join(", ") + ` ${w.months[w.months.length - 1].year}`;
    case "window":
      return `Salir ${formatDate(w.from)} – ${formatDate(w.to)}`;
    case "exact":
      return `${formatDate(w.depart)} – ${formatDate(w.ret)}`;
  }
}

/** Devuelve un error legible si las fechas no tienen sentido. */
export function validateWhen(w: When): string | null {
  const today = todayISO();
  if (w.kind === "months" && !w.months.length) return "Elegí al menos un mes.";
  if (w.kind === "window") {
    if (!w.from || !w.to) return "Completá las dos fechas del rango.";
    if (w.from < today) return "El rango tiene que empezar desde hoy en adelante.";
    if (w.to < w.from) return "La fecha final del rango tiene que ser posterior a la inicial.";
  }
  if (w.kind === "exact") {
    if (!w.depart || !w.ret) return "Completá la fecha de ida y la de vuelta.";
    if (w.depart < today) return "La ida tiene que ser desde hoy en adelante.";
    if (w.ret <= w.depart) return "La vuelta tiene que ser posterior a la ida.";
  }
  return null;
}

export function WhenPicker({ value, onChange }: { value: When; onChange: (w: When) => void }) {
  const months = useMemo(upcomingMonthList, []);
  const selected = value.kind === "months" ? value.months : [];
  const isOn = (m: { month: number; year: number }) => selected.some((x) => x.month === m.month && x.year === m.year);
  const toggle = (m: { month: number; year: number }) => {
    const next = isOn(m) ? selected.filter((x) => !(x.month === m.month && x.year === m.year)) : [...selected, m];
    next.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
    onChange({ kind: "months", months: next });
  };
  const today = todayISO();

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Segmented
        label="Tipo de fechas"
        value={value.kind}
        onChange={(kind) => {
          if (kind === "flexible") onChange({ kind });
          if (kind === "months") onChange({ kind, months: selected.length ? selected : [months[1]] });
          if (kind === "window") onChange({ kind, from: "", to: "" });
          if (kind === "exact") onChange({ kind, depart: "", ret: "" });
        }}
        options={[
          { value: "flexible", label: "Flexible" },
          { value: "months", label: "Meses" },
          { value: "window", label: "Rango" },
          { value: "exact", label: "Fechas exactas" },
        ]}
      />
      {value.kind === "flexible" && <p className="small muted">Busco el mejor momento de los próximos 12 meses.</p>}
      {value.kind === "months" && (
        <>
          <p className="small muted">Podés elegir varios, por ejemplo enero y febrero.</p>
          <div className="month-chips">
            {months.map((m) => (
              <button
                type="button"
                key={`${m.year}-${m.month}`}
                className={`chip ${isOn(m) ? "on" : ""}`}
                aria-pressed={isOn(m)}
                onClick={() => toggle(m)}
              >
                {capitalize(monthShort(m.month))} {String(m.year).slice(2)}
              </button>
            ))}
          </div>
        </>
      )}
      {value.kind === "window" && (
        <>
          <p className="small muted">Para salir en algún momento entre dos fechas, por ejemplo de fines de enero a principios de febrero.</p>
          <div className="pair">
            <label className="field">
              Salir desde
              <input type="date" min={today} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
            </label>
            <label className="field">
              Salir hasta
              <input type="date" min={value.from || today} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
            </label>
          </div>
        </>
      )}
      {value.kind === "exact" && (
        <div className="pair">
          <label className="field">
            Ida
            <input type="date" min={today} value={value.depart} onChange={(e) => onChange({ ...value, depart: e.target.value })} />
          </label>
          <label className="field">
            Vuelta
            <input type="date" min={value.depart || today} value={value.ret} onChange={(e) => onChange({ ...value, ret: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

export function PartyPicker({ value, onChange }: { value: Party; onChange: (p: Party) => void }) {
  const setKids = (n: number) => {
    const ages = value.childAges.slice(0, n);
    while (ages.length < n) ages.push(8);
    onChange({ ...value, childAges: ages });
  };
  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="list-row" style={{ padding: "8px 0" }}>
        <span className="grow">
          Adultos
          <span className="small muted" style={{ display: "block" }}>
            18 años o más
          </span>
        </span>
        <Stepper label="Adultos" value={value.adults} min={1} max={9} onChange={(adults) => onChange({ ...value, adults })} />
      </div>
      <div className="list-row" style={{ padding: "8px 0" }}>
        <span className="grow">
          Menores
          <span className="small muted" style={{ display: "block" }}>
            De 0 a 17 años
          </span>
        </span>
        <Stepper label="Menores" value={value.childAges.length} min={0} max={8} onChange={setKids} />
      </div>
      {value.childAges.length > 0 && (
        <div className="kid-ages">
          {value.childAges.map((age, i) => (
            <label key={i} className="field">
              Edad del menor {i + 1}
              <select
                value={age}
                onChange={(e) => {
                  const ages = [...value.childAges];
                  ages[i] = Number(e.target.value);
                  onChange({ ...value, childAges: ages });
                }}
              >
                <option value={0}>Menos de 1 año (en brazos)</option>
                <option value={1}>1 año (en brazos)</option>
                {Array.from({ length: 16 }, (_, k) => k + 2).map((a) => (
                  <option key={a} value={a}>
                    {a} años
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="small muted" style={{ gridColumn: "1 / -1" }}>
            Las edades cambian el precio: bebés en brazos pagan cerca del 10 % del pasaje y los chicos de 2 a 11, alrededor del 75 %.
          </p>
        </div>
      )}
    </div>
  );
}
