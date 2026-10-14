import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SharedTripResponse, TripPackage } from "../../shared/types.ts";
import Icon, { BrandMark } from "../components/Icon.tsx";
import { api } from "../lib/api.ts";
import { STYLE_LABEL, formatDate, formatMoney } from "../lib/format.ts";
import type { IconName } from "../lib/icons.ts";
import { LegalFooter } from "./Legal.tsx";

// Viaje compartido por link: página pública de solo lectura (no pide sesión).

const KIND_ICON: Record<TripPackage["items"][number]["kind"], IconName> = {
  vuelo: "plane",
  alojamiento: "bed",
  gastos: "utensils",
  extra: "plus",
};

// Quien abre el link no tiene perfil: mostramos los montos en dólares.
const usd = (n: number) => formatMoney(n, "USD", 1);
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

export default function SharedTripPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<SharedTripResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .sharedTrip(id)
      .then((r) => {
        if (alive) setData(r);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message || "No pudimos abrir este viaje.");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const prev = document.title;
    document.title = data ? `Viaje a ${data.trip.destinationName} · FindMyTrip` : "Viaje compartido · FindMyTrip";
    return () => {
      document.title = prev;
    };
  }, [data]);

  return (
    <div className="legal shared-trip">
      <header className="legal-top">
        <Link to="/" className="legal-brand">
          <BrandMark size={32} />
          <span>FindMyTrip</span>
        </Link>
        <Link to="/">Armá tu viaje</Link>
      </header>
      <main className="shared-body">
        {error ? (
          <div className="card empty">
            <Icon name="link" size={32} />
            <h3>Este link ya no está disponible</h3>
            <p className="muted">Puede que quien lo compartió haya dejado de compartirlo o que el link esté incompleto.</p>
            <Link to="/" className="button primary">
              Armá tu propio viaje en FindMyTrip
            </Link>
          </div>
        ) : !data ? (
          <div className="card skeleton shared-loading" role="status" aria-live="polite">
            <span className="sk" style={{ width: "30%", height: 12 }} />
            <span className="sk" style={{ width: "70%", height: 32 }} />
            <span className="sk" style={{ width: "55%", height: 16 }} />
            <span className="sk" style={{ width: "100%", height: 120 }} />
            <span className="visually-hidden">Cargando el viaje…</span>
          </div>
        ) : (
          <TripView data={data} />
        )}
      </main>
      <LegalFooter />
    </div>
  );
}

function TripView({ data }: { data: SharedTripResponse }) {
  const t = data.trip;
  const nights = t.departDate && t.returnDate ? nightsBetween(t.departDate, t.returnDate) : null;
  const hasDaily = t.items.some((i) => i.kind === "gastos");
  return (
    <article className="stack">
      <div className="shared-hero">
        <p className="eyebrow">Viaje compartido</p>
        <h1>{t.destinationName}</h1>
        <ul className="shared-facts">
          {t.departDate && (
            <li>
              <Icon name="calendar" size={16} />
              {formatDate(t.departDate)} – {formatDate(t.returnDate, { day: "numeric", month: "short", year: "numeric" })}
              {nights != null && nights > 0 && ` · ${nights} ${nights === 1 ? "noche" : "noches"}`}
            </li>
          )}
          <li>
            <Icon name="users" size={16} />
            {t.travelers} {t.travelers === 1 ? "viajero" : "viajeros"}
          </li>
          <li>
            <Icon name="bed" size={16} />
            Alojamiento {STYLE_LABEL[t.style].toLowerCase()}
          </li>
        </ul>
      </div>

      <section className="card stack" aria-labelledby="shared-items">
        <h2 id="shared-items" className="headline">
          Qué incluye
        </h2>
        <ul className="items">
          {t.items.map((i, n) => (
            <li key={`${i.kind}-${n}`}>
              <span className="label">
                <Icon name={KIND_ICON[i.kind]} size={16} />
                {i.link ? (
                  <a href={i.link} target="_blank" rel="noreferrer sponsored">
                    {i.label}
                    <span className="visually-hidden"> (se abre en otra pestaña)</span>
                  </a>
                ) : (
                  <span>{i.label}</span>
                )}
              </span>
              <span>{usd(i.amountUSD)}</span>
            </li>
          ))}
        </ul>
        <div className="shared-total">
          <div>
            <p className="small muted">Total del grupo</p>
            <p className="small muted">{usd(Math.round(t.totalUSD / t.travelers))} por persona</p>
          </div>
          <span className="price">{usd(t.totalUSD)}</span>
        </div>
        {!hasDaily && <p className="small muted">No incluye comidas ni paseos en destino.</p>}
      </section>

      <p className="note">
        Precios de referencia, consultados el {formatDate(data.updatedAt, { day: "numeric", month: "long", year: "numeric" })}. Pueden
        cambiar: el precio final es el que muestra cada proveedor antes de pagar.
      </p>

      <section className="card shared-cta">
        <span className="extra-icon">
          <Icon name="compass" size={20} />
        </span>
        <div className="grow stack-sm">
          <strong>¿Te dieron ganas de viajar?</strong>
          <span className="small muted">Buscá por presupuesto, fechas o destino y armá tu viaje con precios reales.</span>
        </div>
        <Link to="/" className="button primary">
          Armá tu propio viaje en FindMyTrip
        </Link>
      </section>
    </article>
  );
}
