import { useState, type FormEvent } from "react";
import type { Profile } from "../../shared/types.ts";
import InterestPicker from "../components/InterestPicker.tsx";
import Segmented from "../components/Segmented.tsx";
import { useApp } from "../lib/app-context.tsx";

export default function ProfilePage() {
  const { profile, setProfile, meta, destinations } = useApp();
  const [form, setForm] = useState<Profile>(profile);
  const [saved, setSaved] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setProfile(form);
    setSaved(true);
  }

  const toggleVisited = (id: string) =>
    setForm({ ...form, visited: form.visited.includes(id) ? form.visited.filter((x) => x !== id) : [...form.visited, id] });

  return (
    <form className="stack-lg profile" onSubmit={submit} onChange={() => setSaved(false)}>
      <div>
        <h1>Tu perfil de viajero</h1>
        <p className="muted">Con esto personalizo las búsquedas y las sugerencias del agente. Se guarda solo en este navegador.</p>
      </div>

      <section className="card stack">
        <div className="grid-4">
          <label>
            Nombre
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Salgo desde
            <select value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
              {meta?.origins.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Viajamos
            <input
              type="number"
              min={1}
              max={12}
              value={form.travelers}
              onChange={(e) => setForm({ ...form, travelers: Number(e.target.value) || 1 })}
            />
          </label>
          <label>
            Máx. horas de vuelo
            <select
              value={form.maxFlightHours ?? 0}
              onChange={(e) => setForm({ ...form, maxFlightHours: Number(e.target.value) || null })}
            >
              <option value={0}>Sin límite</option>
              <option value={4}>Hasta 4 h</option>
              <option value={9}>Hasta 9 h</option>
              <option value={14}>Hasta 14 h</option>
            </select>
          </label>
        </div>
        <div className="row wrap gap">
          <div className="stack-sm">
            <span className="label">Estilo de viaje</span>
            <Segmented
              label="Estilo de viaje"
              value={form.style}
              onChange={(style) => setForm({ ...form, style })}
              options={[
                { value: "low", label: "Económico" },
                { value: "mid", label: "Confort" },
                { value: "high", label: "Premium" },
              ]}
            />
          </div>
          <div className="stack-sm">
            <span className="label">Ver precios en</span>
            <Segmented
              label="Moneda"
              value={form.currency}
              onChange={(currency) => setForm({ ...form, currency })}
              options={[
                { value: "USD", label: "Dólares" },
                { value: "ARS", label: `Pesos (1 USD = $${meta?.usdArsRate ?? "…"})` },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>¿Qué te gusta?</h2>
        {meta && (
          <InterestPicker options={meta.interests} value={form.interests} onChange={(interests) => setForm({ ...form, interests })} />
        )}
      </section>

      <section className="card stack">
        <h2>¿Dónde ya estuviste?</h2>
        <p className="muted small">Los dejo fuera de las sugerencias para mostrarte cosas nuevas.</p>
        <div className="chips">
          {destinations.map((d) => (
            <button
              type="button"
              key={d.id}
              className={`chip ${form.visited.includes(d.id) ? "on" : ""}`}
              aria-pressed={form.visited.includes(d.id)}
              onClick={() => toggleVisited(d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      </section>

      <div className="row gap">
        <button className="primary">Guardar perfil</button>
        {saved && <span className="success">✓ Guardado</span>}
      </div>
    </form>
  );
}
