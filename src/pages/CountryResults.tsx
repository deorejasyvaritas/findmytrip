import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ExploreResponse, GeoPlace, Interest, MealPlan } from "../../shared/types.ts";
import { countryByCode, countryCodeOf, type Country } from "../../shared/countries.ts";
import {
  countryExploreRequest,
  countryRoutes,
  countrySearchToParams,
  rankCountry,
  scaleRouteNights,
  suggestionFlightLabel,
  tripParamsFor,
  type CountryOption,
  type CountrySearch,
  type CountrySort,
} from "../../shared/country-search.ts";
import { ROUTES, bestMonthsLabel, routeNights, routePrice, type CuratedRoute, type RoutesResponse } from "../../shared/routes.ts";
import { MEAL_PLANS, MEAL_PLAN_LABEL } from "../../shared/meal-plan.ts";
import { describeParty, headcount, partyToParams } from "../../shared/pricing.ts";
import { addDaysIso } from "../../shared/trip-window.ts";
import { GeoInput } from "../components/FullSearch.tsx";
import { ClimateLine } from "../components/Climate.tsx";
import Icon from "../components/Icon.tsx";
import InterestPicker from "../components/InterestPicker.tsx";
import Segmented from "../components/Segmented.tsx";
import { Photo, SuggestionSkeleton } from "../components/SuggestionCard.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatRange, isDomestic, monthName } from "../lib/format.ts";

// "Ya sé a dónde" con un país entero (por ejemplo, Brasil): los destinos del
// catálogo en ese país ordenados por el costo total del grupo, las rutas armadas
// que pasan por ahí y, si no hay destinos, sus ciudades principales para armar
// el viaje con precios reales.

