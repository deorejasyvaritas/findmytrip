import type { ReactNode } from "react";
import type { TripPackage } from "../../shared/types.ts";
import { itemQuote, diffLabel } from "../../shared/recheck.ts";
import { needsCheck, priceLabel, staleNote } from "../../shared/price-age.ts";
import { useApp } from "../lib/app-context.tsx";
import { STYLE_LABEL, formatDate, isDomestic, timeAgo } from "../lib/format.ts";
import type { IconName } from "../lib/icons.ts";
import type { PriceCheck } from "../lib/price-check.ts";
import Icon from "./Icon.tsx";

const KIND_ICON: Record<TripPackage["items"][number]["kind"], IconName> = {
  vuelo: "plane",
  alojamiento: "bed",
  gastos: "utensils",
  extra: "plus",
};

export default function PackageCard({
  pkg,
  actions,
  badge,
  check,
  children,
}: {
  pkg: TripPackage;
  actions?: ReactNode;
  /** Etiqueta junto al título (por ejemplo "Compartido"). */
  badge?: ReactNode;
  /** "Revisar precios" (Mis viajes). */
  check?: PriceCheck;
  /** Contenido extra debajo de las acciones (detalle del viaje). */
  children?: ReactNode;
}) {
  const app = useApp();
  // Dentro de Argentina se paga en pesos al oficial; afuera, con dólar tarjeta.
  const domestic = isDomestic(app.destinations.find((d) => d.id === pkg.destinationId)?.region);
  const money = (usd: number) => app.money(usd, { domestic });
  const hint = app.moneyHint(domestic);
  // Si el sitio cobra en dólares (Aviasales y la mayoría de las agencias), con tarjeta argentina se paga al dólar tarjeta.
  const cardTotal = domestic && hint ? app.money(pkg.totalUSD) : null;

  // Precio más viejo que conviene revisar antes de reservar (solo vuelos y alojamiento).
  const stale = pkg.items
    .map((i) => (i.kind === "vuelo" || i.kind === "alojamiento" ? itemQuote(i, pkg) : null))
    .filter((q) => q && needsCheck(q))
    .sort((a, b) => Date.parse(a!.at) - Date.parse(b!.at))[0];
  const staleText = stale && !check?.checkedAt ? staleNote(stale) : null;

  return (
    <article className="card package">
      <div className="suggestion-head">
        <div>
          <h3>{pkg.destinationName}</h3>
          {badge}
          <p className="small muted">
            {formatDate(pkg.departDate)} – {formatDate(pkg.returnDate, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
            {pkg.travelers} {pkg.travelers === 1 ? "viajero" : "viajeros"} · alojamiento {STYLE_LABEL[pkg.style].toLowerCase()}
          </p>
        </div>
        <div className="price">{money(pkg.totalUSD)}</div>
      </div>
      <ul className="items">
        {pkg.items.map((i, n) => {
          const q = i.kind === "vuelo" || i.kind === "alojamiento" ? itemQuote(i, pkg) : null;
          const d = check?.diffs.get(n);
          return (
            <li key={`${n}-${i.label}`}>
              <span className="label">
                <Icon name={KIND_ICON[i.kind]} size={16} />
                <span className="stack-sm" style={{ gap: 0 }}>
                  {i.link ? (
                    <a href={i.link} target="_blank" rel="noreferrer">
                      {i.label}
                    </a>
                  ) : (
                    <span>{i.label}</span>
                  )}
                  {d ? (
                    <span className={`small ${d.status === "subio" ? "price-up" : d.status === "bajo" ? "price-down" : "muted"}`}>{diffLabel(d, money)}</span>
                  ) : (
                    q && <span className="small muted">{priceLabel(q)}</span>
                  )}
                </span>
              </span>
              <span>{money(i.amountUSD)}</span>
            </li>
          );
        })}
      </ul>
      {pkg.notes && <p className="note">{pkg.notes}</p>}
      <p className="small muted">
        {money(Math.round(pkg.totalUSD / pkg.travelers))} por persona
        {hint ? ` · ${hint.toLowerCase()}` : ""}
        {cardTotal ? `. Si pagás en dólares con tarjeta: ${cardTotal}` : ""}
      </p>
      {check?.checkable && (
        <div className="price-check small" aria-live="polite">
          {check.busy ? (
            <span className="muted">Revisando precios…</span>
          ) : check.error ? (
            <span className="error">{check.error}</span>
          ) : check.checkedAt ? (
            <span className="muted">Precios revisados {timeAgo(check.checkedAt)}.</span>
          ) : staleText ? (
            <span className="muted">{staleText}</span>
          ) : null}
          {!check.busy && (
            <button type="button" className="link" onClick={() => void check.run(false)}>
              {staleText ? "Revisar precio ahora" : "Revisar precios"}
            </button>
          )}
          {!check.busy && check.changed && (
            <button type="button" className="link" onClick={check.apply}>
              Usar los precios nuevos
            </button>
          )}
          {!check.busy && check.missingFlight && app.meta?.googleQuotes && (
            <button type="button" className="link" onClick={() => void check.run(true)}>
              Buscar en Google Flights
            </button>
          )}
        </div>
      )}
      {actions && <div className="actions">{actions}</div>}
      {children}
    </article>
  );
}
