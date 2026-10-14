import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AIRLINES, airlineName } from "../../shared/airlines.ts";
import { flightLinks } from "../../shared/links.ts";
import { describeParty } from "../../shared/pricing.ts";
import { priceLabel, staleNote, type PriceStamp } from "../../shared/price-age.ts";
import { diffItem, diffLabel, type ItemDiff } from "../../shared/recheck.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { formatRange, isDomestic } from "../lib/format.ts";
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
  /** Qué precio es y cuándo se vio (para avisar si conviene revisarlo antes de comprar). */
  stamp?: PriceStamp;
}

/** "Elegí dónde comprar": derivamos al proveedor, nunca vendemos el pasaje. */
export default function PurchaseModal({ target, onClose }: { target: PurchaseTarget; onClose: () => void }) {
  const { profile, meta, money: fmt, moneyHint, destinations } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [check, setCheck] = useState<{ busy: boolean; diff: ItemDiff | null; error: string | null }>({ busy: false, diff: null, error: null });

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const domestic = isDomestic(destinations.find((d) => d.id === target.destinationId)?.region);
  const money = (usd: number) => fmt(usd, { domestic });
  // El link abre la búsqueda para todo el grupo: el total que ve Aviasales es el del viaje.
  const party = { adults: Math.max(1, profile.travelers), childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" };
  const [aviasales, google] = flightLinks(profile.origin, target.iata, target.depart, target.ret, party, meta?.marker);
  const airline = target.airline ? AIRLINES[target.airline] : undefined;
  const stamp: PriceStamp = target.stamp ?? { kind: "exacto", source: "aviasales" };
  const note = check.diff ? null : staleNote(stamp);
  const options = [
    { key: "aviasales", kicker: "Opción recomendada", title: "Ver la oferta en Aviasales", text: `Ruta, fechas y ${describeParty(party)} ya cargados: ahí ves el total.`, href: aviasales.url },
    ...(airline
      ? [{ key: "airline", kicker: "Sitio oficial", title: `Consultar en ${airline.name}`, text: "Ingresá la ruta y las fechas en su buscador. A veces es más barato directo.", href: airline.url }]
      : []),
    { key: "google", kicker: "Para comparar", title: "Ver en Google Flights", text: "Su precio de hoy y si está por debajo de lo habitual.", href: google.url },
  ];

  async function recheck() {
    setCheck({ busy: true, diff: null, error: null });
    try {
      const r = await api.recheck([{ i: 0, type: "flight", from: profile.origin, to: target.iata, depart: target.depart, ret: target.ret }]);
      const result = r.results[0];
      const item = { kind: "vuelo" as const, label: "", amountUSD: target.priceUSD };
      const diff = result ? diffItem(item, { kind: "exacto", source: "aviasales", at: r.checkedAt, unitUSD: target.priceUSD, units: 1 }, result) : null;
      setCheck({ busy: false, diff, error: diff ? null : "No encontramos un precio nuevo." });
    } catch (err) {
      setCheck({ busy: false, diff: null, error: (err as Error).message || "No pudimos revisar el precio." });
    }
  }

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
            <p className="eyebrow">{priceLabel(stamp)}</p>
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

        {(note || check.diff || check.error || check.busy) && (
          <p className="buy-note small" role="status">
            {check.busy ? (
              <span>Revisando el precio…</span>
            ) : check.diff ? (
              <span>
                {diffLabel(check.diff, money)}
                {check.diff.newAmountUSD != null ? " por persona" : ""}.
              </span>
            ) : (
              <>
                <span>{check.error ?? note}</span>
                <button type="button" className="link" onClick={recheck}>
                  Revisar precio ahora
                </button>
              </>
            )}
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
          {domestic && moneyHint(true) ? `${moneyHint(true)}; si pagás en dólares con tarjeta: ${fmt(target.priceUSD)} por persona. ` : ""}
          Son precios vistos por usuarios de Aviasales, no una cotización. FindMyTrip no vende pasajes: confirmá precio final, equipaje y condiciones en el
          proveedor. Tip: abrí el link en una ventana de incógnito.
        </p>
      </div>
    </dialog>
  );
}
