import type { ReactNode } from "react";
import type { TripPackage } from "../../shared/types.ts";
import { useApp } from "../lib/app-context.tsx";
import { STYLE_LABEL, formatDate } from "../lib/format.ts";

const KIND_ICON = { vuelo: "✈", alojamiento: "🛏", gastos: "🍽", extra: "＋" };

export default function PackageCard({ pkg, actions }: { pkg: TripPackage; actions?: ReactNode }) {
  const { money } = useApp();
  return (
    <article className="card package">
      <div className="suggestion-head">
        <div>
          <h3>{pkg.destinationName}</h3>
          <p className="muted small">
            {formatDate(pkg.departDate)} → {formatDate(pkg.returnDate, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
            {pkg.travelers} {pkg.travelers === 1 ? "viajero" : "viajeros"} · {STYLE_LABEL[pkg.style]} · desde {pkg.origin}
          </p>
        </div>
        <div className="price">{money(pkg.totalUSD)}</div>
      </div>
      <ul className="items">
        {pkg.items.map((i) => (
          <li key={i.label}>
            <span aria-hidden>{KIND_ICON[i.kind]}</span>
            <span className="grow">
              {i.link ? (
                <a href={i.link} target="_blank" rel="noreferrer">
                  {i.label}
                </a>
              ) : (
                i.label
              )}
            </span>
            <span>{money(i.amountUSD)}</span>
          </li>
        ))}
      </ul>
      {pkg.notes && <p className="note small">{pkg.notes}</p>}
      <div className="muted small">{money(Math.round(pkg.totalUSD / pkg.travelers))} por persona</div>
      {actions && <div className="actions">{actions}</div>}
    </article>
  );
}
