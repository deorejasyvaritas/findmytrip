import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { FlightResult, ItemQuote, LegResult, Party, RealHotel, StayOption, TripLeg, TripPackage, TripPlan } from "../../shared/types.ts";
import { aviasalesForParty } from "../../shared/links.ts";
import { priceLabel } from "../../shared/price-age.ts";
import { airlineName } from "../../shared/airlines.ts";
import { DEFAULT_PARTY, describeParty, fareUnits, headcount, partyFromParams, partyToParams, roomsForParty } from "../../shared/pricing.ts";
import { hotelDistanceKm, hotelLinks } from "../../shared/hotel-links.ts";
import { estimateTrip } from "../../shared/compare.ts";
import { groundSeats, groundTotal } from "../../shared/ground.ts";
import { FlightForm, HotelForm, MultiForm, TripForm, readPlace, readStop, type SearchKind } from "../components/FullSearch.tsx";
import Icon from "../components/Icon.tsx";
import Segmented from "../components/Segmented.tsx";
import WatchButton from "../components/WatchButton.tsx";
import { ClimateLine } from "../components/Climate.tsx";
import { EntryLine } from "../components/EntryRequirements.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate } from "../lib/format.ts";

// Resultados del buscador completo. Los precios de vuelos son los que vieron
// usuarios de Aviasales en los últimos días; cada uno lleva a Aviasales para
// confirmarlo en vivo.

const TITLES: Record<SearchKind, string> = {
  vuelos: "Vuelos",
  hoteles: "Hoteles",
  paquete: "Vuelo + Hotel",
  multi: "Multidestino",
  viaje: "Tu viaje",
};

