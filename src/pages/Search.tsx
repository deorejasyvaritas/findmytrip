import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { FlightResult, LegResult, RealHotel, StayOption, TripLeg, TripPackage, TripPlan } from "../../shared/types.ts";
import { airlineName } from "../../shared/airlines.ts";
import { DEFAULT_PARTY, describeParty, fareUnits, headcount, partyFromParams } from "../../shared/pricing.ts";
import { FlightForm, HotelForm, MultiForm, TripForm, readPlace, readStop, type SearchKind } from "../components/FullSearch.tsx";
import Icon from "../components/Icon.tsx";
import Segmented from "../components/Segmented.tsx";
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
      {kind === "hoteles" && to && depart && ret && <HotelResults place={to.code} name={to.label} checkin={depart} checkout={ret} travelers={headcount(party)} />}
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
    setData(null);
    setError(null);
    api
      .searchFlights({ origin, dest, depart, ...(ret ? { ret } : {}), ...(direct ? { direct: 1 as const } : {}) })
      .then(setData)
      .catch((e) => setError((e as Error).message));
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
            <FlightCard key={`${r.flightNumber}-${r.departAt}-${r.returnAt}`} r={r} units={units} money={money} />
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
        </section>
      </div>
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
  money,
  selected,
  onSelect,
}: {
  r: FlightResult;
  units: number;
  money: (n: number) => string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const name = airlineName(r.airline) ?? "Aerolínea sin dato";
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
          r.link && (
            <a className="button primary" href={r.link} target="_blank" rel="noreferrer sponsored">
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

function useHotels(place: string, name: string, checkin: string, checkout: string, travelers: number) {
  const [data, setData] = useState<HotelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    api
      .searchHotels({ place, name: name.split(",")[0].replace(/\s*\([A-Z]{3}\)$/, ""), checkin, checkout, travelers })
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [place, name, checkin, checkout, travelers]);
  return { data, error };
}

function HotelResults(p: { place: string; name: string; checkin: string; checkout: string; travelers: number }) {
  const { money } = useApp();
  const { data, error } = useHotels(p.place, p.name, p.checkin, p.checkout, p.travelers);
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

function HotelCard({ h, rooms, money, selected, onSelect }: { h: RealHotel; rooms: number; money: (n: number) => string; selected?: boolean; onSelect?: () => void }) {
  return (
    <article className={`card hotel-card ${selected ? "on" : ""}`}>
      {h.thumbnail ? (
        <img src={h.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.replaceWith(Object.assign(document.createElement("div"), { className: "hotel-card-img" }))} />
      ) : (
        <div className="hotel-card-img" />
      )}
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
  const hotels = useHotels(to.code, to.label, depart, ret, headcount(party));
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
        { kind: "vuelo", label: `Vuelo ${from.code}–${to.code} (${airlineName(flight.airline) ?? "aerolínea sin dato"}, ${describeParty(party)})`, amountUSD: flightTotal, link: flight.link ?? undefined },
        { kind: "alojamiento", label: `${hotel.name} · ${hotels.data?.nights} noches`, amountUSD: hotelTotal, link: hotel.link ?? undefined },
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
            <FlightCard key={keyOf(r)} r={r} units={units} money={money} selected={flight === r} onSelect={() => setFlightKey(keyOf(r))} />
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
        <p className="small muted">Precios de referencia. Se reservan por separado con cada proveedor.</p>
        <button className="primary full" disabled={!flight || !hotel} onClick={save}>
          <Icon name="bookmark" size={18} />
          Guardar en Mis viajes
        </button>
        {flight?.link && (
          <a className="button secondary full" href={flight.link} target="_blank" rel="noreferrer sponsored">
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
    setData(null);
    setError(null);
    setPicked({});
    if (legs.length < 2) return;
    api
      .searchMulti(legs.map((l) => ({ origin: l.origin.code, destination: l.destination.code, date: l.date })))
      .then(setData)
      .catch((e) => setError((e as Error).message));
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
                <FlightCard key={j} r={r} units={units} money={money} selected={(picked[i] ?? 0) === j} onSelect={() => setPicked((p) => ({ ...p, [i]: j }))} />
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
              <a key={i} className="secondary full" href={r.link} target="_blank" rel="noreferrer sponsored">
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
}

function TripResults() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const app = useApp();
  const { money, profile } = app;
  const party = partyFromParams(params, DEFAULT_PARTY);
  const units = fareUnits(party);
  const from = readPlace(params.get("from"))!;
  const depart = params.get("depart")!;
  const stops = params.getAll("stop").map(readStop).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const key = params.getAll("stop").join(",") + from.code + depart;
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stays, setStays] = useState<Record<number, StayPick>>({});

  useEffect(() => {
    setPlan(null);
    setError(null);
    setStays({});
    api
      .planTrip({ origin: from.code, depart, stops: stops.map(({ name, region, country, lat, lon, nights }) => ({ name, region, country, lat, lon, nights })) })
      .then(setPlan)
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) return <ErrorCard message={error} />;

  const flights = plan?.legs.filter((l) => l.kind === "flight") ?? [];
  const flightsTotal = flights.reduce((s, l) => s + (l.price ? Math.round(l.price * units) : 0), 0);
  const missingFlights = flights.filter((l) => l.price == null).length;
  const approxFlights = flights.some((l) => l.priceKind === "mes");
  const staysTotal = Object.values(stays).reduce((s, x) => s + x.total, 0);
  const total = flightsTotal + staysTotal;
  const single = stops.length === 1 && stops[0].destinationId;

  function save() {
    if (!plan) return;
    const items: TripPackage["items"] = [
      ...flights.map((l) => ({ kind: "vuelo" as const, label: `${l.label}${l.price == null ? " (sin precio)" : ""}`, amountUSD: l.price ? Math.round(l.price * units) : 0, link: l.link ?? undefined })),
      ...plan.stops.map((st, i) => ({
        kind: "alojamiento" as const,
        label: `${st.name}: ${stays[i]?.label ?? "alojamiento"} · ${st.nights} noches${stays[i]?.real ? "" : " (estimado)"}`,
        amountUSD: stays[i]?.total ?? 0,
        link: stays[i]?.link,
      })),
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
  const outbound = plan?.legs.find((l) => l.role === "out");
  const inbound = plan?.legs.find((l) => l.role === "back");
  const after = (i: number) => plan?.legs.find((l) => l.role === "between" && l.after === i);

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
            {outbound && <LegCard leg={outbound} units={units} money={money} />}
            {plan.stops.map((st, i) => (
              <li key={i} className="timeline-stop">
                <StopCard
                  stop={st}
                  index={i}
                  travelers={headcount(party)}
                  style={profile.style}
                  money={money}
                  onPick={(pick) => setStays((x) => ({ ...x, [i]: pick }))}
                />
                {after(i) && <LegCard leg={after(i)!} units={units} money={money} />}
              </li>
            ))}
            {inbound && <LegCard leg={inbound} units={units} money={money} />}
          </ol>
        )}
      </div>
      <aside className="card summary">
        <h2>Tu viaje</h2>
        <p className="small muted">
          {plan ? `${shortDate(plan.depart)} al ${shortDate(plan.ret)}` : ""} · {describeParty(party)}
        </p>
        <ul className="items">
          <li>
            <span className="label">
              <Icon name="plane" size={16} />
              Vuelos{missingFlights ? ` (${missingFlights} sin precio)` : approxFlights ? " (aproximado)" : ""}
            </span>
            <span>{money(flightsTotal)}</span>
          </li>
          {plan?.stops.map((st, i) => (
            <li key={i}>
              <span className="label">
                <Icon name="bed" size={16} />
                {st.name} · {st.nights} {st.nights === 1 ? "noche" : "noches"}
                {stays[i] && !stays[i].real ? " (estimado)" : ""}
              </span>
              <span>{stays[i] ? money(stays[i].total) : "—"}</span>
            </li>
          ))}
        </ul>
        <div className="total">
          <span className="headline">Total</span>
          <span className="price">{money(total)}</span>
        </div>
        <p className="small muted">
          {missingFlights ? "Hay tramos sin precio visto: buscalos en vivo y sumalos. " : ""}Traslados por tierra no incluidos. Precios de referencia; se
          reservan por separado.
        </p>
        <button className="primary full" disabled={!plan} onClick={save}>
          <Icon name="bookmark" size={18} />
          Guardar en Mis viajes
        </button>
      </aside>
    </div>
  );
}

function LegCard({ leg, units, money }: { leg: TripLeg; units: number; money: (n: number) => string }) {
  if (leg.kind === "ground") {
    return (
      <div className="card trip-leg ground">
        <Icon name="pin" size={18} />
        <span className="grow">
          <strong>{leg.label}</strong>
          <span className="small muted">
            {capitalize(shortDate(leg.date))} · unos {leg.km} km · cerca de {String(leg.hours).replace(".", ",")} h en auto, transfer o micro
          </span>
        </span>
        {leg.mapsUrl && (
          <a className="button secondary" href={leg.mapsUrl} target="_blank" rel="noreferrer">
            Ver ruta <Icon name="external" size={14} />
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="card trip-leg">
      <Icon name="plane" size={18} />
      <span className="grow">
        <strong>{leg.label}</strong>
        <span className="small muted">
          {capitalize(shortDate(leg.date))}
          {leg.returnDate ? ` al ${shortDate(leg.returnDate)}` : ""}
          {leg.price == null
            ? " · todavía sin precio para esa fecha"
            : leg.priceKind === "exacto"
              ? leg.priceSource === "google"
                ? " · precio de hoy en Google Flights"
                : ` · ${[airlineName(leg.airline), stopsLabel(leg.stops)].filter(Boolean).join(" · ")}`
              : leg.priceKind === "cercano"
                ? ` · precio real saliendo el ${shortDate(leg.priceDate!)}`
                : " · precio de referencia del mes"}
        </span>
      </span>
      <span className="trip-leg-price">
        {leg.price != null && (
          <>
            <strong>{money(Math.round(leg.price * units))}</strong>
            <span className="small muted">{money(leg.price)} por adulto</span>
          </>
        )}
        <a className="button secondary" href={(leg.priceKind === "exacto" ? leg.link : leg.liveUrl) ?? "#"} target="_blank" rel="noreferrer sponsored">
          {leg.priceSource === "google" ? "Ver en Google Flights" : "Ver en Aviasales"} <Icon name="external" size={14} />
        </a>
      </span>
    </div>
  );
}

function StopCard({
  stop,
  index,
  travelers,
  style,
  money,
  onPick,
}: {
  stop: TripPlan["stops"][number];
  index: number;
  travelers: number;
  style: string;
  money: (n: number) => string;
  onPick: (p: StayPick) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.tripHotels>> | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const load = () => api.tripHotels({ name: stop.name, country: stop.country, lat: stop.lat, lon: stop.lon, checkin: stop.checkin, nights: stop.nights, travelers, style });

  useEffect(() => {
    setData(null);
    load()
      .then(setData)
      .catch(() => setData(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.name, stop.checkin, stop.nights, travelers]);

  const hotels = (data?.hotels ?? []).slice(0, 6);
  const choice = hotels.find((h) => h.name === picked) ?? hotels[Math.floor(hotels.length / 3)];
  const rooms = data?.rooms ?? 1;

  useEffect(() => {
    if (!data) return;
    if (choice) onPick({ label: choice.name, total: choice.totalUSD * rooms, real: true, link: choice.link ?? undefined });
    else onPick({ label: "alojamiento", total: data.estimateNight * stop.nights * rooms, real: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, choice?.name]);

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

      {!data && <div className="sk" style={{ width: "100%", height: 72 }} />}
      {data && hotels.length > 0 && (
        <p className="small muted">
          Precios reales {data.source === "google" ? "de Google Hotels" : "comparados entre Booking, Agoda, Expedia y más"} para tus fechas. Elegí uno:
        </p>
      )}
      {data && hotels.length > 0 && (
        <div className="hotel-results">
          {hotels.map((h) => (
            <HotelCard key={h.name} h={h} rooms={rooms} money={money} selected={choice === h} onSelect={() => setPicked(h.name)} />
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
