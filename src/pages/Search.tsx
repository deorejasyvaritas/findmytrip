import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { FlightResult, ItemQuote, LegOption, LegResult, MealPlan, Party, RealHotel, StayOption, TripLeg, TripPackage, TripPlan } from "../../shared/types.ts";
import { aviasalesForParty } from "../../shared/links.ts";
import { priceLabel } from "../../shared/price-age.ts";
import { airlineName } from "../../shared/airlines.ts";
import {
  BAGS_LABEL,
  DEFAULT_PARTY,
  describeParty,
  describeRooms,
  fareUnits,
  headcount,
  partyFromParams,
  partyToParams,
  roomOccupancy,
  roomsForParty,
} from "../../shared/pricing.ts";
import { hotelDistanceKm, hotelLinks } from "../../shared/hotel-links.ts";
import { priceIncludesPlan, sortHotelsFor } from "../../shared/hotel-badges.ts";
import { MEAL_PLAN_LABEL } from "../../shared/meal-plan.ts";
import { HotelBadges, HotelFilters, HotelFinder, MealPlanNote, MealPlanPriceLink } from "../components/HotelBadges.tsx";
import { estimateTrip } from "../../shared/compare.ts";
import { groundSeats, groundTotal } from "../../shared/ground.ts";
import { describeWindow, tripDatesFromParams, tripDatesToParams, windowFromParam } from "../../shared/trip-window.ts";
import { BAGS_SHORT, tripBagsCost, type FlightInfo, type FlightSegment } from "../../shared/flight-details.ts";
import { FlightInfoBlock, InstallmentsNote } from "../components/FlightInfo.tsx";
import { transferCars, transferCost, transferTimes, transfersTotal, tripTotal } from "../../shared/transfers.ts";
import { quoteText, whatsappUrl } from "../../shared/quote-text.ts";
import { flightLinks } from "../../shared/links.ts";
import { FlightForm, HotelForm, MultiForm, TripForm, readPlace, readStop, type SearchKind } from "../components/FullSearch.tsx";
import Icon from "../components/Icon.tsx";
import Segmented from "../components/Segmented.tsx";
import WatchButton from "../components/WatchButton.tsx";
import { ClimateLine } from "../components/Climate.tsx";
import { EntryLine } from "../components/EntryRequirements.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate } from "../lib/format.ts";
import { countrySearchFromParams } from "../../shared/country-search.ts";
import { countryByCode } from "../../shared/countries.ts";
import CountryResults from "./CountryResults.tsx";

// Resultados del buscador completo. Los precios de vuelos son los que vieron
// usuarios de Aviasales en los últimos días; cada uno lleva a Aviasales para
// confirmarlo en vivo.

const TITLES: Record<SearchKind, string> = {
  vuelos: "Vuelos",
  hoteles: "Hoteles",
  paquete: "Vuelo + Hotel",
  multi: "Multidestino",
  viaje: "Tu viaje",
  pais: "Destinos en el país",
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
  const tripWin = kind === "viaje" ? windowFromParam(params.get("win")) : null;
  const countrySearch = kind === "pais" ? countrySearchFromParams(params) : null;
  const countryName = countrySearch ? countryByCode(countrySearch.country)?.name : null;
  const summary =
    kind === "pais"
      ? countrySearch
        ? `${countrySearch.nights} noches · ${
            countrySearch.dates.window ? `salida flexible, ${describeWindow(countrySearch.dates.window)}` : `desde ${shortDate(countrySearch.dates.depart)}`
          } · ${describeParty(countrySearch.party)}`
        : "Faltan datos de la búsqueda"
      : kind === "viaje"
      ? `${tripStops.map((t) => `${t.name} (${t.nights} ${t.nights === 1 ? "noche" : "noches"})`).join(", ")} · ${
          tripWin ? `salida flexible, ${describeWindow(tripWin)}` : `desde ${depart && shortDate(depart)}`
        } · ${describeParty(party)}`
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
            <h1>{kind === "pais" && countryName ? `Viajar a ${countryName}` : TITLES[kind]}</h1>
            <p className="muted">{summary}</p>
          </div>
          <button className="secondary" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            <Icon name="sliders" size={18} />
            {editing ? "Cerrar" : "Modificar búsqueda"}
          </button>
        </div>
        {editing && (
          <div className="search-panel compact">
            {kind === "hoteles" ? <HotelForm /> : kind === "multi" ? <MultiForm /> : kind === "viaje" || kind === "pais" ? <TripForm /> : <FlightForm kind={kind} />}
          </div>
        )}
      </section>

      {kind === "vuelos" && from && to && depart && <FlightResults origin={from.code} dest={to.code} depart={depart} ret={ret} />}
      {kind === "paquete" && from && to && depart && ret && <PackageResults />}
      {kind === "hoteles" && to && depart && ret && <HotelResults place={to.code} name={to.label} checkin={depart} checkout={ret} party={party} />}
      {kind === "multi" && <MultiResults />}
      {kind === "viaje" && from && (depart || tripWin) && tripStops.length > 0 && <TripResults />}
      {kind === "pais" &&
        (countrySearch ? (
          <CountryResults search={countrySearch} />
        ) : (
          <div className="card empty">
            <Icon name="globe" size={28} />
            <p>Esta búsqueda no tiene país, salida o fecha. Completala para ver los destinos.</p>
            <button className="primary" onClick={() => setEditing(true)}>
              Completar la búsqueda
            </button>
          </div>
        ))}
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
  roomsLabel?: string;
  hotels: RealHotel[];
  options: StayOption[];
  links: { label: string; url: string }[];
}