const shortDate = (iso: string) => formatDate(iso.slice(0, 10), { weekday: "short", day: "numeric", month: "short" });
const hhmm = (iso: string) => iso.slice(11, 16);
const durationLabel = (min: number | null) => (min ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : null);
const stopsLabel = (n: number | null) => (n == null ? "Escalas sin dato" : n === 0 ? "Directo" : n === 1 ? "1 escala" : `${n} escalas`);
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function SearchPage() {
  const [params] = useSearchParams();
  const kind = (params.get("tipo") as SearchKind) || "vuelos";
  const [editing, setEditing] = useState(false);
  const party = partyFromParams(params, DEFAULT_PARTY);
  const from = readPlace(params.get("from"));
  const to = readPlace(params.get("to"));
  const depart = params.get("depart") ?? "";
  const ret = params.get("ret");

  useEffect(() => {
    setEditing(false);
  }, [params]);

  const tripStops = params.getAll("stop").map(readStop).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const summary =
    kind === "viaje"
      ? `${tripStops.map((t) => `${t.name} (${t.nights} ${t.nights === 1 ? "noche" : "noches"})`).join(", ")} · desde ${depart && shortDate(depart)} · ${describeParty(party)}`
      : kind === "multi"
      ? `${params.getAll("leg").length} tramos · ${describeParty(party)}`
      : kind === "hoteles"
        ? `${to?.label ?? ""} · ${depart && shortDate(depart)} al ${ret && shortDate(ret)} · ${describeParty(party)}`
        : `${from?.code ?? ""} a ${to?.code ?? ""} · ${depart && shortDate(depart)}${ret ? ` al ${shortDate(ret)}` : ", solo ida"} · ${describeParty(party)}`;

  return (
    <div className="stack-lg">
      <section className="search-head">
        <Link to="/" className="back">
          <Icon name="chevronLeft" size={22} />
          Explorar
        </Link>
        <div className="search-head-row">
          <div>
            <h1>{TITLES[kind]}</h1>
            <p className="muted">{summary}</p>
          </div>
          <button className="secondary" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            <Icon name="sliders" size={18} />
            {editing ? "Cerrar" : "Modificar búsqueda"}
          </button>
        </div>
        {editing && (
          <div className="search-panel compact">
            {kind === "hoteles" ? <HotelForm /> : kind === "multi" ? <MultiForm /> : kind === "viaje" ? <TripForm /> : <FlightForm kind={kind} />}
          </div>
        )}
      </section>

      {kind === "vuelos" && from && to && depart && <FlightResults origin={from.code} dest={to.code} depart={depart} ret={ret} />}
      {kind === "paquete" && from && to && depart && ret && <PackageResults />}
      {kind === "hoteles" && to && depart && ret && <HotelResults place={to.code} name={to.label} checkin={depart} checkout={ret} party={party} />}
      {kind === "multi" && <MultiResults />}
      {kind === "viaje" && from && depart && tripStops.length > 0 && <TripResults />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vuelos
// ---------------------------------------------------------------------------

type Sort = "price" | "fast" | "best";
type Band = "madrugada" | "manana" | "tarde" | "noche";
const BANDS: { id: Band; label: string; from: number; to: number }[] = [
  { id: "madrugada", label: "Madrugada (0 a 6)", from: 0, to: 6 },
  { id: "manana", label: "Mañana (6 a 12)", from: 6, to: 12 },
  { id: "tarde", label: "Tarde (12 a 18)", from: 12, to: 18 },
  { id: "noche", label: "Noche (18 a 24)", from: 18, to: 24 },
];

interface FlightData {
  results: FlightResult[];
  strip: { date: string; price: number }[];
  live: boolean;
  destinationId: string | null;
}

function useFlights(origin: string, dest: string, depart: string, ret: string | null, direct: boolean) {
  const [data, setData] = useState<FlightData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .searchFlights({ origin, dest, depart, ...(ret ? { ret } : {}), ...(direct ? { direct: 1 as const } : {}) })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [origin, dest, depart, ret, direct]);
  return { data, error };
}

const totalMinutes = (r: FlightResult) => (r.durationOut ?? 9999) + (r.durationBack ?? 0);
const maxStops = (r: FlightResult) => Math.max(r.stops ?? 3, r.returnAt ? (r.returnStops ?? 3) : 0);

function FlightResults({ origin, dest, depart, ret }: { origin: string; dest: string; depart: string; ret: string | null }) {
  const [params, setParams] = useSearchParams();
  const { money, meta } = useApp();
  const party = partyFromParams(params, DEFAULT_PARTY);
  const direct = params.get("direct") === "1";
  const { data, error } = useFlights(origin, dest, depart, ret, direct);
  const [sort, setSort] = useState<Sort>("best");
  const [stops, setStops] = useState<"any" | "0" | "1">(direct ? "0" : "any");
  const [airlines, setAirlines] = useState<Set<string>>(new Set());
  const [bands, setBands] = useState<Set<Band>>(new Set());
  const [maxPrice, setMaxPrice] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const units = fareUnits(party);

  const airlineOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.results ?? []) if (r.airline) m.set(r.airline, Math.min(m.get(r.airline) ?? Infinity, r.price));
    return [...m.entries()].sort((a, b) => a[1] - b[1]);
  }, [data]);

  const list = useMemo(() => {
    const rows = (data?.results ?? []).filter((r) => {
      if (stops !== "any" && maxStops(r) > Number(stops)) return false;
      if (airlines.size && (!r.airline || !airlines.has(r.airline))) return false;
      if (maxPrice && r.price > maxPrice) return false;
      if (bands.size) {
        const h = Number(r.departAt.slice(11, 13));
        if (![...bands].some((b) => BANDS.some((x) => x.id === b && h >= x.from && h < x.to))) return false;
      }
      return true;
    });
    const best = (r: FlightResult) => r.price * (1 + 0.12 * maxStops(r)) + totalMinutes(r) * 0.4;
    return rows.sort((a, b) => (sort === "price" ? a.price - b.price : sort === "fast" ? totalMinutes(a) - totalMinutes(b) : best(a) - best(b)));
  }, [data, stops, airlines, bands, maxPrice, sort]);

  const activeFilters = (stops !== "any" ? 1 : 0) + (airlines.size ? 1 : 0) + (bands.size ? 1 : 0) + (maxPrice ? 1 : 0);
  const prices = (data?.results ?? []).map((r) => r.price);
  const priceSteps = prices.length ? [...new Set([0.25, 0.5, 0.75].map((p) => Math.ceil(Math.min(...prices) + (Math.max(...prices) - Math.min(...prices)) * p)))] : [];
  const liveUrl = `/vuelos.html?${new URLSearchParams({ from: origin, to: dest, depart, ...(ret ? { ret } : {}) })}`;

  function moveTo(date: string) {
    const nights = ret ? Math.round((Date.parse(ret) - Date.parse(depart)) / 86400000) : null;
    params.set("depart", date);
    if (nights != null) params.set("ret", plusDays(date, nights));
    setParams(params);
  }

  if (error) return <ErrorCard message={error} />;

  return (
    <div className="stack">
      {data && data.strip.length > 1 && (
        <div className="strip" role="list" aria-label="Precio por día de salida">
          {data.strip.map((d) => (
            <button
              key={d.date}
              role="listitem"
              className={`strip-day ${d.date === depart ? "on" : ""} ${d.price === Math.min(...data.strip.map((x) => x.price)) ? "cheap" : ""}`}
              onClick={() => moveTo(d.date)}
              aria-current={d.date === depart ? "date" : undefined}
              ref={
                d.date === depart
                  ? (el) => {
                      el?.scrollIntoView({ block: "nearest", inline: "center" });
                    }
                  : undefined
              }
            >
              <span>{capitalize(shortDate(d.date))}</span>
              <strong>{money(d.price)}</strong>
            </button>
          ))}
        </div>
      )}

      <div className="results-layout">
        <aside className={`filters ${showFilters ? "open" : ""}`} aria-label="Filtros">
          <div className="filters-head">
            <h2>Filtros</h2>
            {activeFilters > 0 && (
              <button className="plain" onClick={() => (setStops("any"), setAirlines(new Set()), setBands(new Set()), setMaxPrice(0))}>
                Limpiar
              </button>
            )}
          </div>
          <fieldset>
            <legend>Escalas</legend>
            {(
              [
                ["any", "Cualquiera"],
                ["0", "Solo directos"],
                ["1", "Hasta 1 escala"],
              ] as const
            ).map(([v, l]) => (
              <label key={v} className="check">
                <input type="radio" name="stops" checked={stops === v} onChange={() => setStops(v)} />
                {l}
              </label>
            ))}
          </fieldset>
          {airlineOptions.length > 1 && (
            <fieldset>
              <legend>Aerolíneas</legend>
              {airlineOptions.map(([code, p]) => (
                <label key={code} className="check">
                  <input
                    type="checkbox"
                    checked={airlines.has(code)}
                    onChange={(e) => {
                      const next = new Set(airlines);
                      if (e.target.checked) next.add(code);
                      else next.delete(code);
                      setAirlines(next);
                    }}
                  />
                  <span className="grow">{airlineName(code)}</span>
                  <span className="small muted">{money(p)}</span>
                </label>
              ))}
            </fieldset>
          )}
          <fieldset>
            <legend>Horario de salida</legend>
            {BANDS.map((b) => (
              <label key={b.id} className="check">
                <input
                  type="checkbox"
                  checked={bands.has(b.id)}
                  onChange={(e) => {
                    const next = new Set(bands);
                    if (e.target.checked) next.add(b.id);
                    else next.delete(b.id);
                    setBands(next);
                  }}
                />
                {b.label}
              </label>
            ))}
          </fieldset>
          {priceSteps.length > 0 && (
            <fieldset>
              <legend>Precio por adulto</legend>
              <select value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))}>
                <option value={0}>Sin tope</option>
                {priceSteps.map((p) => (
                  <option key={p} value={p}>
                    Hasta {money(p)}
                  </option>
                ))}
              </select>
            </fieldset>
          )}
        </aside>

        <section className="stack" aria-live="polite">
          <div className="results-bar">
            <Segmented
              label="Ordenar"
              value={sort}
              onChange={setSort}
              options={[
                { value: "best", label: "Recomendado" },
                { value: "price", label: "Más barato" },
                { value: "fast", label: "Más rápido" },
              ]}
            />
            <button className="secondary filters-toggle" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
              <Icon name="sliders" size={16} />
              Filtros{activeFilters ? ` (${activeFilters})` : ""}
            </button>
          </div>

          {!data && Array.from({ length: 4 }, (_, i) => <div key={i} className="card skeleton flight-skeleton" aria-hidden="true" />)}

          {data && (
            <p className="small muted">
              {list.length
                ? `${list.length} ${list.length === 1 ? "opción" : "opciones"} · precios vistos en Aviasales en los últimos días, por adulto. Confirmalos en vivo antes de comprar.`
                : ""}
            </p>
          )}

          {data && list.length === 0 && (
            <div className="card empty">
              <Icon name="plane" size={28} />
              <p>
                {data.results.length
                  ? "Ningún vuelo coincide con esos filtros. Probá quitar alguno."
                  : data.strip.length
                    ? "Todavía no hay precios vistos para este día. Probá otro de la franja de arriba o buscalo en vivo."
                    : "Todavía no hay precios vistos para estas fechas. Buscalo en vivo: Aviasales consulta a las aerolíneas en el momento."}
              </p>
              <a className="button primary" href={liveUrl}>
                Buscar en vivo en Aviasales
              </a>
            </div>
          )}

          {list.map((r) => (
            <FlightCard key={`${r.flightNumber}-${r.departAt}-${r.returnAt}`} r={r} units={units} party={party} money={money} />
          ))}

          {data && list.length > 0 && (
            <div className="results-foot">
              <a className="button secondary" href={liveUrl}>
                <Icon name="search" size={16} />
                Ver todos los vuelos en vivo
              </a>
              {data.destinationId && (
                <Link className="button secondary" to={`/destino/${data.destinationId}?month=${depart.slice(0, 7)}&depart=${depart}`}>
                  Armar el viaje completo en {meta ? "la ficha del destino" : "el destino"}
                </Link>
              )}
            </div>
          )}
          {data && list.length > 0 && <FlightWatch destinationId={data.destinationId} price={Math.min(...list.map((r) => r.price))} />}
        </section>
      </div>
    </div>
  );
}

/**
 * "Avisarme si baja" para vuelos de ida y vuelta a un destino del catálogo.
 * La alerta mira el viaje (vuelo, equipaje y alojamiento estimado), como en la ficha.
 */
