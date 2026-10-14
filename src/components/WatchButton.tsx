import { useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { Party, Style } from "../../shared/types.ts";
import { useApp } from "../lib/app-context.tsx";
import Icon from "./Icon.tsx";

/**
 * "Avisarme si baja" desde un resultado: guarda el destino en la lista que
 * seguís (y la alerta del servidor) con el total que se está mostrando.
 * Si ya lo seguís para ese mes, muestra "Siguiendo".
 */
export default function WatchButton({
  destinationId,
  name,
  targetUSD,
  month,
  nights,
  party,
  style,
  variant = "mini",
}: {
  destinationId: string;
  name: string;
  /** Total objetivo del grupo (vuelo, equipaje y alojamiento), en USD. */
  targetUSD: number;
  month: number | null;
  nights: number;
  party?: Party;
  style?: Style;
  variant?: "mini" | "button";
}) {
  const { watchlist, addWatch, money } = useApp();
  const [feedback, setFeedback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = watchlist.find((w) => w.destinationId === destinationId && w.month === month);

  function onClick(e: MouseEvent) {
    // La tarjeta entera lleva a la ficha: este botón no.
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    if (!current) {
      addWatch({ destinationId, targetUSD: Math.round(targetUSD), month, nights }, party && style ? { party, style } : undefined).catch(
        (err: Error) => {
          setFeedback(false);
          setError(`No pudimos crear la alerta. ${err.message}`);
        },
      );
    }
    setFeedback(true);
  }

  const target = current?.targetUSD ?? Math.round(targetUSD);
  return (
    <div className="watch-action">
      <button
        type="button"
        className={variant === "mini" ? `mini-action ${current ? "on" : ""}` : "secondary"}
        aria-label={current ? `Siguiendo ${name}: te avisamos si baja de ${money(target)}` : `Avisarme si baja el precio de ${name}`}
        onClick={onClick}
      >
        <Icon name={current ? "check" : "bell"} size={16} />
        {current ? "Siguiendo" : "Avisarme si baja"}
      </button>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {feedback && !error && (
        <p className="watch-feedback small" role="status">
          Te avisamos si el viaje baja de {money(target)}.{" "}
          <Link to="/perfil#alertas" onClick={(e) => e.stopPropagation()}>
            Gestionalo en Perfil &gt; Alertas
          </Link>
        </p>
      )}
    </div>
  );
}
