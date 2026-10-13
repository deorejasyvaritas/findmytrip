import type { ReactNode } from "react";
import type { TripPackage } from "../../shared/types.ts";
import { useApp } from "../lib/app-context.tsx";
import { STYLE_LABEL, formatDate } from "../lib/format.ts";
import type { IconName } from "../lib/icons.ts";
import Icon from "./Icon.tsx";

const KIND_ICON: Record<TripPackage["items"][number]["kind"], IconName> = {
  vuelo: "plane",
  alojamiento: "bed",
  gastos: "utensils",
  extra: "plus",
};

export default function PackageCard({ pkg, actions }: { pkg: TripPackage; actions?: ReactNode }) {
  const { money } = useApp();
  return (
    <article className="card package">
      <div className="suggestion-head">
        <div>
          <h3>{pkg.destinationName}</h3>
          <p className="small muted">
            {formatDate(pkg.departDate)} – {formatDate(pkg.returnDate, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
            {pkg.travelers} {pkg.travelers === 1 ? "viajero" : "viajeros"} · {STYLE_LABEL[pkg.style]}
          </p>
        </div>
        <div className="price">{money(pkg.totalUSD)}</div>
      </div>
      <ul className="items">
        {pkg.items.map((i) => (
          <li key={i.label}>
            <span className="label">
              <Icon name={KIND_ICON[i.kind]} size={16} />
              {i.link ? (
                <a href={i.link} target="_blank" rel="noreferrer">
                  {i.label}
                </a>
              ) : (
                <span>{i.label}</span>
              )}
            </span>
            <span>{money(i.amountUSD)}</span>
          </li>
        ))}
      </ul>
      {pkg.notes && <p className="note">{pkg.notes}</p>}
      <p className="small muted">{money(Math.round(pkg.totalUSD / pkg.travelers))} por persona</p>
      {actions && <div className="actions">{actions}</div>}
    </article>
  );
}