export default function CountryResults({ search }: { search: CountrySearch }) {
  const { profile, destinations } = useApp();
  const [, setParams] = useSearchParams();
  const country = countryByCode(search.country)!;
  const [data, setData] = useState<ExploreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [routesFailed, setRoutesFailed] = useState(false);

  // El pedido no depende del presupuesto, los intereses ni el orden: eso se filtra acá.
  const request = useMemo(
    () => countryExploreRequest({ ...search, budget: null, interests: [], sort: "barato" }, profile.style),
    [search.country, search.from, search.dates.depart, search.dates.window?.from, search.dates.window?.to, search.dates.pinned, search.nights, JSON.stringify(search.party), search.meal, profile.style],
  );
  const origin = request.origin;
  const month = `${request.year}-${String(request.month).padStart(2, "0")}`;

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .explore(request)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [request, attempt]);

  const combos = useMemo(() => countryRoutes(country.code, ROUTES), [country.code]);
  useEffect(() => {
    if (!combos.length) return;
    let alive = true;
    setRoutes(null);
    setRoutesFailed(false);
    api
      .routes(origin, month)
      .then((d) => alive && setRoutes(d))
      .catch(() => alive && setRoutesFailed(true));
    return () => {
      alive = false;
    };
  }, [origin, month, combos.length]);

  /** Cambia filtros u orden en la URL (se puede compartir y volver atrás). */
  function update(patch: Partial<CountrySearch>) {
    const next = countrySearchToParams({ ...search, ...patch });
    setParams(next, { replace: true });
  }

  const inCountry = destinations.filter((d) => countryCodeOf(d.country) === country.code);
  const interestOptions = useMemo(() => {
    const tags = new Set<Interest>(inCountry.flatMap((d) => d.tags));
    return [...tags];
  }, [inCountry.length, country.code]);
  const ranked = data ? rankCountry(data.suggestions, { sort: search.sort, budget: search.budget, interests: search.interests }) : null;
  const shownIds = new Set((data?.suggestions ?? []).map((s) => s.destination.id));
  // Con all inclusive solo van destinos donde se consigue: avisamos cuáles quedan afuera.
  const withoutPlan = data && search.meal === "all" ? inCountry.filter((d) => !shownIds.has(d.id)) : [];
  const noCatalog = destinations.length > 0 && inCountry.length === 0;
  const travelers = headcount(search.party);

  return (
    <div className="stack-lg country-results">
      <CountryControls search={search} interestOptions={interestOptions} onChange={update} />

      <section className="stack" aria-live="polite" aria-busy={!data && !error}>
        <div className="section-head">
          <h2 className="section-title">
            <Icon name="globe" size={22} />
            Paquetes en {country.name}
          </h2>
          <span className="small muted">
            Vuelo y alojamiento{search.meal ? ` (${MEAL_PLAN_LABEL[search.meal].toLowerCase()})` : ""} para {travelers}{" "}
            {travelers === 1 ? "persona" : "personas"}. Comidas y paseos, aparte.
          </span>
        </div>

        {error ? (
          <div className="card empty" role="alert">
            <Icon name="info" size={28} />
            <p>No pudimos buscar los destinos de {country.name}. Revisá la conexión y probá de nuevo.</p>
            <button className="primary" onClick={() => setAttempt((a) => a + 1)}>
              <Icon name="refresh" size={16} />
              Reintentar
            </button>
          </div>
        ) : noCatalog ? (
          <CitiesFallback country={country} search={search} />
        ) : !data || !ranked ? (
          <div className="grid-cards">
            {Array.from({ length: 3 }, (_, i) => (
              <SuggestionSkeleton key={i} />
            ))}
          </div>
        ) : ranked.within.length + ranked.over.length === 0 ? (
          <div className="card empty">
            <Icon name="compass" size={28} />
            {search.interests.length ? (
              <>
                <p>Ningún destino de {country.name} tiene {joinOr(search.interests)}.</p>
                <button className="primary" onClick={() => update({ interests: [] })}>
                  Ver todos los destinos
                </button>
              </>
            ) : search.meal === "all" ? (
              <>
                <p>No conocemos resorts all inclusive en los destinos de {country.name} que tenemos.</p>
                <button className="primary" onClick={() => update({ meal: null })}>
                  Ver sin all inclusive
                </button>
              </>
            ) : (
              <p>No encontramos destinos de {country.name} para esas fechas. Probá con otra fecha o elegí una ciudad.</p>
            )}
          </div>
        ) : (
          <>
            {search.budget != null && ranked.within.length === 0 && (
              <p className="card country-note small">
                Ningún destino entra en {usd(search.budget)} para estas fechas. Abajo están los más cercanos, con cuánto se pasan.
              </p>
            )}
            {ranked.within.length > 0 && (
              <div className="grid-cards">
                {ranked.within.map((o) => (
                  <CountryCard key={o.s.destination.id} o={o} search={search} budget={search.budget} />
                ))}
              </div>
            )}
            {ranked.over.length > 0 && (
              <>
                <h3 className="country-subhead">Arriba de tu presupuesto</h3>
                <div className="grid-cards">
                  {ranked.over.map((o) => (
                    <CountryCard key={o.s.destination.id} o={o} search={search} budget={search.budget} />
                  ))}
                </div>
              </>
            )}
            <p className="small muted">
              Los totales son para comparar destinos. Al armar el viaje buscamos los vuelos y hoteles de tus fechas.
            </p>
          </>
        )}

        {withoutPlan.length > 0 && (
          <p className="small muted">
            Sin all inclusive conocido: {withoutPlan.map((d) => d.name).join(", ")}.{" "}
            <button type="button" className="link" onClick={() => update({ meal: null })}>
              Verlos sin all inclusive
            </button>
          </p>
        )}
      </section>

      {combos.length > 0 && (
        <section className="stack">
          <div className="section-head">
            <h2 className="section-title">
              <Icon name="compass" size={22} />
              Combinaciones
            </h2>
            <span className="small muted">Rutas de varias paradas, repartidas en tus {search.nights} noches</span>
          </div>
          {routesFailed && <p className="small muted">No pudimos traer los precios de referencia. Igual podés armar cada ruta con el precio de hoy.</p>}
          <div className="grid-cards">
            {combos.map((r) => (
              <ComboCard key={r.id} route={r} search={search} routes={routes} loading={!routes && !routesFailed} />
            ))}
          </div>
        </section>
      )}

      {!noCatalog && <OtherCity country={country} search={search} />}
    </div>
  );
}

