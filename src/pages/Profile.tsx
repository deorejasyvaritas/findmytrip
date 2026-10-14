import { useState, type FormEvent } from "react";
import type { Bags, Profile } from "../../shared/types.ts";
import { BAGS_LABEL } from "../../shared/pricing.ts";
import { PartyPicker } from "../components/TripPickers.tsx";
import AccountSettings from "../components/AccountSettings.tsx";
import AlertsSettings from "../components/AlertsSettings.tsx";
import Icon from "../components/Icon.tsx";
import InterestPicker from "../components/InterestPicker.tsx";
import Segmented from "../components/Segmented.tsx";
import { useApp } from "../lib/app-context.tsx";

export default function ProfilePage() {
  const { profile, setProfile, meta, destinations } = useApp();
  const [form, setForm] = useState<Profile>(profile);
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<Profile>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setProfile(form);
    setSaved(true);
  }

  const toggleVisited = (id: string) =>
    update({ visited: form.visited.includes(id) ? form.visited.filter((x) => x !== id) : [...form.visited, id] });

  return (
    <form className="stack-lg profile" style={{ maxWidth: 720 }} onSubmit={submit}>
      <div>
        <h1>Perfil</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Con esto personalizo las búsquedas y las sugerencias. Se guarda en tu cuenta y se sincroniza entre tus dispositivos.
        </p>
      </div>

      <section>
        <p className="grouped-title">Sobre vos</p>
        <div className="grouped">
          <label className="list-row">
            <span className="grow">Nombre</span>
            <input value={form.name} placeholder="Opcional" onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="list-row">
            <span className="grow">Salgo desde</span>
            <select value={form.origin} onChange={(e) => update({ origin: e.target.value })}>
              {meta?.origins.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="list-row">
            <span className="grow">Horas de vuelo como máximo</span>
            <select value={form.maxFlightHours ?? 0} onChange={(e) => update({ maxFlightHours: Number(e.target.value) || null })}>
              <option value={0}>Sin límite</option>
              <option value={4}>Hasta 4 h</option>
              <option value={9}>Hasta 9 h</option>
              <option value={14}>Hasta 14 h</option>
            </select>
          </label>
        </div>
      </section>

      <section>
        <p className="grouped-title">Con quién viajás</p>
        <div className="grouped">
          <div className="list-row list-row-block">
            <PartyPicker
              value={{ adults: form.travelers, childAges: form.childAges ?? [], bags: form.bags ?? "cabin" }}
              onChange={(p) => update({ travelers: p.adults, childAges: p.childAges })}
            />
          </div>
          <label className="list-row">
            <span className="grow">Equipaje habitual</span>
            <select value={form.bags ?? "cabin"} onChange={(e) => update({ bags: e.target.value as Bags })}>
              {(Object.keys(BAGS_LABEL) as Bags[]).map((b) => (
                <option key={b} value={b}>
                  {BAGS_LABEL[b]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="grouped-note">Se usa como punto de partida en cada búsqueda; después lo podés cambiar.</p>
      </section>

      <section>
        <p className="grouped-title">Preferencias</p>
        <div className="grouped">
          <div className="list-row">
            <span className="grow">Alojamiento preferido</span>
            <Segmented
              label="Alojamiento preferido"
              value={form.style}
              onChange={(style) => update({ style })}
              options={[
                { value: "low", label: "Económico" },
                { value: "mid", label: "Confort" },
                { value: "high", label: "Premium" },
              ]}
            />
          </div>
          <div className="list-row">
            <span className="grow">Ver precios en</span>
            <Segmented
              label="Moneda"
              value={form.currency}
              onChange={(currency) => update({ currency })}
              options={[
                { value: "USD", label: "Dólares" },
                { value: "ARS", label: "Pesos" },
              ]}
            />
          </div>
        </div>
        {meta && (
          <p className="grouped-note">
            1 USD = ${meta.usdArsRate.toLocaleString("es-AR")} · {meta.usdArsSource}
          </p>
        )}
      </section>

      <section>
        <p className="grouped-title">Qué te gusta</p>
        <div className="grouped">
          <div className="list-row list-row-block">
            {meta && <InterestPicker options={meta.interests} value={form.interests} onChange={(interests) => update({ interests })} />}
          </div>
        </div>
      </section>

      <section>
        <p className="grouped-title">Dónde ya estuviste</p>
        <div className="grouped">
          <div className="list-row list-row-block">
            <div className="chips">
              {destinations.map((d) => (
                <button
                  type="button"
                  key={d.id}
                  className={`chip ${form.visited.includes(d.id) ? "on" : ""}`}
                  aria-pressed={form.visited.includes(d.id)}
                  onClick={() => toggleVisited(d.id)}
                >
                  {form.visited.includes(d.id) && <Icon name="check" size={14} />}
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="grouped-note">Los dejo fuera de las sugerencias para mostrarte lugares nuevos.</p>
      </section>

      <AlertsSettings />

      <AccountSettings />

      <div className="row gap wrap">
        <button className="primary">Guardar perfil</button>
        {saved && (
          <span className="success row gap-sm" role="status">
            <Icon name="check" size={16} />
            Perfil guardado
          </span>
        )}
      </div>
      <p className="small muted">Versión del {__BUILD__}</p>
    </form>
  );
}