function useHotels(place: string, name: string, checkin: string, checkout: string, party: Party, meal: MealPlan = "room", beach = false) {
  const [data, setData] = useState<HotelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Edades de los chicos: los links a Booking, Expedia y Airbnb se abren para el grupo real.
  const partyKey = JSON.stringify(partyToParams(party));
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .searchHotels({
        place,
        name: name.split(",")[0].replace(/\s*\([A-Z]{3}\)$/, ""),
        checkin,
        checkout,
        travelers: headcount(party),
        ...partyToParams(party),
        ...(meal !== "room" ? { meal } : {}),
        ...(beach ? { beach: 1 as const } : {}),
      })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, name, checkin, checkout, partyKey, meal, beach]);
  return { data, error };
}

function HotelResults(p: { place: string; name: string; checkin: string; checkout: string; party: Party }) {
  const { money, profile } = useApp();
  const [meal, setMeal] = useState<MealPlan>(profile.mealPlan ?? "room");
  const [beach, setBeach] = useState(profile.beachfront ?? false);
  const { data, error } = useHotels(p.place, p.name, p.checkin, p.checkout, p.party, meal, beach);
  const [sort, setSort] = useState<"price" | "rating">("price");
  const [minRating, setMinRating] = useState(0);
  const filters = <HotelFilters mealPlan={meal} onMealPlan={setMeal} beachfront={beach} onBeachfront={setBeach} />;
  if (error) return <ErrorCard message={error} />;
  if (!data) return (
    <div className="stack">
      {filters}
      <HotelSkeleton />
    </div>
  );
  const city = data.name.split(",")[0];
  const hotels = sortHotelsFor(
    data.hotels
      .filter((h) => (h.rating ?? 0) >= minRating)
      .sort((a, b) => (sort === "price" ? a.nightlyUSD - b.nightlyUSD : (b.rating ?? 0) - (a.rating ?? 0))),
    meal,
    beach,
  );

  return (
    <div className="stack">
      {filters}
      <MealPlanNote mealPlan={meal} />
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
            {hotels.length} hoteles · {data.nights} noches · {data.roomsLabel ?? `${data.rooms} ${data.rooms === 1 ? "habitación" : "habitaciones"}`} · el mejor precio entre
            Booking, Agoda, Expedia y más
          </p>
          {beach && hotels.length === 0 && (
            <p className="small muted">Ninguno de estos hoteles dice tener acceso a la playa. Sacá el filtro o compará directo:</p>
          )}
          <div className="hotel-results">
            {hotels.map((h) => (
              <HotelCard
                key={h.name}
                h={h}
                rooms={data.rooms}
                money={money}
                mealPlan={meal}
                roomsLabel={data.roomsLabel}
                extra={<MealPlanPriceLink h={h} city={city} checkin={p.checkin} checkout={p.checkout} party={p.party} mealPlan={meal} />}
              />
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

function HotelCard({
  h,
  rooms,
  money,
  selected,
  onSelect,
  mealPlan = "room",
  roomsLabel,
  extra,
}: {
  h: RealHotel;
  rooms: number;
  money: (n: number) => string;
  selected?: boolean;
  onSelect?: () => void;
  mealPlan?: MealPlan;
  /** "3 personas en 1 habitación". */
  roomsLabel?: string;
  extra?: ReactNode;
}) {
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
        <HotelBadges h={h} mealPlan={mealPlan} />
        <span className="price">{money(h.totalUSD * rooms)}</span>
        <span className="small muted">
          {money(h.nightlyUSD)} por noche{rooms > 1 ? " por habitación" : ""}
          {h.site ? ` en ${h.site}` : ""}
        </span>
        {roomsLabel && <span className="small muted">{roomsLabel}</span>}
        {extra}
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
      // La ocupación con la que se cotizó (al revisar el precio se pide igual).
      ...(hotel.key
        ? { hotel: { key: hotel.key, checkin: depart, checkout: ret, adults: roomOccupancy(party).adults, ages: roomOccupancy(party).childAges } }
        : {}),
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
              <HotelCard
                key={h.name}
                h={h}
                rooms={rooms}
                money={money}
                roomsLabel={hotels.data?.roomsLabel}
                selected={hotel === h}
                onSelect={() => setHotelName(h.name)}
              />
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
type LegPatch = Pick<TripLeg, "price" | "priceKind" | "priceDate" | "priceSource" | "airline" | "stops" | "link" | "flight">;

/** Tramo con lo que se actualizó después de Aviasales y, encima, el precio que cargó el usuario. */
function effectiveLeg(base: TripLeg, patch: LegPatch | undefined, manual: number | undefined): TripLeg {
  const auto = patch ? { ...base, ...patch, link: patch.link ?? base.link, flight: patch.flight ?? base.flight } : base;
  return manual != null ? { ...auto, price: manual, priceKind: "manual" } : auto;
}

/** Tramo con otro vuelo del mismo día ("Cambiar vuelo"): precio, horarios y link de esa opción. */
function withOption(base: TripLeg, o: LegOption): TripLeg {
  return {
    ...base,
    price: o.price,
    priceKind: "exacto",
    priceDate: null,
    priceSource: o.source,
    airline: o.airline,
    stops: o.flight.out.stops,
    link: o.link ?? base.link,
    flight: o.flight,
  };
}

/** Misma opción (para marcar cuál está elegida). */
const sameOption = (a: FlightInfo | null | undefined, b: FlightInfo | null | undefined) =>
  Boolean(a && b && a.out.departAt === b.out.departAt && a.out.airline === b.out.airline && (a.back?.departAt ?? "") === (b.back?.departAt ?? ""));

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
  const dates = tripDatesFromParams(params);
  const depart = dates.depart;
  const stops = params.getAll("stop").map(readStop).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const key = params.getAll("stop").join(",") + from.code + depart + (params.get("win") ?? "") + (dates.pinned ?? "");
  const [plan, setPlan] = useState<TripPlan | null>(null);
  // "Cambiar vuelo": otra opción del mismo día para un tramo (por índice de tramo).
  const [picked, setPicked] = useState<Record<number, LegOption>>({});
  // Traslados aeropuerto–hotel que el usuario sacó (por parada) y equipaje estimado.
  const [noTransfer, setNoTransfer] = useState<Record<number, boolean>>({});
  const [withBags, setWithBags] = useState(true);
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
    setPicked({});
    setNoTransfer({});
    api
      .planTrip({
        origin: from.code,
        depart: dates.pinned ?? depart,
        stops: stops.map(({ name, region, country, lat, lon, nights }) => ({ name, region, country, lat, lon, nights })),
        window: dates.window,
        pinned: Boolean(dates.pinned),
      })
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const autoLegs = useMemo(
    () => plan?.legs.map((l, i) => (picked[i] ? withOption(l, picked[i]) : effectiveLeg(l, refreshed[i], undefined))) ?? [],
    [plan, refreshed, picked],
  );
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
  // Traslado aeropuerto–hotel (estimado, se puede quitar por parada).
  const transfers = plan?.stops.map((s) => s.transfer ?? null) ?? [];
  const transfersUSD = transfersTotal(transfers, party, noTransfer);
  const hasTransfers = transfers.some(Boolean);
  // Equipaje elegido para el grupo (estimado): la Data API no dice qué incluye la tarifa.
  const bagsUSD = plan ? Math.round(tripBagsCost(party, flights.map((l) => ({ country: legCountry(plan, l), roundTrip: Boolean(l.returnDate) })))) : 0;
  const total = tripTotal(
    { flights: flightsTotal, stays: staysTotal, ground: groundUSD, transfers: transfersUSD, bags: bagsUSD },
    { ground: withGround, transfers: true, bags: withBags },
  );
  const single = stops.length === 1 && stops[0].destinationId;
  // Cada parada tiene que tener un hotel elegido o el estimado a la vista antes de guardar.
  const staysReady = plan != null && plan.stops.every((_, i) => stays[i] != null);

  const outbound = legs.findIndex((l) => l.role === "out");
  const inbound = legs.findIndex((l) => l.role === "back");
  const after = (i: number) => legs.findIndex((l) => l.role === "between" && l.after === i);

  /** Vuelo con el que se llega a la parada y con el que se va (para los horarios del traslado). */
  function stopFlights(i: number): { arrive: FlightSegment | null; leave: FlightSegment | null; international: boolean } {
    const n = plan!.stops.length;
    const out = legs[outbound];
    const before = i === 0 ? out : legs[after(i - 1)];
    const roundTrip = Boolean(out?.returnDate);
    const leaving = i === n - 1 ? (roundTrip ? out : legs[inbound]) : legs[after(i)];
    const arrive = before?.kind === "flight" ? (before.flight?.out ?? null) : null;
    const leave = leaving?.kind === "flight" ? ((leaving === out ? leaving.flight?.back : leaving.flight?.out) ?? null) : null;
    const here = normCountry(plan!.stops[i].country);
    // Entre paradas: internacional si cambia el país; la vuelta a casa, si la parada no es de Argentina.
    const international = i < n - 1 ? here !== normCountry(plan!.stops[i + 1].country) : here !== "argentina";
    return { arrive, leave, international };
  }

  // Ventana de fechas: elegir otro día vuelve a armar el viaje con ese día.
  function goDay(day: string) {
    const q = new URLSearchParams(params);
    if (dates.window) {
      for (const [k, v] of Object.entries(tripDatesToParams({ depart, window: dates.window, pinned: day }))) q.set(k, v);
    } else q.set("depart", day);
    navigate(`/buscar?${q}`);
  }

  const outLeg = outbound >= 0 ? legs[outbound] : null;
  const backLeg = inbound >= 0 ? legs[inbound] : null;
  // Despegar: misma ruta de ida (y la vuelta si es al mismo aeropuerto) para ver cuotas en pesos.
  const despegarUrl =
    outLeg?.kind === "flight"
      ? flightLinks(outLeg.from, outLeg.to, outLeg.date, outLeg.returnDate ?? (backLeg && backLeg.from === outLeg.to ? backLeg.date : null), party).find(
          (l) => l.label === "Despegar",
        )?.url
      : null;

  const transferLabel = (i: number) => {
    const t = transfers[i]!;
    const way = t.ways.length === 2 ? "ida y vuelta" : t.ways[0] === "ida" ? "solo ida" : "solo vuelta";
    return `Traslado aeropuerto–hotel en ${plan!.stops[i].name} (${way})`;
  };

  function quote(): string {
    if (!plan) return "";
    const nowIso = new Date().toISOString();
    const prices = [
      ...flights.map((l) => ({
        label: l.label,
        amount: l.price != null ? `${money(Math.round(l.price * units))} en total` : "sin precio",
        note: l.price != null ? priceLabel({ kind: l.priceKind, source: l.priceSource ?? "aviasales", at: l.priceAt ?? nowIso, priceDate: l.priceDate }) : null,
      })),
      ...plan.stops.flatMap((st, i) => (stays[i] ? [{ label: `${st.name}: ${stays[i]!.label}`, amount: money(stays[i]!.total), note: stays[i]!.real ? null : "estimado" }] : [])),
      ...transfers.flatMap((t, i) => (t && !noTransfer[i] ? [{ label: transferLabel(i), amount: money(transferCost(t, party)), note: "estimado" }] : [])),
      ...(withBags && bagsUSD > 0 ? [{ label: `Equipaje (${BAGS_SHORT[party.bags]})`, amount: money(bagsUSD), note: "estimado" }] : []),
    ];
    return quoteText({
      origin: from.label || from.code,
      party,
      stops: plan.stops.map((s) => ({ name: s.name, nights: s.nights })),
      depart: plan.depart,
      ret: plan.ret,
      window: dates.window,
      lodging: plan.stops.flatMap((st, i) => (stays[i] ? [`${st.name}, ${stays[i]!.label}`] : [])),
      prices,
      total: money(total),
    });
  }

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
        ...(l.flight && l.priceKind !== "manual" ? { flight: l.flight } : {}),
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
      ...transfers.flatMap((t, i) =>
        t && !noTransfer[i]
          ? [{ kind: "extra" as const, label: `${transferLabel(i)} (estimado)`, amountUSD: transferCost(t, party), link: t.link ?? undefined, optional: true }]
          : [],
      ),
      ...(withBags && bagsUSD > 0
        ? [{ kind: "extra" as const, label: `Equipaje: ${BAGS_LABEL[party.bags].toLowerCase()} por persona (estimado)`, amountUSD: bagsUSD, optional: true }]
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
      party,
      ...(dates.window ? { window: dates.window } : {}),
      stops: plan.stops.map((s) => ({ name: s.name, nights: s.nights })),
    });
    navigate("/viajes");
  }

  // El recorrido intercala vuelos/traslados con las paradas.
  const legCard = (idx: number) => {
    const leg = legs[idx];
    if (!leg) return null;
    const base = plan?.legs[idx];
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
        options={base?.options}
        onPick={(o) => {
          setPicked((x) => ({ ...x, [idx]: o }));
          setManual((m) => {
            const next = { ...m };
            delete next[idx];
            return next;
          });
        }}
        // Otros días: solo para la ida y sin ventana (con ventana está la franja de arriba).
        strip={leg.role === "out" && !plan?.window ? base?.strip : undefined}
        onDay={goDay}
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

  return (
    <div className="package-layout">
      <div className="stack-lg">
        {single && (
          <Link className="card trip-catalog" to={`/destino/${stops[0].destinationId}?month=${(plan?.depart ?? depart).slice(0, 7)}&depart=${plan?.depart ?? depart}&nights=${stops[0].nights}`}>
            <Icon name="compass" size={20} />
            <span className="grow">
              <strong>{stops[0].name} tiene ficha completa</strong>
              <span className="small muted">Calendario de precios por día, cuándo conviene ir, extras y más.</span>
            </span>
            <Icon name="chevronRight" size={18} />
          </Link>
        )}
        {plan?.window && <WindowCard w={plan.window} money={money} onDay={goDay} />}
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
                {transfers[i] && (
                  <TransferCard
                    t={transfers[i]!}
                    title={transferLabel(i).replace(` en ${st.name}`, "")}
                    party={party}
                    money={money}
                    times={(() => {
                      const f = stopFlights(i);
                      return transferTimes(f.arrive?.arriveAt ?? null, f.leave?.departAt ?? null, f.international);
                    })()}
                    off={Boolean(noTransfer[i])}
                    onToggle={() => setNoTransfer((x) => ({ ...x, [i]: !x[i] }))}
                  />
                )}
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
          {hasTransfers && (
            <li className={transfersUSD > 0 ? "" : "off"}>
              <span className="label">
                <Icon name="car" size={16} />
                Traslados aeropuerto–hotel (estimado)
              </span>
              <span>{transfersUSD > 0 ? money(transfersUSD) : "Quitados"}</span>
            </li>
          )}
          {plan && bagsUSD > 0 && (
            <li className={withBags ? "" : "off"}>
              <span className="label">
                <Icon name="luggage" size={16} />
                Equipaje: {BAGS_SHORT[party.bags]} (estimado)
              </span>
              <span>{withBags ? money(bagsUSD) : <s aria-label={`No sumado: ${money(bagsUSD)}`}>{money(bagsUSD)}</s>}</span>
            </li>
          )}
        </ul>
        {groundLegs.length > 0 && (
          <label className="check ground-toggle">
            <input type="checkbox" checked={withGround} onChange={(e) => setWithGround(e.target.checked)} />
            Sumar traslados por tierra al total
          </label>
        )}
        {plan && bagsUSD > 0 && (
          <label className="check ground-toggle">
            <input type="checkbox" checked={withBags} onChange={(e) => setWithBags(e.target.checked)} />
            Sumar el equipaje (si la tarifa no lo incluye)
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
          {hasTransfers ? "Traslados al aeropuerto y equipaje: estimados, podés quitarlos. " : ""}
          Precios de referencia; se reservan por separado.
        </p>
        <button className="primary full" disabled={!staysReady} onClick={save}>
          <Icon name="bookmark" size={18} />
          Guardar en Mis viajes
        </button>
        {plan && !staysReady && <p className="small muted">Falta el alojamiento de alguna parada: esperá a que cargue o reintentá.</p>}
        {plan && (
          <a className="button secondary full" href={whatsappUrl(quote())} target="_blank" rel="noreferrer">
            <Icon name="message" size={18} />
            Pedir cotización por WhatsApp
          </a>
        )}
        {plan && <InstallmentsNote despegarUrl={despegarUrl ?? null} />}
      </aside>
    </div>
  );
}

const normCountry = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** País del lugar al que va (o del que vuelve) un vuelo: para estimar el equipaje por región. */
function legCountry(plan: TripPlan, l: TripLeg): string {
  if (l.role === "between" && l.after != null) return plan.stops[l.after + 1]?.country ?? plan.stops[l.after].country;
  return l.role === "back" ? plan.stops[plan.stops.length - 1].country : plan.stops[0].country;
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "18 jul 16:25" de una hora local "YYYY-MM-DDTHH:MM". */
const whenText = (local: string) => `${Number(local.slice(8, 10))} ${MONTHS_SHORT[Number(local.slice(5, 7)) - 1]} ${local.slice(11, 16)}`;

/** Fechas flexibles: el día elegido y el precio visto de cada día de la ventana. */
function WindowCard({ w, money, onDay }: { w: NonNullable<TripPlan["window"]>; money: (n: number) => string; onDay: (d: string) => void }) {
  const min = w.days.length ? Math.min(...w.days.map((d) => d.price)) : 0;
  const basis = w.basis === "ida y vuelta" ? "ida y vuelta" : w.basis === "ida + vuelta" ? "ida más vuelta" : "solo el vuelo de ida";
  return (
    <section className="card window-card" aria-label="Fechas flexibles">
      <div className="window-card-head">
        <Icon name="calendar" size={20} />
        <span className="grow">
          <strong>
            {w.pinned ? "Elegiste salir el" : w.days.length ? "Salida más barata en tu ventana:" : "Salida:"} {shortDate(w.chosen)}
          </strong>
          <span className="small muted">
            Ventana: {describeWindow(w)}.{" "}
            {w.days.length
              ? `Precio por adulto (${basis}) visto en Aviasales en los últimos días; el del día elegido se confirma abajo.`
              : "No encontramos precios vistos para esos días: armamos el viaje con el primer día de la ventana."}
          </span>
        </span>
      </div>
      {w.days.length > 1 && (
        <div className="strip" role="list" aria-label="Precio por día de salida en tu ventana">
          {w.days.map((d) => (
            <button
              key={d.date}
              role="listitem"
              className={`strip-day ${d.date === w.chosen ? "on" : ""} ${d.price === min ? "cheap" : ""}`}
              onClick={() => d.date !== w.chosen && onDay(d.date)}
              aria-current={d.date === w.chosen ? "date" : undefined}
              ref={d.date === w.chosen ? (el) => el?.scrollIntoView({ block: "nearest", inline: "center" }) : undefined}
            >
              <span>{capitalize(shortDate(d.date))}</span>
              <strong>{money(d.price)}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Traslado aeropuerto–hotel de una parada: estimado, con horarios según los vuelos y se puede quitar. */
function TransferCard({
  t,
  title,
  party,
  money,
  times,
  off,
  onToggle,
}: {
  t: NonNullable<NonNullable<TripPlan["stops"][number]["transfer"]>>;
  title: string;
  party: Party;
  money: (n: number) => string;
  times: { ida: string | null; vuelta: string | null };
  off: boolean;
  onToggle: () => void;
}) {
  const cars = transferCars(party);
  const both = t.ways.length === 2;
  const when = [
    t.ways.includes("ida") ? `Ida ${times.ida ? whenText(times.ida) : "al llegar"}` : null,
    t.ways.includes("vuelta") ? `Vuelta ${times.vuelta ? whenText(times.vuelta) : "antes del vuelo"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`card trip-leg transfer ${off ? "off" : ""}`}>
      <Icon name="car" size={18} />
      <span className="grow">
        <strong>{title}</strong>
        <span className="small muted">
          Auto privado · aeropuerto {t.airport} a unos {t.km} km{cars > 1 ? ` · ${cars} autos` : ""}
        </span>
        <span className="small">{when}</span>
        <span className="small muted">
          {both ? "Del aeropuerto al hotel y del hotel al aeropuerto. " : ""}
          {off ? "No está sumado al total." : "Estimado: ya está sumado al total, pero podés quitarlo."}
        </span>
      </span>
      <span className="trip-leg-price">
        {off ? <s>{money(transferCost(t, party))}</s> : <strong>{money(transferCost(t, party))}</strong>}
        <span className="small muted">Estimado</span>
        {t.link && (
          <a className="button secondary" href={t.link} target="_blank" rel="noreferrer sponsored">
            Ver precio exacto <Icon name="external" size={14} />
          </a>
        )}
        <button type="button" className="leg-action" onClick={onToggle} aria-pressed={!off}>
          {off ? "Sumar al total" : "Quitar"}
        </button>
      </span>
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
  options,
  onPick,
  strip,
  onDay,
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
  /** Otros vuelos del mismo día ("Cambiar vuelo"). */
  options?: LegOption[];
  onPick?: (o: LegOption) => void;
  /** Precio por día cercano (solo la ida): elegir otro día vuelve a armar el viaje. */
  strip?: { date: string; price: number }[];
  onDay?: (d: string) => void;
}) {
  const [changing, setChanging] = useState(false);
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
        {leg.flight && leg.priceKind !== "manual" && <FlightInfoBlock f={leg.flight} roundTrip={Boolean(leg.returnDate)} />}
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
        {options && options.length > 1 && onPick && (
          <button type="button" className="leg-action" aria-expanded={changing} onClick={() => setChanging((c) => !c)}>
            {changing ? "Cerrar" : "Cambiar vuelo"}
          </button>
        )}
        {onManual && <ManualPrice leg={leg} onManual={onManual} />}
      </span>
      {changing && options && onPick && (
        <div className="leg-options">
          <p className="small muted">Otros vuelos de ese día, precio por adulto visto en {options[0].source === "google" ? "Google Flights" : "Aviasales en los últimos días"}:</p>
          <ul className="leg-option-list">
            {options.map((o, i) => {
              const on = sameOption(o.flight, leg.flight);
              return (
                <li key={i} className={on ? "on" : ""}>
                  <span className="grow">
                    <FlightInfoBlock f={o.flight} roundTrip={Boolean(o.flight.back)} compact />
                  </span>
                  <span className="leg-option-price">
                    <strong>{money(o.price)}</strong>
                    <button
                      type="button"
                      className={on ? "primary" : "secondary"}
                      aria-pressed={on}
                      onClick={() => {
                        onPick(o);
                        setChanging(false);
                      }}
                    >
                      {on ? "Elegido" : "Elegir"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {strip && strip.length > 1 && onDay && (
        <div className="leg-days">
          <p className="small muted">Salir otro día (por adulto, visto en los últimos días). Cambia las fechas de todo el viaje:</p>
          <div className="strip" role="list" aria-label="Precio por día de salida">
            {strip.map((d) => (
              <button
                key={d.date}
                role="listitem"
                className={`strip-day ${d.date === leg.date ? "on" : ""} ${d.price === Math.min(...strip.map((x) => x.price)) ? "cheap" : ""}`}
                onClick={() => d.date !== leg.date && onDay(d.date)}
                aria-current={d.date === leg.date ? "date" : undefined}
              >
                <span>{capitalize(shortDate(d.date))}</span>
                <strong>{money(d.price)}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
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
  const { profile } = useApp();
  const [data, setData] = useState<TripHotels | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  // Hotel encontrado por nombre ("Buscar un hotel"): si se elige, reemplaza la elección de la lista.
  const [found, setFound] = useState<RealHotel | null>(null);
  const [meal, setMeal] = useState<MealPlan>(profile.mealPlan ?? "room");
  const [beach, setBeach] = useState(profile.beachfront ?? false);
  const roomsLabel = describeRooms(party);
  const occupancy = roomOccupancy(party);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    setFound(null);
    onPick(null);
    api
      .tripHotels({
        name: stop.name,
        country: stop.country,
        lat: stop.lat,
        lon: stop.lon,
        checkin: stop.checkin,
        nights: stop.nights,
        travelers,
        rooms,
        style,
        ...partyToParams(party),
        ...(meal !== "room" ? { meal } : {}),
        ...(beach ? { beach: 1 as const } : {}),
      })
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.name, stop.checkin, stop.nights, travelers, rooms, attempt, meal, beach]);

  const hotels = sortHotelsFor(data?.hotels ?? [], meal, beach).slice(0, 6);
  const listed = hotels.find((h) => h.name === picked) ?? hotels[Math.floor(hotels.length / 3)];
  const choice = found ?? listed;

  useEffect(() => {
    if (!data) return;
    const at = new Date().toISOString();
    const units = stop.nights * rooms;
    if (choice) {
      // El régimen va en la etiqueta solo si el precio lo incluye según la fuente.
      const covered = priceIncludesPlan(choice, meal);
      const plan = meal === "room" ? "" : covered ? ` (${MEAL_PLAN_LABEL[meal].toLowerCase()})` : " (precio real, puede ser solo alojamiento)";
      onPick({
        label: `${choice.name}${plan} · ${roomsLabel}`,
        total: choice.totalUSD * rooms,
        real: true,
        link: choice.link ?? choice.tripadvisorUrl ?? undefined,
        quote: {
          kind: "exacto",
          source: choice.key ? "xotelo" : "google",
          at,
          unitUSD: choice.nightlyUSD,
          units,
          ...(choice.key
            ? { hotel: { key: choice.key, checkin: stop.checkin, checkout: stop.checkout, adults: occupancy.adults, ages: occupancy.childAges } }
            : {}),
        },
      });
    } else {
      const plan = data.estimatePlan && data.estimatePlan !== "room" ? `, ${MEAL_PLAN_LABEL[data.estimatePlan].toLowerCase()}` : "";
      onPick({
        label: `alojamiento${plan} · ${roomsLabel}`,
        total: data.estimateNight * units,
        real: false,
        quote: { kind: "estimado", source: "estimado", at, unitUSD: data.estimateNight, units },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, choice?.name, rooms, meal]);

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

      <HotelFilters mealPlan={meal} onMealPlan={setMeal} beachfront={beach} onBeachfront={setBeach} />
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
          Precios reales {data.source === "google" ? "de Google Hotels" : "comparados entre Booking, Agoda, Expedia y más"} para tus fechas · {roomsLabel}.
          Elegí uno:
        </p>
      )}
      {data && hotels.length > 0 && <MealPlanNote mealPlan={meal} />}
      {data && hotels.length > 0 && (
        <div className="hotel-results">
          {hotels.map((h) => (
            <TripHotelCard
              key={h.name}
              h={h}
              stop={stop}
              rooms={rooms}
              money={money}
              party={party}
              mealPlan={meal}
              roomsLabel={roomsLabel}
              selected={choice === h}
              onSelect={() => (setFound(null), setPicked(h.name))}
            />
          ))}
        </div>
      )}
      {data && hotels.length === 0 && (
        <div className="trip-estimate">
          {beach && (data.hotels.length ?? 0) > 0 && (
            <p className="small muted">Entre los hoteles con precio no hay ninguno que diga tener acceso a la playa.</p>
          )}
          <p>
            {data.estimatePlan === "all" ? "All inclusive estimado" : "Alojamiento estimado"}:{" "}
            <strong>{money(data.estimateNight * stop.nights * rooms)}</strong>{" "}
            <span className="small muted">
              ({data.estimatePlan === "all" ? "comidas y bebidas incluidas" : `${money(data.estimateNight)} por noche`} · {roomsLabel}
              {data.estimatePlan && data.estimatePlan !== "room" && data.estimatePlan !== "all" ? ` · ${MEAL_PLAN_LABEL[data.estimatePlan].toLowerCase()}` : ""}
              {data.estimateFrom ? `, según precios de la zona de ${data.estimateFrom}` : ""})
            </span>
          </p>
          {meal === "all" && data.estimatePlan !== "all" && (
            <p className="small muted">En esta zona casi no hay all inclusive: el estimado es de solo alojamiento.</p>
          )}
        </div>
      )}
      {data && (
        <HotelFinder
          place={stop.name}
          country={stop.country}
          lat={stop.lat}
          lon={stop.lon}
          checkin={stop.checkin}
          nights={stop.nights}
          party={party}
          mealPlan={meal}
          renderHotel={(h) => (
            <TripHotelCard
              key={`found-${h.name}`}
              h={h}
              stop={stop}
              rooms={rooms}
              money={money}
              party={party}
              mealPlan={meal}
              roomsLabel={roomsLabel}
              selected={found?.name === h.name}
              onSelect={() => setFound(found?.name === h.name ? null : h)}
            />
          )}
        />
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
  party,
  mealPlan,
  roomsLabel,
  selected,
  onSelect,
}: {
  h: RealHotel;
  stop: TripPlan["stops"][number];
  rooms: number;
  money: (n: number) => string;
  party: Party;
  mealPlan: MealPlan;
  roomsLabel: string;
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
        <HotelBadges h={h} mealPlan={mealPlan} />
        <span className="price">{money(h.totalUSD * rooms)}</span>
        <span className="small muted">
          {money(h.nightlyUSD)} por noche{rooms > 1 ? " por habitación" : ""} · {nights} {nights === 1 ? "noche" : "noches"}
          {h.site ? ` · en ${h.site}` : ""}
        </span>
        <span className="small muted">{roomsLabel}</span>
        <MealPlanPriceLink h={h} city={stop.name} checkin={stop.checkin} checkout={stop.checkout} party={party} mealPlan={mealPlan} />
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
