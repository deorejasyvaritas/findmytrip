import { Link } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
import PackageCard from "../components/PackageCard.tsx";
import { useApp } from "../lib/app-context.tsx";

const STATUS: { value: TripPackage["status"]; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "armando", label: "Armando" },
  { value: "reservado", label: "Reservado" },
];

export default function Trips() {
  const { packages, updatePackage, removePackage, money } = useApp();
  const total = packages.filter((p) => p.status !== "reservado").reduce((s, p) => s + p.totalUSD, 0);

  if (packages.length === 0) {
    return (
      <div className="card empty stack">
        <h1>Mis viajes</h1>
        <p>Todavía no guardaste ningún paquete.</p>
        <p className="muted">
          <Link to="/">Explorá destinos</Link> según tu presupuesto o pedile ideas al <Link to="/agente">agente</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="section-head">
        <h1>Mis viajes</h1>
        <span className="muted small">
          {packages.length} paquetes · {money(total)} en planes sin reservar
        </span>
      </div>
      {STATUS.map(({ value, label }) => {
        const list = packages.filter((p) => p.status === value);
        if (!list.length) return null;
        return (
          <section key={value}>
            <h2>{label}</h2>
            <div className="grid-cards">
              {list.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  actions={
                    <>
                      <select
                        aria-label="Estado"
                        value={p.status}
                        onChange={(e) => updatePackage(p.id, { status: e.target.value as TripPackage["status"] })}
                      >
                        {STATUS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <Link className="secondary button" to={`/destino/${p.destinationId}?month=${p.departDate.slice(0, 7)}`}>
                        Ajustar
                      </Link>
                      <button className="ghost" onClick={() => confirm("¿Borrar este paquete?") && removePackage(p.id)}>
                        Borrar
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
