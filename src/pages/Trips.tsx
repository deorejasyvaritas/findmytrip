import { Link } from "react-router-dom";
import type { TripPackage } from "../../shared/types.ts";
import Icon from "../components/Icon.tsx";
import PackageCard from "../components/PackageCard.tsx";
import Segmented from "../components/Segmented.tsx";
import { useApp } from "../lib/app-context.tsx";

const STATUS: { value: TripPackage["status"]; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "armando", label: "Armando" },
  { value: "reservado", label: "Reservado" },
];

export default function Trips() {
  const { packages, updatePackage, removePackage, money } = useApp();
  const pending = packages.filter((p) => p.status !== "reservado").reduce((s, p) => s + p.totalUSD, 0);

  if (packages.length === 0) {
    return (
      <div className="stack-lg">
        <h1>Mis viajes</h1>
        <div className="card empty">
          <Icon name="bookmark" size={32} />
          <h3>Todavía no guardaste ningún viaje</h3>
          <p className="muted">
            Cuando un destino te guste, armá el paquete y tocá Guardar. Acá vas a tener todo junto: vuelo, alojamiento y gastos.
          </p>
          <Link to="/" className="button primary">
            Explorar destinos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div>
        <h1>Mis viajes</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {packages.length} {packages.length === 1 ? "viaje" : "viajes"} · {money(pending)} en planes sin reservar
        </p>
      </div>
      {STATUS.map(({ value, label }) => {
        const list = packages.filter((p) => p.status === value);
        if (!list.length) return null;
        return (
          <section key={value}>
            <div className="section-head">
              <h2>{label}</h2>
              <span className="small muted">{list.length}</span>
            </div>
            <div className="grid-cards">
              {list.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  actions={
                    <>
                      <Segmented
                        label={`Estado de ${p.destinationName}`}
                        value={p.status}
                        onChange={(status) => updatePackage(p.id, { status })}
                        options={STATUS}
                      />
                      <span className="grow" />
                      <Link className="button plain" to={`/destino/${p.destinationId}?month=${p.departDate.slice(0, 7)}`}>
                        Ajustar
                      </Link>
                      <button
                        className="icon-btn destructive"
                        aria-label={`Borrar el viaje a ${p.destinationName}`}
                        onClick={() => confirm(`¿Borrar el viaje a ${p.destinationName}? No se puede deshacer.`) && removePackage(p.id)}
                      >
                        <Icon name="trash" size={18} />
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