const usd = (n: number) => `USD ${Math.round(n).toLocaleString("es-AR")}`;

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}

/** Orden, presupuesto, régimen e intereses. Todo vive en la URL. */
function CountryControls({
  search,
  interestOptions,
  onChange,
}: {
  search: CountrySearch;
  interestOptions: Interest[];
  onChange: (p: Partial<CountrySearch>) => void;
}) {
  const [budget, setBudget] = useState(search.budget ? String(search.budget) : "");
  useEffect(() => setBudget(search.budget ? String(search.budget) : ""), [search.budget]);
  const commit = (e?: FormEvent) => {
    e?.preventDefault();
    const n = Number(budget);
    const next = budget && n > 0 ? n : null;
    if (next !== search.budget) onChange({ budget: next });
  };
  return (
    <section className="card country-controls" aria-label="Orden y filtros">
      <Segmented<CountrySort>
        label="Ordenar"
        value={search.sort}
        onChange={(sort) => onChange({ sort })}
        options={[
          { value: "barato", label: "Más barato" },
          { value: "epoca", label: "Mejor época" },
        ]}
      />
      <form className="country-fields" onSubmit={commit}>
        <label className="field">
          Presupuesto total (USD)
          <input
            type="text"
            inputMode="numeric"
            placeholder="Sin tope"
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => commit()}
            enterKeyHint="done"
          />
        </label>
        <label className="field">
          Régimen
          <select value={search.meal ?? "room"} onChange={(e) => onChange({ meal: e.target.value === "room" ? null : (e.target.value as MealPlan) })}>
            {MEAL_PLANS.map((m) => (
              <option key={m} value={m}>
                {MEAL_PLAN_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </form>
      {interestOptions.length > 1 && (
        <InterestPicker label="Qué buscás" options={interestOptions} value={search.interests} onChange={(interests) => onChange({ interests })} />
      )}
    </section>
  );
}

function CountryCard({ o, search, budget }: { o: CountryOption; search: CountrySearch; budget: number | null }) {
  const app = useApp();
  const navigate = useNavigate();
  const { s, over, goodSeason } = o;
  const d = s.destination;
  const domestic = isDomestic(d.region);
  const money = (n: number) => app.money(n, { domestic });
  const nights = s.nights ?? search.nights;
  const depart = s.depart ?? search.dates.pinned ?? (search.dates.window ? null : search.dates.depart);
  const ret = s.ret ?? (depart ? addDaysIso(depart, nights) : null);
  const when = depart && ret ? formatRange(depart, ret) : `${capitalize(monthName(s.month))} ${s.year}`;
  const requested = search.dates.window ? null : search.dates.depart;
  const flightLabel = suggestionFlightLabel(s, requested);
  const lodgingLabel = s.lodgingSource === "google" ? "Google Hotels" : "Estimado";
  const climateDate = depart ?? search.dates.window?.from ?? search.dates.depart;
  const q = new URLSearchParams({ month: `${s.year}-${String(s.month).padStart(2, "0")}`, nights: String(nights), ...partyToParams(search.party) });
  if (depart) q.set("depart", depart);
  if (search.meal) q.set("meal", search.meal);
  if (search.dates.window) (q.set("from", search.dates.window.from), q.set("to", search.dates.window.to));
  const left = budget != null && over == null ? Math.round(budget - s.cost.total) : null;

  function build() {
    const stop = { name: d.name, region: null, country: d.country, lat: d.lat, lon: d.lon, nights, destinationId: d.id };
    navigate(`/buscar?${tripParamsFor(search, [stop])}`);
  }

  return (
    <article className="card suggestion country-card">
      <Photo src={app.photos[d.id]} name={d.name} />
      <div className="suggestion-head">
        <div>
          <h3>{d.name}</h3>
          <p className="small muted">
            {when} · {nights} noches
          </p>
        </div>
        {over != null ? (
          <span className="badge badge-warn">{money(over)} arriba de tu presupuesto</span>
        ) : left != null ? (
          <span className="badge badge-ok">Entra en tu presupuesto</span>
        ) : null}
      </div>
      {d.highlights.length > 0 && (
        <ul className="chips static country-highlights" aria-label="Imperdibles">
          {d.highlights.slice(0, 3).map((h) => (
            <li key={h} className="chip">
              {h}
            </li>
          ))}
        </ul>
      )}
      <div className="country-price">
        <div className="price">{money(s.cost.total)}</div>
        <div className="small muted">
          Total para {describeParty(search.party).toLowerCase()} · {money(s.cost.perPerson)} por persona
        </div>
        {left != null && left > 0 && (
          <div className="small muted">
            {!s.cost.dailyIncluded && s.cost.daily > 0
              ? left >= s.cost.daily
                ? `Te quedan ${money(left)}: alcanza para comidas y paseos (estimados en ${money(s.cost.daily)})`
                : `Te quedan ${money(left)}, pero comidas y paseos se estiman en ${money(s.cost.daily)}`
              : `Te quedan ${money(left)} del presupuesto`}
          </div>
        )}
      </div>
      <dl className="country-lines small">
        <div>
          <dt>
            <Icon name="plane" size={14} /> Vuelos {money(s.cost.flights + s.cost.bags)}
          </dt>
          <dd className={s.flightSource !== "estimado" ? "real" : "muted"}>{flightLabel}</dd>
        </div>
        <div>
          <dt>
            <Icon name="bed" size={14} /> {s.cost.mealPlan === "all" ? "All inclusive" : "Alojamiento"} {money(s.cost.lodging)}
          </dt>
          <dd className={s.lodgingSource !== "estimado" ? "real" : "muted"}>{lodgingLabel}</dd>
        </div>
        {!s.cost.dailyIncluded && (
          <div>
            <dt>
              <Icon name="utensils" size={14} /> {s.cost.mealPlan === "all" ? "Paseos aparte" : "Comidas y paseos aparte"} +{money(s.cost.daily)}
            </dt>
            <dd className="muted">Estimado</dd>
          </div>
        )}
      </dl>
      <div className="country-season small">
        {goodSeason ? (
          <span className="badge badge-ok">Buena época en {monthName(s.month)}</span>
        ) : (
          <span className="muted">
            <Icon name="sun" size={14} /> Mejor época: {bestMonthsLabel(d.bestMonths)}
          </span>
        )}
        <ClimateLine lat={d.lat} lon={d.lon} date={climateDate} />
      </div>
      <div className="card-actions country-actions">
        <button type="button" className="primary" onClick={build}>
          Armar el viaje
        </button>
        <Link className="button secondary" to={`/destino/${d.id}?${q}`}>
          Ver destino
        </Link>
      </div>
    </article>
  );
}

function ComboCard({ route: r, search, routes, loading }: { route: CuratedRoute; search: CountrySearch; routes: RoutesResponse | null; loading: boolean }) {
  const { money, photos } = useApp();
  const navigate = useNavigate();
  const m = Number((search.dates.window?.from ?? search.dates.depart).slice(5, 7));
  const price = routePrice(routes?.quotes[r.id], monthName(m));
  const stops = scaleRouteNights(r, search.nights);
  const nights = stops.reduce((n, s) => n + s.nights, 0);
  const photo = r.stops.map((s) => s.destinationId && photos[s.destinationId]).find(Boolean) || null;
  const domestic = r.countries.every((c) => c === "Argentina");
  return (
    <article className="card route-card" aria-labelledby={`combo-${r.id}`}>
      <div className="photo">{photo ? <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Icon name="compass" size={36} />}</div>
      <div className="route-body">
        <div className="stack-sm">
          <p className="small muted">{r.countries.join(" · ")}</p>
          <h3 id={`combo-${r.id}`}>{r.name}</h3>
          <p className="small muted route-meta">
            {nights} noches · {r.stops.length} paradas
            {nights !== routeNights(r) && " · ajustada a tus noches"}
            {r.bestMonths.includes(m) && <span className="badge badge-ok">Buena época en {monthName(m)}</span>}
          </p>
        </div>
        <ol className="route-line" aria-label="Recorrido">
          {stops.map((s, i) => (
            <li key={s.name}>
              {i > 0 && <Icon name="chevronRight" size={14} />}
              <span>
                {s.name} ({s.nights})
              </span>
            </li>
          ))}
        </ol>
        <div className="route-price">
          {loading ? (
            <div className="sk" style={{ width: "55%", height: 22 }} aria-hidden="true" />
          ) : price.kind === "estimate" ? (
            <>
              <p>
                <span className="small muted">Desde </span>
                <span className="price">{money(price.perPersonUSD, { domestic })}</span>
                <span className="small muted"> por persona</span>
              </p>
              <p className="small muted">{price.basis}</p>
            </>
          ) : (
            <p className="small muted">{price.reason} Al armarla te mostramos el precio de hoy.</p>
          )}
        </div>
        <button type="button" className="primary route-cta" onClick={() => navigate(`/buscar?${tripParamsFor(search, stops)}`)}>
          Armar este viaje
        </button>
      </div>
    </article>
  );
}

/** País sin destinos en el catálogo: sus ciudades principales, para armar el viaje con precios reales. */
function CitiesFallback({ country, search }: { country: Country; search: CountrySearch }) {
  const navigate = useNavigate();
  const go = (city: { name: string; lat: number; lon: number }) =>
    navigate(`/buscar?${tripParamsFor(search, [{ name: city.name, country: country.name, lat: city.lat, lon: city.lon, nights: search.nights }])}`);
  return (
    <div className="card stack country-fallback">
      <p>
        Todavía no tenemos destinos de {country.name} con paquetes comparados. Elegí una ciudad y armamos el viaje con los vuelos y hoteles de tus fechas.
      </p>
      <div className="stack-sm">
        {country.cities.map((c) => (
          <button key={c.name} type="button" className="country-city" onClick={() => go(c)}>
            <Icon name="pin" size={18} />
            <span className="grow">
              <strong>{c.name}</strong>
              <span className="small muted">
                {search.nights} noches · {describeParty(search.party)}
              </span>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        ))}
      </div>
      <OtherCity country={country} search={search} bare />
    </div>
  );
}

/** "¿Tenés otra ciudad en mente?": cualquier lugar del país, con las mismas fechas y grupo. */
function OtherCity({ country, search, bare }: { country: Country; search: CountrySearch; bare?: boolean }) {
  const navigate = useNavigate();
  const [place, setPlace] = useState<GeoPlace | null>(null);
  const body = (
    <form
      className="country-other"
      onSubmit={(e) => {
        e.preventDefault();
        if (place) navigate(`/buscar?${tripParamsFor(search, [{ ...place, nights: search.nights }])}`);
      }}
    >
      <GeoInput label={`Otra ciudad de ${country.name}`} value={place} onChange={setPlace} />
      <button className="secondary" disabled={!place}>
        Armar el viaje
      </button>
    </form>
  );
  if (bare) return body;
  return (
    <section className="stack">
      <div className="section-head">
        <h2 className="section-title">
          <Icon name="pin" size={22} />
          ¿Tenés otra ciudad en mente?
        </h2>
        <span className="small muted">Armamos el viaje a cualquier lugar, también pueblos sin aeropuerto</span>
      </div>
      {body}
    </section>
  );
}