function FlightWatch({ destinationId, price }: { destinationId: string | null; price: number }) {
  const [params] = useSearchParams();
  const { destinations, profile, money } = useApp();
  const dest = destinationId ? destinations.find((d) => d.id === destinationId) : undefined;
  const depart = params.get("depart") ?? "";
  const ret = params.get("ret");
  if (!dest || !depart || !ret) return null;
  const party = partyFromParams(params, DEFAULT_PARTY);
  const nights = Math.max(1, Math.round((Date.parse(ret) - Date.parse(depart)) / 86400000));
  const month = Number(depart.slice(5, 7));
  const trip = estimateTrip(dest, price, month, nights, party, profile.style);
  return (
    <div className="card flight-watch">
      <span className="grow">
        <strong>¿Querés esperar a que baje?</strong>
        <span className="small muted">
          Visto en los últimos días: vuelo desde {money(price)} por adulto. Con alojamiento estimado para {nights} noches, el viaje sale unos {money(trip.total)}.
        </span>
      </span>
      <WatchButton
        destinationId={dest.id}
        name={dest.name}
        targetUSD={trip.total}
        month={month}
        nights={nights}
        party={party}
        style={profile.style}
        variant="button"
      />
    </div>
  );
}

function Leg({ label, at, duration, stops }: { label: string; at: string; duration: number | null; stops: number | null }) {
  return (
    <div className="leg-row">
      <span className="leg-label">{label}</span>
      <span className="leg-date">{capitalize(shortDate(at))}</span>
      <strong className="leg-time">{hhmm(at)}</strong>
      <span className="leg-meta">
        {[durationLabel(duration), stopsLabel(stops)].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

export function FlightCard({
  r,
  units,
  party,
  money,
  selected,
  onSelect,
}: {
  r: FlightResult;
  units: number;
  /** Grupo: el link a Aviasales se abre para todos (la Data API lo trae para 1 adulto). */
  party: Party;
  money: (n: number) => string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const name = airlineName(r.airline) ?? "Aerolínea sin dato";
  const link = aviasalesForParty(r.link, party);
  return (
    <article className={`card flight ${selected ? "on" : ""}`}>
      <div className="flight-airline">
        {r.airline && <img src={`https://pics.avs.io/64/64/${r.airline}.png`} alt="" width={32} height={32} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />}
        <span>{name}</span>
      </div>
      <div className="flight-legs">
        <Leg label="Ida" at={r.departAt} duration={r.durationOut} stops={r.stops} />
        {r.returnAt && <Leg label="Vuelta" at={r.returnAt} duration={r.durationBack} stops={r.returnStops} />}
      </div>
      <div className="flight-price">
        <span className="price">{money(r.price)}</span>
        <span className="small muted">por adulto</span>
        {units !== 1 && <span className="small">Total {money(Math.round(r.price * units))}</span>}
        {onSelect ? (
          <button className={selected ? "primary" : "secondary"} onClick={onSelect} aria-pressed={selected}>
            {selected ? "Elegido" : "Elegir"}
          </button>
        ) : (
          link && (
            <a className="button primary" href={link} target="_blank" rel="noreferrer sponsored">
              Ver en Aviasales <Icon name="external" size={14} />
            </a>
          )
        )}
      </div>
    </article>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card empty" role="alert">
      <Icon name="info" size={28} />
      <p>No pudimos buscar: {message}</p>
      <button className="secondary" onClick={() => location.reload()}>
        Reintentar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hoteles
// ---------------------------------------------------------------------------

interface HotelData {
  destinationId: string | null;
  name: string;
  nights: number;
  rooms: number;
  hotels: RealHotel[];
  options: StayOption[];
  links: { label: string; url: string }[];
}

function useHotels(place: string, name: string, checkin: string, checkout: string, party: Party) {
  const [data, setData] = useState<HotelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Edades de los chicos: los links a Booking, Expedia y Airbnb se abren para el grupo real.
  const partyKey = JSON.stringify(partyToParams(party));
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .searchHotels({ place, name: name.split(",")[0].replace(/\s*\([A-Z]{3}\)$/, ""), checkin, checkout, travelers: headcount(party), ...partyToParams(party) })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, name, checkin, checkout, partyKey]);
  return { data, error };
}

function HotelResults(p: { place: string; name: string; checkin: string; checkout: string; party: Party }) {
  const { money } = useApp();
  const { data, error } = useHotels(p.place, p.name, p.checkin, p.checkout, p.party);
  const [sort, setSort] = useState<"price" | "rating">("price");
  const [minRating, setMinRating] = useState(0);
  if (error) return <ErrorCard message={error} />;
  if (!data) return <HotelSkeleton />;
  const hotels = data.hotels
    .filter((h) => (h.rating ?? 0) >= minRating)
    .sort((a, b) => (sort === "price" ? a.nightlyUSD - b.nightlyUSD : (b.rating ?? 0) - (a.rating ?? 0)));

  return (
    <div className="stack">
      {data.hotels.length > 0 && (
        <div className="results-bar">
          <Segmented
            label="Ordenar"
            value={sort}
            onChange={setSort}
            options={[
              { value: "price", label: "Más barato" },
              { value: "rating", label: "Mejor puntuado" },
            ]}
          />
          <select className="inline" aria-label="Puntuación mínima" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
            <option value={0}>Cualquier puntuación</option>
            <option value={4}>4 o más</option>
            <option value={4.5}>4,5 o más</option>
          </select>
        </div>
      )}
      {data.hotels.length > 0 ? (
        <>
          <p className="small muted">
            {hotels.length} hoteles · {data.nights} noches · {data.rooms} {data.rooms === 1 ? "habitación" : "habitaciones"} · el mejor precio entre Booking, Agoda,
            Expedia y más
          </p>
          <div className="hotel-results">
            {hotels.map((h) => (
              <HotelCard key={h.name} h={h} rooms={data.rooms} money={money} />
            ))}
          </div>
        </>
      ) : (
        <div className="card empty">
          <Icon name="bed" size={28} />
          <p>
            {data.destinationId
              ? "No conseguimos precios para esas fechas. Probá compararlos directo:"
              : `Todavía no tenemos precios propios para ${data.name}. Compará directo con tus fechas:`}
          </p>
        </div>
      )}
      <div className="results-foot">
        <span className="small muted">Compará en:</span>
        {data.links.map((l) => (
          <a key={l.label} className="pill-link" href={l.url} target="_blank" rel="noreferrer">
            {l.label} <Icon name="external" size={14} />
          </a>
        ))}
      </div>
      <p className="small muted">FindMyTrip no realiza reservas de alojamiento: la contratación se hace con el proveedor.</p>
    </div>
  );
}

/** Foto del hotel; si no carga, queda el recuadro gris (con estado de React, sin tocar el DOM a mano). */
function HotelThumb({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <div className="hotel-card-img" aria-hidden="true" />;
  return <img src={src} alt="" width={320} height={140} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function HotelCard({ h, rooms, money, selected, onSelect }: { h: RealHotel; rooms: number; money: (n: number) => string; selected?: boolean; onSelect?: () => void }) {
  return (
    <article className={`card hotel-card ${selected ? "on" : ""}`}>
      <HotelThumb src={h.thumbnail} />
      <div className="stack-sm grow">
        <strong>{h.name}</strong>
        {h.rating != null && (
          <span className="small muted">
            Puntuación {h.rating.toLocaleString("es-AR")}
            {h.reviews ? ` · ${h.reviews.toLocaleString("es-AR")} opiniones` : ""}
          </span>
        )}
        <span className="price">{money(h.totalUSD * rooms)}</span>
        <span className="small muted">
          {money(h.nightlyUSD)} por noche{h.site ? ` en ${h.site}` : ""}
        </span>
      </div>
      {onSelect ? (
        <button className={selected ? "primary" : "secondary"} onClick={onSelect} aria-pressed={selected}>
          {selected ? "Elegido" : "Elegir"}
        </button>
      ) : (
        h.link && (
          <a className="button secondary" href={h.link} target="_blank" rel="noreferrer">
            Ver hotel <Icon name="external" size={14} />
          </a>
        )
      )}
    </article>
  );
}

function HotelSkeleton() {
  return (
    <div className="hotel-results" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card skeleton flight-skeleton" aria-hidden="true" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vuelo + Hotel
// ---------------------------------------------------------------------------

function PackageResults() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const app = useApp();
  const { money, profile } = app;
  const party = partyFromParams(params, DEFAULT_PARTY);
  const from = readPlace(params.get("from"))!;
  const to = readPlace(params.get("to"))!;
  const depart = params.get("depart")!;
  const ret = params.get("ret")!;
  const flights = useFlights(from.code, to.code, depart, ret, params.get("direct") === "1");
  const hotels = useHotels(to.code, to.label, depart, ret, party);
  const [flightKey, setFlightKey] = useState<string | null>(null);
  const [hotelName, setHotelName] = useState<string | null>(null);
  const units = fareUnits(party);

  const flightList = (flights.data?.results ?? []).slice(0, 6);
  const keyOf = (r: FlightResult) => `${r.flightNumber}-${r.departAt}-${r.returnAt}`;
  const flight = flightList.find((r) => keyOf(r) === flightKey) ?? flightList[0];
  const hotelList = (hotels.data?.hotels ?? []).slice(0, 8);
  const hotel = hotelList.find((h) => h.name === hotelName) ?? hotelList[Math.floor(hotelList.length / 3)];
  const rooms = hotels.data?.rooms ?? 1;
  const flightTotal = flight ? Math.round(flight.price * units) : 0;
  const hotelTotal = hotel ? hotel.totalUSD * rooms : 0;

  function save() {
    if (!flight || !hotel) return;
    const at = new Date().toISOString();
    const nights = hotels.data?.nights ?? 1;
    const flightQuote: ItemQuote = {
      kind: "exacto",
      source: "aviasales",
      at,
      unitUSD: flight.price,
      units,
      flight: { from: from.code, to: to.code, depart, ret },
    };
    const hotelQuote: ItemQuote = {
      kind: "exacto",
      source: "xotelo",
      at,
      unitUSD: hotel.nightlyUSD,
      units: nights * rooms,
      ...(hotel.key ? { hotel: { key: hotel.key, checkin: depart, checkout: ret } } : {}),
    };
    const pkg: TripPackage = {
      id: `pkg_${Date.now().toString(36)}`,
      destinationId: hotels.data?.destinationId ?? to.code,
      destinationName: to.label.split(",")[0],
      origin: from.code,
      departDate: depart,
      returnDate: ret,
      travelers: headcount(party),
      style: profile.style,
      items: [
        {
          kind: "vuelo",
          label: `Vuelo ${from.code}–${to.code} (${airlineName(flight.airline) ?? "aerolínea sin dato"}, ${describeParty(party)}, USD ${flight.price} por adulto)`,
          amountUSD: flightTotal,
          link: aviasalesForParty(flight.link, party) ?? undefined,
          quote: flightQuote,
        },
        { kind: "alojamiento", label: `${hotel.name} · ${nights} noches`, amountUSD: hotelTotal, link: hotel.link ?? undefined, quote: hotelQuote },
      ],
      totalUSD: flightTotal + hotelTotal,
      createdAt: new Date().toISOString(),
      status: "armando",
    };
    app.savePackage(pkg);
    navigate("/viajes");
  }

  return (
    <div className="package-layout">
      <div className="stack-lg">
        <section className="stack">
          <h2>1. Elegí el vuelo</h2>
          {flights.error && <ErrorCard message={flights.error} />}
          {!flights.data && !flights.error && <div className="card skeleton flight-skeleton" aria-hidden="true" />}
          {flights.data && flightList.length === 0 && (
            <div className="card empty">
              <Icon name="plane" size={28} />
              <p>Todavía no hay precios vistos para estas fechas. Buscalo en vivo y sumá el hotel igual.</p>
              <a className="button primary" href={`/vuelos.html?${new URLSearchParams({ from: from.code, to: to.code, depart, ret })}`}>
                Buscar en vivo en Aviasales
              </a>
            </div>
          )}
          {flightList.map((r) => (
            <FlightCard key={keyOf(r)} r={r} units={units} party={party} money={money} selected={flight === r} onSelect={() => setFlightKey(keyOf(r))} />
          ))}
        </section>
        <section className="stack">
          <h2>2. Elegí dónde dormir</h2>
          {hotels.error && <ErrorCard message={hotels.error} />}
          {!hotels.data && !hotels.error && <HotelSkeleton />}
          {hotels.data && hotelList.length === 0 && (
            <div className="card empty">
              <Icon name="bed" size={28} />
              <p>Todavía no tenemos precios de hoteles para {hotels.data.name}. Compará directo con tus fechas:</p>
              <div className="row gap">
                {hotels.data.links.map((l) => (
                  <a key={l.label} className="pill-link" href={l.url} target="_blank" rel="noreferrer">
                    {l.label} <Icon name="external" size={14} />
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="hotel-results">
            {hotelList.map((h) => (
              <HotelCard key={h.name} h={h} rooms={rooms} money={money} selected={hotel === h} onSelect={() => setHotelName(h.name)} />
            ))}
          </div>
        </section>
      </div>
      <aside className="card summary">
        <h2>Tu paquete</h2>
        <p className="small muted">
          {shortDate(depart)} al {shortDate(ret)} · {describeParty(party)}
        </p>
        <ul className="items">
          <li>
            <span className="label">
              <Icon name="plane" size={16} />
              {flight ? airlineName(flight.airline) ?? "Vuelo" : "Vuelo sin elegir"}
            </span>
            <span>{flight ? money(flightTotal) : "—"}</span>
          </li>
          <li>
            <span className="label">
              <Icon name="bed" size={16} />
              {hotel ? hotel.name : "Hotel sin elegir"}
            </span>
            <span>{hotel ? money(hotelTotal) : "—"}</span>
          </li>
        </ul>
        <div className="total">
          <span className="headline">Total</span>
          <span className="price">{money(flightTotal + hotelTotal)}</span>
        </div>
        <p className="small muted">
          Vuelo visto en Aviasales en los últimos días; hotel con la tarifa más baja que vimos entre varios sitios. Se reservan por separado y pueden cambiar.
        </p>
        <button className="primary full" disabled={!flight || !hotel} onClick={save}>
          <Icon name="bookmark" size={18} />
          Guardar en Mis viajes
        </button>
        {flight?.link && (
          <a className="button secondary full" href={aviasalesForParty(flight.link, party)!} target="_blank" rel="noreferrer sponsored">
            Ver el vuelo en Aviasales <Icon name="external" size={14} />
          </a>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multidestino
// ---------------------------------------------------------------------------

function MultiResults() {
  const [params] = useSearchParams();
  const { money } = useApp();
  const party = partyFromParams(params, DEFAULT_PARTY);
  const units = fareUnits(party);
  const legs = params
    .getAll("leg")
    .map((raw) => {
      const [a, b, date] = raw.split("~");
      const o = readPlace(a);
      const d = readPlace(b);
      return o && d && date ? { origin: o, destination: d, date } : null;
    })
    .filter((l): l is NonNullable<typeof l> => Boolean(l));
  const legsKey = legs.map((l) => `${l.origin.code}${l.destination.code}${l.date}`).join(",");
  const [data, setData] = useState<LegResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<number, number>>({});

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setPicked({});
    if (legs.length < 2) return;
    api
      .searchMulti(legs.map((l) => ({ origin: l.origin.code, destination: l.destination.code, date: l.date })))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legsKey]);

  if (legs.length < 2) return <ErrorCard message="Faltan tramos en la búsqueda." />;
  if (error) return <ErrorCard message={error} />;
  const chosen = (data ?? []).map((l, i) => l.options[picked[i] ?? 0]);
  const complete = data != null && chosen.every(Boolean);
  const total = chosen.reduce((s, r) => s + (r ? Math.round(r.price * units) : 0), 0);

  return (
    <div className="package-layout">
      <div className="stack-lg">
        {legs.map((l, i) => {
          const leg = data?.[i];
          const live = `/vuelos.html?${new URLSearchParams({ from: l.origin.code, to: l.destination.code, depart: l.date })}`;
          return (
            <section key={i} className="stack">
              <h2>
                Tramo {i + 1}: {l.origin.code} a {l.destination.code}
                <span className="small muted"> · {capitalize(shortDate(l.date))}</span>
              </h2>
              {!leg && <div className="card skeleton flight-skeleton" aria-hidden="true" />}
              {leg && leg.options.length === 0 && (
                <div className="card empty">
                  <Icon name="plane" size={28} />
                  <p>Sin precios vistos para este tramo en esa fecha.</p>
                  <a className="button secondary" href={live}>
                    Buscar este tramo en vivo
                  </a>
                </div>
              )}
              {leg?.options.map((r, j) => (
                <FlightCard key={j} r={r} units={units} party={party} money={money} selected={(picked[i] ?? 0) === j} onSelect={() => setPicked((p) => ({ ...p, [i]: j }))} />
              ))}
            </section>
          );
        })}
      </div>
      <aside className="card summary">
        <h2>Tu recorrido</h2>
        <p className="small muted">{describeParty(party)}</p>
        <ul className="items">
          {legs.map((l, i) => (
            <li key={i}>
              <span className="label">
                <Icon name="plane" size={16} />
                {l.origin.code} a {l.destination.code}
              </span>
              <span>{chosen[i] ? money(Math.round(chosen[i]!.price * units)) : "—"}</span>
            </li>
          ))}
        </ul>
        <div className="total">
          <span className="headline">Total</span>
          <span className="price">{complete ? money(total) : "—"}</span>
        </div>
        <p className="small muted">
          Cada tramo se compra por separado. Dejá margen entre vuelos: si uno se demora, la otra aerolínea no está obligada a esperarte.
        </p>
        {chosen.map(
          (r, i) =>
            r?.link && (
              <a key={i} className="secondary full" href={aviasalesForParty(r.link, party)!} target="_blank" rel="noreferrer sponsored">
                Comprar tramo {i + 1} en Aviasales <Icon name="external" size={14} />
              </a>
            ),
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Ya sé a dónde": recorrido con vuelos, traslados y alojamiento por parada
// ---------------------------------------------------------------------------

interface StayPick {
  label: string;
  total: number;
  real: boolean;
  link?: string;
  quote?: ItemQuote;
}

/** Lo que devuelve /api/trip/leg al volver a mirar un tramo. */
type LegPatch = Pick<TripLeg, "price" | "priceKind" | "priceDate" | "priceSource" | "airline" | "stops" | "link">;

/** Tramo con lo que se actualizó después de Aviasales y, encima, el precio que cargó el usuario. */
function effectiveLeg(base: TripLeg, patch: LegPatch | undefined, manual: number | undefined): TripLeg {
  const auto = patch ? { ...base, ...patch, link: patch.link ?? base.link } : base;
  return manual != null ? { ...auto, price: manual, priceKind: "manual" } : auto;
}

/** Cuántas veces volvemos a mirar un tramo después de cada visita a Aviasales. */
const MAX_RECHECKS = 2;
const RECHECK_AFTER_MS = 60_000;

function TripResults() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const app = useApp();
  const { money, profile } = app;
  const party = partyFromParams(params, DEFAULT_PARTY);
  const units = fareUnits(party);
  const rooms = roomsForParty(party);
  const from = readPlace(params.get("from"))!;
  const depart = params.get("depart")!;
  const stops = params.getAll("stop").map(readStop).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const key = params.getAll("stop").join(",") + from.code + depart;
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stays, setStays] = useState<Record<number, StayPick | null>>({});
  // Traslados por tierra (estimado): se suman al total salvo que el usuario los saque.
  const [withGround, setWithGround] = useState(true);
  // Precio que cargó el usuario (USD por adulto) y precios que aparecieron al volver de Aviasales, por índice de tramo.
  const [manual, setManual] = useState<Record<number, number>>({});
  const [refreshed, setRefreshed] = useState<Record<number, LegPatch>>({});
  const [updated, setUpdated] = useState<Record<number, boolean>>({});
  const [checking, setChecking] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setError(null);
    setStays({});
    setManual({});
    setRefreshed({});
    setUpdated({});
    api
      .planTrip({ origin: from.code, depart, stops: stops.map(({ name, region, country, lat, lon, nights }) => ({ name, region, country, lat, lon, nights })) })
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const autoLegs = useMemo(() => plan?.legs.map((l, i) => effectiveLeg(l, refreshed[i], undefined)) ?? [], [plan, refreshed]);
  const legs = autoLegs.map((l, i) => (manual[i] != null ? effectiveLeg(l, undefined, manual[i]) : l));

  // "Actualizar después de Aviasales": al tocar "Ver en Aviasales" recordamos el tramo y,
  // cuando el usuario vuelve a la página, lo miramos de nuevo (y una vez más al minuto).
  const autoRef = useRef(autoLegs);
  autoRef.current = autoLegs;
  const pending = useRef<{ idx: number; tries: number; left: boolean; running: boolean; timer?: number } | null>(null);

  const recheck = useCallback(async () => {
    const p = pending.current;
    if (!p || p.running || p.tries >= MAX_RECHECKS) return;
    const leg = autoRef.current[p.idx];
    if (!leg) return;
    p.running = true;
    p.tries++;
    setChecking(p.idx);
    let found = false;
    try {
      const r = await api.tripLeg({ from: leg.from, to: leg.to, date: leg.date, returnDate: leg.returnDate });
      const cur = autoRef.current[p.idx];
      if (pending.current === p && cur && r.price != null && (cur.price == null || cur.priceKind !== "exacto" || r.price < cur.price)) {
        found = true;
        setRefreshed((x) => ({ ...x, [p.idx]: r }));
        setUpdated((x) => ({ ...x, [p.idx]: true }));
      }
    } catch {
      // Sin red o sin respuesta: queda el precio que había.
    }
    p.running = false;
    if (pending.current !== p) return;
    setChecking(null);
    if (!found && p.tries < MAX_RECHECKS) p.timer = window.setTimeout(recheck, RECHECK_AFTER_MS);
    else pending.current = null;
  }, []);

  useEffect(() => {
    const onLeave = () => {
      if (pending.current && document.visibilityState === "hidden") pending.current.left = true;
    };
    const onBlur = () => {
      if (pending.current) pending.current.left = true;
    };
    const onBack = () => {
      const p = pending.current;
      if (p && p.left && p.tries === 0 && document.visibilityState === "visible") void recheck();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? onLeave() : onBack());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onBack);
      if (pending.current?.timer) window.clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, [recheck, plan]);

  function watchLeg(idx: number) {
    if (pending.current?.timer) window.clearTimeout(pending.current.timer);
    pending.current = { idx, tries: 0, left: false, running: false };
    setChecking(null);
    setUpdated((x) => ({ ...x, [idx]: false }));
  }

  if (error)
    return (
      <div className="card empty" role="alert">
        <Icon name="info" size={28} />
        <p>No pudimos armar el viaje: {error}</p>
        <button className="secondary" onClick={() => setAttempt((a) => a + 1)}>
          Reintentar
        </button>
      </div>
    );

  const flights = legs.filter((l) => l.kind === "flight");
  const flightsTotal = flights.reduce((s, l) => s + (l.price ? Math.round(l.price * units) : 0), 0);
  const missingFlights = flights.filter((l) => l.price == null).length;
  const approxFlights = flights.some((l) => l.priceKind === "mes");
  const staysTotal = Object.values(stays).reduce((s, x) => s + (x?.total ?? 0), 0);
  const groundLegs = legs.filter((l) => l.kind === "ground" && l.ground);
  const groundUSD = groundTotal(groundLegs, party);
  const total = flightsTotal + staysTotal + (withGround ? groundUSD : 0);
  const single = stops.length === 1 && stops[0].destinationId;
  // Cada parada tiene que tener un hotel elegido o el estimado a la vista antes de guardar.
  const staysReady = plan != null && plan.stops.every((_, i) => stays[i] != null);

  function save() {
    if (!plan || !staysReady) return;
    const flightNote = (l: TripLeg) => (l.price == null ? " (sin precio)" : l.priceKind === "manual" ? " (precio que cargaste)" : l.priceKind === "mes" ? " (referencia del mes)" : "");
    const at = new Date().toISOString();
    const legQuote = (l: TripLeg): ItemQuote | undefined =>
      l.price == null || !l.priceKind
        ? undefined
        : {
            kind: l.priceKind,
            source: l.priceKind === "manual" ? "manual" : (l.priceSource ?? "aviasales"),
            at: l.priceAt ?? at,
            unitUSD: l.price,
            units,
            priceDate: l.priceDate,
            flight: { from: l.from, to: l.to, depart: l.date, ret: l.returnDate },
          };
    const items: TripPackage["items"] = [
      ...flights.map((l) => ({
        kind: "vuelo" as const,
        label: `${l.label}${flightNote(l)}`,
        amountUSD: l.price ? Math.round(l.price * units) : 0,
        link: aviasalesForParty(l.link, party) ?? undefined,
        quote: legQuote(l),
      })),
      ...plan.stops.map((st, i) => {
        const pick = stays[i]!;
        return {
          kind: "alojamiento" as const,
          label: `${st.name}: ${pick.label} · ${st.nights} noches${pick.real ? "" : " (estimado)"}`,
          amountUSD: pick.total,
          link: pick.link,
          quote: pick.quote,
        };
      }),
      ...(withGround
        ? groundLegs.map((l) => ({
            kind: "extra" as const,
            label: `${l.label}: ${l.ground!.mode} (estimado)`,
            amountUSD: l.ground!.perPerson * groundSeats(party),
            link: l.ground!.rome2rioUrl,
          }))
        : []),
    ];
    app.savePackage({
      id: `pkg_${Date.now().toString(36)}`,
      destinationId: stops[0].destinationId ?? `geo-${stops[0].name}`,
      destinationName: stops.map((x) => x.name).join(" + "),
      origin: from.code,
      departDate: plan.depart,
      returnDate: plan.ret,
      travelers: headcount(party),
      style: profile.style,
      items,
      totalUSD: total,
      createdAt: new Date().toISOString(),
      status: "armando",
    });
    navigate("/viajes");
  }

  // El recorrido intercala vuelos/traslados con las paradas.
  const legCard = (idx: number) => {
    const leg = legs[idx];
    if (!leg) return null;
    return (
      <LegCard
        leg={leg}
        party={party}
        units={units}
        money={money}
        seats={groundSeats(party)}
        checking={checking === idx}
        updated={Boolean(updated[idx])}
        onLive={() => watchLeg(idx)}
        onManual={(usd) =>
          setManual((m) => {
            const next = { ...m };
            if (usd == null) delete next[idx];
            else next[idx] = usd;
            return next;
          })
        }
      />
    );
  };
  const outbound = legs.findIndex((l) => l.role === "out");
  const inbound = legs.findIndex((l) => l.role === "back");
  const after = (i: number) => legs.findIndex((l) => l.role === "between" && l.after === i);

  return (
    <div className="package-layout">
      <div className="stack-lg">
        {single && (
          <Link className="card trip-catalog" to={`/destino/${stops[0].destinationId}?month=${depart.slice(0, 7)}&depart=${depart}&nights=${stops[0].nights}`}>
            <Icon name="compass" size={20} />
            <span className="grow">
              <strong>{stops[0].name} tiene ficha completa</strong>
              <span className="small muted">Calendario de precios por día, cuándo conviene ir, extras y más.</span>
            </span>
            <Icon name="chevronRight" size={18} />
          </Link>
        )}
        {!plan && Array.from({ length: 3 }, (_, i) => <div key={i} className="card skeleton flight-skeleton" aria-hidden="true" />)}
        {plan && (
          <ol className="timeline">
            {outbound >= 0 && legCard(outbound)}
            {plan.stops.map((st, i) => (
              <li key={`${key}-${i}`} className="timeline-stop">
                <StopCard
                  stop={st}
                  index={i}
                  party={party}
                  travelers={headcount(party)}
                  rooms={rooms}
                  style={profile.style}
                  money={money}
                  onPick={(pick) => setStays((x) => ({ ...x, [i]: pick }))}
                />
                {after(i) >= 0 && legCard(after(i))}
              </li>
            ))}
            {inbound >= 0 && legCard(inbound)}
          </ol>
        )}
      </div>
      <aside className="card summary">
        <h2>Tu viaje</h2>
        <p className="small muted">
          {plan ? `${shortDate(plan.depart)} al ${shortDate(plan.ret)} · ` : ""}
          {describeParty(party)}
        </p>
        <ul className="items">
          <li>
            <span className="label">
              <Icon name="plane" size={16} />
              Vuelos{missingFlights ? ` (${missingFlights} sin precio)` : approxFlights ? " (aproximado)" : ""}
            </span>
            {/* Hasta que llega el plan no hay precio: un esqueleto, nunca "USD 0". */}
            <span>{plan ? money(flightsTotal) : <span className="sk sk-price" aria-label="Cargando" />}</span>
          </li>
          {plan?.stops.map((st, i) => (
            <li key={i}>
              <span className="label">
                <Icon name="bed" size={16} />
                {st.name} · {st.nights} {st.nights === 1 ? "noche" : "noches"}
                {stays[i] && !stays[i]!.real ? " (estimado)" : ""}
              </span>
              <span>{stays[i] ? money(stays[i]!.total) : "—"}</span>
            </li>
          ))}
          {groundLegs.length > 0 && (
            <li className={withGround ? "" : "off"}>
              <span className="label">
                <Icon name="pin" size={16} />
                Traslados por tierra (estimado)
              </span>
              <span>{withGround ? money(groundUSD) : <s aria-label={`No sumado: ${money(groundUSD)}`}>{money(groundUSD)}</s>}</span>
            </li>
          )}
        </ul>
        {groundLegs.length > 0 && (
          <label className="check ground-toggle">
            <input type="checkbox" checked={withGround} onChange={(e) => setWithGround(e.target.checked)} />
            Sumar traslados por tierra al total
          </label>
        )}
        <div className="total">
          <span className="headline">Total</span>
          <span className="price">{plan ? money(total) : <span className="sk sk-price sk-total" aria-label="Cargando" />}</span>
        </div>
        <p className="small muted">
          {missingFlights ? "Hay tramos sin precio: buscalos en Aviasales o cargá el precio que viste. " : ""}
          {groundLegs.length > 0
            ? withGround
              ? "Traslados por tierra: pasaje de micro o tren estimado. "
              : "Traslados por tierra no incluidos. "
            : ""}
          Precios de referencia; se reservan por separado.
        </p>
        <button className="primary full" disabled={!staysReady} onClick={save}>
          <Icon name="bookmark" size={18} />
          Guardar en Mis viajes
        </button>
        {plan && !staysReady && <p className="small muted">Falta el alojamiento de alguna parada: esperá a que cargue o reintentá.</p>}
      </aside>
    </div>
  );
}

function legDetail(leg: TripLeg): string {
  if (leg.price == null) return " · todavía sin precio para esa fecha";
  switch (leg.priceKind) {
    case "manual":
      return " · precio que cargaste";
    case "exacto":
      return leg.priceSource === "google"
        ? leg.priceAt
          ? ` · ${priceLabel({ kind: "exacto", source: "google", at: leg.priceAt }).toLowerCase()} en Google Flights`
          : " · precio de Google Flights de las últimas horas"
        : ` · ${[airlineName(leg.airline), stopsLabel(leg.stops)].filter(Boolean).join(" · ")} · visto en los últimos días`;
    case "cercano":
      return ` · precio real saliendo el ${shortDate(leg.priceDate!)}`;
    default:
      return leg.priceDate ? ` · lo más barato del mes, saliendo el ${shortDate(leg.priceDate)}` : " · precio de referencia del mes";
  }
}

function LegCard({
  leg,
  party,
  units,
  money,
  seats,
  checking = false,
  updated = false,
  onLive,
  onManual,
}: {
  leg: TripLeg;
  /** Los links a Aviasales se abren para todo el grupo. */
  party: Party;
  units: number;
  money: (n: number) => string;
  seats: number;
  checking?: boolean;
  updated?: boolean;
  onLive?: () => void;
  onManual?: (usd: number | null) => void;
}) {
  if (leg.kind === "ground") {
    const g = leg.ground;
    return (
      <div className="card trip-leg ground">
        <Icon name="pin" size={18} />
        <span className="grow">
          <strong>{leg.label}</strong>
          <span className="small muted">
            {capitalize(shortDate(leg.date))} · unos {leg.km} km · cerca de {String(leg.hours).replace(".", ",")} h en auto, transfer o micro
          </span>
          {g && (
            <span className="ground-cost small">
              {capitalize(g.mode)} aprox. {money(g.perPerson)} por persona
              {g.transfer != null && <> · Transfer privado aprox. {money(g.transfer)} por vehículo</>}
            </span>
          )}
        </span>
        <span className="trip-leg-price">
          {g && seats > 1 && (
            <>
              <strong>{money(g.perPerson * seats)}</strong>
              <span className="small muted">estimado, {seats} pasajes</span>
            </>
          )}
          <span className="ground-links">
            {leg.mapsUrl && (
              <a className="button secondary" href={leg.mapsUrl} target="_blank" rel="noreferrer">
                Ver ruta <Icon name="external" size={14} />
              </a>
            )}
            {g && (
              <a className="button secondary" href={g.rome2rioUrl} target="_blank" rel="noreferrer">
                Horarios y precios <Icon name="external" size={14} />
              </a>
            )}
          </span>
        </span>
      </div>
    );
  }
  const google = leg.priceSource === "google" && leg.priceKind === "exacto";
  const live = aviasalesForParty(leg.liveUrl, party);
  // Google Flights (link de SerpApi) se abre para 1 adulto: el precio es por adulto.
  const href = (leg.priceKind === "exacto" ? aviasalesForParty(leg.link, party) : live) ?? live ?? "#";
  return (
    <div className="card trip-leg">
      <Icon name="plane" size={18} />
      <span className="grow">
        <strong>{leg.label}</strong>
        <span className="small muted">
          {capitalize(shortDate(leg.date))}
          {leg.returnDate ? ` al ${shortDate(leg.returnDate)}` : ""}
          {legDetail(leg)}
        </span>
        {checking && (
          <span className="leg-note small muted" role="status">
            Mirando si ya aparece el precio de Aviasales
          </span>
        )}
        {updated && !checking && leg.priceKind !== "manual" && (
          <span className="leg-note small" role="status">
            <Icon name="check" size={14} />
            Actualizado con el precio de Aviasales
          </span>
        )}
      </span>
      <span className="trip-leg-price">
        {leg.price != null && (
          <>
            <strong>{money(Math.round(leg.price * units))}</strong>
            <span className="small muted">{money(leg.price)} por adulto</span>
          </>
        )}
        <a className="button secondary" href={href} target="_blank" rel="noreferrer sponsored" onClick={google ? undefined : onLive}>
          {google ? "Ver en Google Flights" : "Ver en Aviasales"} <Icon name="external" size={14} />
        </a>
        {google && live && (
          <a className="leg-action" href={live} target="_blank" rel="noreferrer sponsored" onClick={onLive}>
            Comparar en Aviasales
          </a>
        )}
        {onManual && <ManualPrice leg={leg} onManual={onManual} />}
      </span>
    </div>
  );
}

/** "254", "254,50", "254.50", "350.000" o "350.000,50" a número (la coma siempre es decimal). */
function parseAmount(raw: string): number {
  const s = raw.trim();
  if (!s) return NaN;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  // Solo puntos: con 1 o 2 decimales es un decimal ("254.5"); si no, separador de miles ("350.000").
  return /\.\d{1,2}$/.test(s) && (s.match(/\./g) ?? []).length === 1 ? Number(s) : Number(s.replace(/\./g, ""));
}

/** "Cargar el precio que viste": el usuario anota el precio por adulto en la moneda que está viendo. */
function ManualPrice({ leg, onManual }: { leg: TripLeg; onManual: (usd: number | null) => void }) {
  const { profile, toUSD, fromUSD } = useApp();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const unit = profile.currency === "ARS" ? "$" : "USD";
  const manual = leg.priceKind === "manual";

  if (manual && !open) {
    return (
      <span className="leg-actions">
        <button type="button" className="leg-action" onClick={() => (setValue(String(fromUSD(leg.price!))), setOpen(true))}>
          Cambiar
        </button>
        <button type="button" className="leg-action" onClick={() => onManual(null)}>
          Quitar el precio cargado
        </button>
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" className="leg-action" onClick={() => (setValue(leg.price != null ? String(fromUSD(leg.price)) : ""), setOpen(true))}>
        Cargar el precio que viste
      </button>
    );
  }
  const amount = parseAmount(value);
  const valid = Number.isFinite(amount) && amount > 0;
  return (
    <form
      className="manual-price"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onManual(Math.max(1, Math.round(toUSD(amount))));
        setOpen(false);
      }}
    >
      <label className="field">
        Precio por adulto
        <span className="manual-price-input">
          <span aria-hidden="true">{unit}</span>
          <input
            autoFocus
            inputMode="decimal"
            aria-label={`Precio por adulto en ${unit === "$" ? "pesos" : "dólares"}`}
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
          />
        </span>
      </label>
      <span className="leg-actions">
        <button type="submit" className="primary" disabled={!valid}>
          Usar este precio
        </button>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </span>
    </form>
  );
}

type TripHotels = Awaited<ReturnType<typeof api.tripHotels>>;

function StopCard({
  stop,
  index,
  party,
  travelers,
  rooms,
  style,
  money,
  onPick,
}: {
  stop: TripPlan["stops"][number];
  index: number;
  party: Party;
  travelers: number;
  rooms: number;
  style: string;
  money: (n: number) => string;
  onPick: (p: StayPick | null) => void;
}) {
  const [data, setData] = useState<TripHotels | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    onPick(null);
    api
      .tripHotels({ name: stop.name, country: stop.country, lat: stop.lat, lon: stop.lon, checkin: stop.checkin, nights: stop.nights, travelers, rooms, style, ...partyToParams(party) })
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.name, stop.checkin, stop.nights, travelers, rooms, attempt]);

  const hotels = (data?.hotels ?? []).slice(0, 6);
  const choice = hotels.find((h) => h.name === picked) ?? hotels[Math.floor(hotels.length / 3)];

  useEffect(() => {
    if (!data) return;
    const at = new Date().toISOString();
    const units = stop.nights * rooms;
    if (choice)
      onPick({
        label: choice.name,
        total: choice.totalUSD * rooms,
        real: true,
        link: choice.link ?? choice.tripadvisorUrl ?? undefined,
        quote: {
          kind: "exacto",
          source: data.source === "google" ? "google" : "xotelo",
          at,
          unitUSD: choice.nightlyUSD,
          units,
          ...(choice.key ? { hotel: { key: choice.key, checkin: stop.checkin, checkout: stop.checkout } } : {}),
        },
      });
    else
      onPick({
        label: "alojamiento",
        total: data.estimateNight * units,
        real: false,
        quote: { kind: "estimado", source: "estimado", at, unitUSD: data.estimateNight, units },
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, choice?.name, rooms]);

  return (
    <section className="card trip-stop" aria-label={`Parada ${index + 1}: ${stop.name}`}>
      <div className="trip-stop-head">
        <span className="leg-n" aria-hidden="true">
          {index + 1}
        </span>
        <div className="grow">
          <h3>{stop.name}</h3>
          <p className="small muted">
            {[stop.region, stop.country].filter(Boolean).join(", ")} · {stop.nights} {stop.nights === 1 ? "noche" : "noches"} · {shortDate(stop.checkin)} al{" "}
            {shortDate(stop.checkout)}
          </p>
          {stop.airport && (
            <p className="small muted">
              Aeropuerto más conveniente: {stop.airport.name} ({stop.airport.code}){stop.airport.km > 15 ? `, a ${stop.airport.km} km` : ""}
            </p>
          )}
        </div>
      </div>

      <div className="stop-info">
        <ClimateLine lat={stop.lat} lon={stop.lon} date={stop.checkin} />
        <EntryLine country={stop.country} />
      </div>

      {!data && !failed && <div className="sk" style={{ width: "100%", height: 72 }} aria-hidden="true" />}
      {failed && (
        <div className="trip-estimate" role="alert">
          <p className="small muted">No pudimos traer los alojamientos de {stop.name}.</p>
          <button className="secondary" onClick={() => setAttempt((a) => a + 1)}>
            <Icon name="refresh" size={16} />
            Reintentar
          </button>
        </div>
      )}
      {data && hotels.length > 0 && (
        <p className="small muted">
          Precios reales {data.source === "google" ? "de Google Hotels" : "comparados entre Booking, Agoda, Expedia y más"} para tus fechas
          {rooms > 1 ? `, ${rooms} habitaciones` : ""}. Elegí uno:
        </p>
      )}
      {data && hotels.length > 0 && (
        <div className="hotel-results">
          {hotels.map((h) => (
            <TripHotelCard key={h.name} h={h} stop={stop} rooms={rooms} money={money} selected={choice === h} onSelect={() => setPicked(h.name)} />
          ))}
        </div>
      )}
      {data && hotels.length === 0 && (
        <div className="trip-estimate">
          <p>
            Alojamiento estimado: <strong>{money(data.estimateNight * stop.nights * rooms)}</strong>{" "}
            <span className="small muted">
              ({money(data.estimateNight)} por noche{rooms > 1 ? ` · ${rooms} habitaciones` : ""}
              {data.estimateFrom ? `, según precios de la zona de ${data.estimateFrom}` : ""})
            </span>
          </p>
        </div>
      )}
      {data && (
        <div className="results-foot">
          <span className="small muted">Compará en:</span>
          {data.links.map((l) => (
            <a key={l.label} className="pill-link" href={l.url} target="_blank" rel="noreferrer">
              {l.label} <Icon name="external" size={14} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

const kmLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000 / 50) * 50} m` : `${(km < 10 ? Math.round(km * 10) / 10 : Math.round(km)).toLocaleString("es-AR")} km`);

/** Hotel del selector de cada parada: datos para decidir y links a TripAdvisor, sitio oficial y mapa. */
function TripHotelCard({
  h,
  stop,
  rooms,
  money,
  selected,
  onSelect,
}: {
  h: RealHotel;
  stop: TripPlan["stops"][number];
  rooms: number;
  money: (n: number) => string;
  selected: boolean;
  onSelect: () => void;
}) {
  const links = hotelLinks(h, [stop.name, stop.country].filter(Boolean).join(" "));
  const km = hotelDistanceKm(h, stop.lat, stop.lon);
  const nights = stop.nights;
  const kind = h.stars ? `${h.stars} ${h.stars === 1 ? "estrella" : "estrellas"}` : h.type;
  return (
    <article className={`card hotel-card trip-hotel ${selected ? "on" : ""}`}>
      <HotelThumb src={h.thumbnail} />
      <div className="stack-sm grow">
        <strong>{h.name}</strong>
        {(kind || km != null) && (
          <span className="small muted">{[kind && capitalize(kind), km != null ? `a ${kmLabel(km)} de ${stop.name}` : null].filter(Boolean).join(" · ")}</span>
        )}
        {h.rating != null && (
          <span className="small muted">
            <Icon name="star" size={12} /> {h.rating.toLocaleString("es-AR")} de 5
            {h.reviews ? ` · ${h.reviews.toLocaleString("es-AR")} opiniones` : ""}
          </span>
        )}
        <span className="price">{money(h.totalUSD * rooms)}</span>
        <span className="small muted">
          {money(h.nightlyUSD)} por noche · {nights} {nights === 1 ? "noche" : "noches"}
          {rooms > 1 ? ` · ${rooms} habitaciones` : ""}
          {h.site ? ` · en ${h.site}` : ""}
        </span>
      </div>
      <nav className="hotel-links" aria-label={`Más sobre ${h.name}`}>
        <a href={links.tripadvisor} target="_blank" rel="noreferrer">
          TripAdvisor <Icon name="external" size={12} />
        </a>
        <a href={links.official} target="_blank" rel="noreferrer">
          {links.officialIsSearch ? "Buscar sitio oficial" : "Sitio oficial"} <Icon name="external" size={12} />
        </a>
        <a href={links.maps} target="_blank" rel="noreferrer">
          Ver en el mapa <Icon name="external" size={12} />
        </a>
      </nav>
      <button className={selected ? "primary" : "secondary"} onClick={onSelect} aria-pressed={selected}>
        {selected ? "Elegido" : "Elegir"}
      </button>
    </article>
  );
}
