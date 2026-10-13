import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AIRLINES, airlineName } from "../../shared/airlines.ts";
import { flightLinks } from "../../shared/links.ts";
import { useApp } from "../lib/app-context.tsx";
import { formatRange } from "../lib/format.ts";
import Icon from "./Icon.tsx";

export interface PurchaseTarget {
  destinationId: string;
  name: string;
  iata: string;
  depart: string;
  ret: string;
  priceUSD: number;
  typicalUSD?: number;
  airline?: string;
  flightNumber?: string;
  seenAt?: string;
}

/** "Elegí dónde comprar": derivamos al proveedor, nunca vendemos el pasaje. */
export default function PurchaseModal({ target, onClose }: { target: PurchaseTarget; onClose: () => void }) {
  const { profile, meta, money } = useApp();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const adults = Math.max(1, profile.travelers);
  const [aviasales, google] = flightLinks(profile.origin, target.iata, target.depart, target.ret, adults, meta?.marker);
  const airline = target.airline ? AIRLINES[target.airline] : undefined;
  const options = [
    { key: "aviasales", kicker: "Opción recomendada", title: "Ver la oferta en Aviasales", text: "Compará agencias y aerolíneas con esta ruta y fechas ya cargadas.", href: aviasales.url },
    ...(airline
      ? [{ key: "airline", kicker: "Sitio oficial", title: `Consultar en ${airline.name}`, text: "Ingresá la ruta y las fechas en su buscador. A veces es más barato directo.", href: airline.url }]
      : []),
    { key: "google", kicker: "Para comparar", title: "Ver en Google Flights", text: "Precio de hoy y si está por debajo de lo habitual.", href: google.url },
  ];

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()} aria-labelledby="buy-title">
      <div className="modal-body">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Elegí dónde comprar</p>
            <h2 id="buy-title">{target.name}</h2>
            <p className="small muted">
              {profile.origin} – {target.iata} · {formatRange(target.depart, target.ret)}
            </p>
          </div>
          <div className="modal-price">
            <p className="eyebrow">Precio visto</p>
            <p className="price">{money(target.priceUSD)}</p>
            <p className="small muted">por persona, ida y vuelta</p>
          </div>
          <button className="icon-btn modal-close" aria-label="Cerrar" onClick={() => ref.current?.close()}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {(target.airline || target.flightNumber) && (
          <p className="small muted row gap-sm">
            <Icon name="plane" size={16} />
            Vuelo encontrado: <strong style={{ color: "var(--label)" }}>{[airlineName(target.airline), target.flightNumber].filter(Boolean).join(" · ")}</strong>
          </p>
        )}

        <div className="buy-options">
          {options.map((o, i) => (
            <a key={o.key} className={`buy-option ${i === 0 ? "recommended" : ""}`} href={o.href} target="_blank" rel="noreferrer">
              <span className="buy-num">{i + 1}</span>
              <span className="grow">
                <span className="eyebrow">{o.kicker}</span>
                <strong>{o.title}</strong>
                <span className="small muted">{o.text}</span>
              </span>
              <Icon name="external" size={18} />
            </a>
          ))}
        </div>

        <Link className="button secondary full" to={`/destino/${target.destinationId}?month=${target.depart.slice(0, 7)}&depart=${target.depart}`} onClick={() => ref.current?.close()}>
          Armar el viaje completo con este vuelo
        </Link>

        <p className="small muted">
          {target.typicalUSD ? `Precio habitual de referencia: ${money(target.typicalUSD)}. ` : ""}
          {target.seenAt ? "Son precios vistos recientemente, no cotizaciones en tiempo real. " : ""}
          FindMyTrip no vende pasajes: confirmá precio final, equipaje y condiciones en el proveedor. Tip: abrí el link en una ventana de incógnito.
        </p>
      </div>
    </dialog>
  );
}
