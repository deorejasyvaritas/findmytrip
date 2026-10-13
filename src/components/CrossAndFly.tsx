import { useEffect, useState } from "react";
import type { CrossResult, FlightDay } from "../../shared/types.ts";
import { flightLinks } from "../../shared/links.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import Icon from "./Icon.tsx";

/** Ahorro mínimo por persona para mostrar la sugerencia (mismo criterio que el servidor). */
const MIN_SAVING = 40;

/** "Cruzá y volá": solo aparece si salir desde otra ciudad ahorra de verdad. */
export default function CrossAndFly({ destId, iata, month, day, travelers }: { destId: string; iata: string; month: string; day: FlightDay | null; travelers: number }) {
  const { profile, money, meta } = useApp();
  const [data, setData] = useState<CrossResult | null>(null);

  useEffect(() => {
    if (!meta?.liveFlights) return;
    setData(null);
    api
      .cross({ origin: profile.origin, dest: destId, month })
      .then(setData)
      .catch(() => setData(null));
  }, [destId, month, profile.origin, meta?.liveFlights]);

  const worth = data?.options.filter((o) => o.savingUSD != null && o.savingUSD >= MIN_SAVING) ?? [];
  if (!data || !worth.length) return null;
  const originName = meta?.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;

  return (
    <section className="card cross" aria-labelledby="cross-title">
      <div className="cross-head">
        <Icon name="compass" size={20} />
        <div>
          <h3 id="cross-title">Cruzá y volá</h3>
          <p className="small muted">
            Este mes conviene salir desde otra ciudad. Desde {originName}, lo más barato visto es {money(data.baseUSD!)} por persona.
          </p>
        </div>
      </div>
      <ul className="cross-list">
        {worth.map((o) => (
          <li key={o.origin}>
            <div className="grow">
              <strong>Desde {o.name}</strong>
              <p className="small muted">
                {o.crossing}: {money(o.crossingUSD)}
                {o.crossingSource === "estimado" ? " (aprox.)" : ""} + vuelo {money(o.flightUSD)}
              </p>
              {day && (
                <a className="small" href={flightLinks(o.origin, iata, day.date, day.returnDate, travelers, meta?.marker)[0].url} target="_blank" rel="noreferrer">
                  Ver vuelos desde {o.name} <Icon name="external" size={14} />
                </a>
              )}
            </div>
            <div className="cross-price">
              <span className="price">{money(o.totalUSD)}</span>
              <span className="badge badge-ok">Ahorrás {money(o.savingUSD!)}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="small muted">
        Precios por persona, ida y vuelta, vistos en Aviasales este mes. Son tramos separados: dejá margen entre el cruce y el vuelo.
      </p>
    </section>
  );
}
