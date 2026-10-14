import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EscapeWeekend } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate, formatRange, isDomestic } from "../lib/format.ts";
import { partyToParams } from "../../shared/pricing.ts";
import Icon from "./Icon.tsx";

/** Escapadas con precio real para los próximos fines de semana largos. */
export default function LongWeekends() {
  const { profile, meta, money, photos, destinations } = useApp();
  // Alojamiento por persona según el grupo del perfil (los chicos comparten habitación).
  const party = partyToParams({ adults: profile.travelers, childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" });
  const partyKey = `${party.adults}|${party.kids}`;
  const domestic = (id: string) => isDomestic(destinations.find((d) => d.id === id)?.region);
  const [weekends, setWeekends] = useState<EscapeWeekend[] | null>(null);

  useEffect(() => {
    if (!meta?.liveFlights) return;
    setWeekends(null);
    api
      .escapes(profile.origin, party)
      .then(setWeekends)
      .catch(() => setWeekends([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.liveFlights, profile.origin, partyKey]);

  if (!meta?.liveFlights || (weekends && weekends.length === 0)) return null;

  return (
    <section className="stack" aria-labelledby="lw-title">
      <div className="section-head">
        <h2 id="lw-title">Fines de semana largos</h2>
        <span className="small muted">Vuelo real ida y vuelta + alojamiento económico, por persona</span>
      </div>
      <div className="lw-grid">
        {!weekends &&
          Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="card skeleton" aria-hidden="true">
              <div className="sk" style={{ width: "60%", height: 18 }} />
              <div className="sk" style={{ width: "100%", height: 52 }} />
              <div className="sk" style={{ width: "100%", height: 52 }} />
            </div>
          ))}
        {weekends?.map((w) => (
          <article key={w.from} className="card lw-card">
            <header>
              <span className="lw-date">
                <Icon name="calendar" size={16} />
                {capitalize(formatDate(w.from, { weekday: "short", day: "numeric", month: "short" }))} –{" "}
                {formatDate(w.to, { weekday: "short", day: "numeric", month: "short" })}
              </span>
              <strong>
                {w.days} días · {w.reason}
              </strong>
            </header>
            {w.options.length === 0 ? (
              <p className="small muted">Todavía no hay precios vistos para esas fechas. Probá más cerca de la fecha.</p>
            ) : (
              <div className="lw-list">
                {w.options.map((o) => (
                  <Link
                    key={o.destinationId}
                    className="lw-row"
                    to={`/destino/${o.destinationId}?${new URLSearchParams({ month: o.depart.slice(0, 7), depart: o.depart, nights: String(o.nights) })}`}
                  >
                    {photos[o.destinationId] ? (
                      <img src={photos[o.destinationId]} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="lw-thumb" />
                    )}
                    <span className="grow stack-sm" style={{ gap: 0 }}>
                      <span className="lw-name">{o.name}</span>
                      <span className="small muted">
                        {formatRange(o.depart, o.ret)} · vuelo {money(o.flightUSD, { domestic: domestic(o.destinationId) })}
                      </span>
                    </span>
                    <span className="lw-price">{money(o.totalPerPersonUSD, { domestic: domestic(o.destinationId) })}</span>
                    <Icon name="chevronRight" size={16} />
                  </Link>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
