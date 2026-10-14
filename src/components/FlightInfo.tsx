import type { FlightInfo, FlightSegment } from "../../shared/flight-details.ts";
import { arrivalInfo, durationText, stopsText } from "../../shared/flight-details.ts";
import { airlineName } from "../../shared/airlines.ts";
import { capitalize, formatDate } from "../lib/format.ts";

// Detalle de un vuelo como en una agencia (resultados de "Ya sé a dónde" y Mis viajes)
// y la línea sobre cuotas.

const shortDate = (iso: string) => formatDate(iso.slice(0, 10), { weekday: "short", day: "numeric", month: "short" });

/** Un vuelo como en una agencia: salida, llegada (+1), escalas, aerolínea, duración y equipaje. */
export function FlightLine({ label, s }: { label: string; s: FlightSegment }) {
  const arr = arrivalInfo(s.departAt, s.arriveAt);
  const dur = durationText(s.durationMin);
  return (
    <span className="flight-line">
      <span className="flight-line-head">
        <span className="flight-line-label">{label}</span>
        <span>
          {s.from} · {stopsText(s.stops)} · {s.to}
        </span>
        {s.airline && <span className="muted">· {airlineName(s.airline)}</span>}
      </span>
      <span className="flight-line-times">
        {capitalize(shortDate(s.departAt))} · <strong>{s.departAt.slice(11, 16)}</strong>
        {arr ? (
          <>
            {" "}
            a <strong>{arr.time}</strong>
            {arr.plus > 0 && <sup className="plus-day">+{arr.plus}</sup>}
          </>
        ) : null}
        {dur ? <span className="muted"> · {dur}{arr ? "" : " de viaje"}</span> : null}
      </span>
      {arr?.note && <span className="flight-line-note">{arr.note}</span>}
      {s.bags?.length ? <span className="flight-line-bags muted">Equipaje según Google: {s.bags.join(" · ")}</span> : null}
    </span>
  );
}

/** Ida (y vuelta) del vuelo de un tramo; sin datos de equipaje lo decimos. */
export function FlightInfoBlock({ f, roundTrip, compact = false }: { f: FlightInfo; roundTrip: boolean; compact?: boolean }) {
  const anyBags = Boolean(f.out.bags?.length || f.back?.bags?.length);
  return (
    <span className="flight-info">
      <FlightLine label={roundTrip ? "Ida" : "Vuelo"} s={f.out} />
      {f.back && <FlightLine label="Vuelta" s={f.back} />}
      {!anyBags && !compact && <span className="flight-line-bags muted">Equipaje: la tarifa no informa qué incluye.</span>}
    </span>
  );
}

/** Una línea sobre cuotas: no tenemos una fuente gratis con ofertas de cuotas. */
export function InstallmentsNote({ despegarUrl }: { despegarUrl: string | null }) {
  return (
    <p className="small muted installments">
      ¿Cuotas? Las agencias argentinas (Despegar, Turismocity) suelen ofrecerlas en pesos; el precio en cuotas puede ser distinto.
      {despegarUrl && (
        <>
          {" "}
          <a href={despegarUrl} target="_blank" rel="noreferrer">
            Ver este vuelo en Despegar
          </a>
        </>
      )}
    </p>
  );
}
