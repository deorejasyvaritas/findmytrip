import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Bags, ExploreResponse, Interest, MealPlan, Party, Profile, Region, Style, TripPackage, WatchItem, When } from "../../shared/types.ts";
import { BAGS_LABEL, describeParty } from "../../shared/pricing.ts";
import Icon from "../components/Icon.tsx";
import InterestPicker from "../components/InterestPicker.tsx";
import LongWeekends from "../components/LongWeekends.tsx";
import { FlightForm, HotelForm, MultiForm, TripForm } from "../components/FullSearch.tsx";
import RadarSection from "../components/RadarSection.tsx";
import Segmented from "../components/Segmented.tsx";
import LodgingPicker from "../components/LodgingPicker.tsx";
import { CompareToggle } from "../components/Compare.tsx";
import SuggestionCard, { Photo, SuggestionSkeleton } from "../components/SuggestionCard.tsx";
import { PartyPicker, WhenPicker, describeWhen, validateWhen } from "../components/TripPickers.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate, formatRange, isDomestic, monthName, timeAgo } from "../lib/format.ts";
import { HERO_FALLBACK, pickHeroTiles, shortRange, tileHref } from "../lib/hero-picks.ts";
import { savedCheck } from "../lib/price-check.ts";
import { useRadar } from "../lib/radar.ts";
import { useStored } from "../lib/storage.ts";

interface Search {
  budgetUSD: number;
  nights: number;
  when: When;
  party: Party;
  style: Style;
  interests: Interest[];
  regions: Region[];
  /** Tope del vuelo ida y vuelta por persona, en USD (0 = sin tope). */
  maxFlightPP: number;
  directOnly: boolean;
  /** Solo salidas en los próximos fines de semana largos. */
  longWeekends?: boolean;
  /** Régimen: con all inclusive solo destinos donde hay (alojamiento estimado por persona). */
  mealPlan?: MealPlan;
}

type Sheet = "when" | "party" | null;

// Topes de vuelo por persona (USD) para el filtro de la búsqueda.
const FLIGHT_CAPS = [200, 300, 500, 800, 1200];

/** Búsquedas guardadas con el formato anterior (mes + viajeros) se adaptan al nuevo. */
function migrate(s: (Partial<Search> & { month?: number | null; travelers?: number }) | null, fallback: Search): Search | null {
  if (!s) return null;
  return {
    ...fallback,
    ...s,
    when: s.when ?? (s.month ? { kind: "months", months: [{ month: s.month, year: new Date().getFullYear() + (s.month < new Date().getMonth() + 1 ? 1 : 0) }] } : { kind: "flexible" }),
    party: s.party ?? { adults: s.travelers ?? fallback.party.adults, childAges: [], bags: "cabin" },
  } as Search;
}

const nightsBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

type HomeTab = "budget" | "destination" | "vuelos" | "hoteles" | "paquete" | "multi";
const HOME_TABS: { id: HomeTab; label: string }[] = [
  { id: "budget", label: "Presupuesto" },
  { id: "destination", label: "Ya sé a dónde" },
  { id: "vuelos", label: "Vuelos" },
  { id: "hoteles", label: "Hoteles" },
  { id: "paquete", label: "Vuelo + Hotel" },
  { id: "multi", label: "Multidestino" },
];

export default function Home() {
  const app = useApp();
  const { profile, meta, destinations, packages, watchlist, photos } = app;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<HomeTab>(() => (HOME_TABS.some((t) => t.id === params.get("tab")) ? (params.get("tab") as HomeTab) : "budget"));
  const [rawLast, setLastSearch] = useStored<Search | null>("fmt.lastSearch", null);

  const defaults: Search = {
    budgetUSD: 1500 * profile.travelers,
    nights: 7,
    when: { kind: "flexible" },
    party: { adults: profile.travelers, childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" },
    style: profile.style,
    interests: profile.interests,
    regions: [],
    maxFlightPP: 0,
    directOnly: false,
    mealPlan: profile.mealPlan ?? "room",
  };
  const lastSearch = migrate(rawLast, defaults);
  const [form, setForm] = useState<Search>(lastSearch ?? defaults);
  const [budgetInput, setBudgetInput] = useState(String(app.fromUSD(form.budgetUSD)));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado de la última búsqueda pedida con el botón (se muestra al lado del botón).
  const [status, setStatus] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [destQuery, setDestQuery] = useState("");
  // En el celular los filtros secundarios van plegados: así el botón de buscar queda a la vista.
  const [moreFilters, setMoreFilters] = useState(false);

  // Destinos que el usuario ya tiene en mente: los usamos para sugerir alternativas.
  const known = useMemo(
    () => [...new Set([...packages.map((p) => p.destinationId), ...watchlist.map((w) => w.destinationId)])],
    [packages, watchlist],
  );

  async function run(s: Search, fromButton = false) {
    setLoading(true);
    setError(null);
    if (fromButton) setStatus(null);
    try {
      const nights = s.when.kind === "exact" ? nightsBetween(s.when.depart, s.when.ret) : s.nights;
      const res = await api.explore({
        origin: profile.origin,
        budgetUSD: s.budgetUSD,
        travelers: s.party.adults,
        party: s.party,
        nights,
        month: null,
        when: s.when,
        style: s.style,
        interests: s.interests,
        regions: s.regions.length ? s.regions : undefined,
        exclude: profile.visited,
        known,
        maxFlightHours: profile.maxFlightHours,
        includeDaily: profile.includeDaily ?? false,
        maxFlightPP: s.maxFlightPP || undefined,
        directOnly: s.directOnly || undefined,
        longWeekendsOnly: (s.longWeekends && s.when.kind !== "exact") || undefined,
        mealPlan: s.mealPlan && s.mealPlan !== "room" ? s.mealPlan : undefined,
        // Presupuesto en pesos: para destinos de Argentina rinde al dólar oficial.
        domesticBudgetUSD: profile.currency === "ARS" ? Math.round(app.toUSD(app.fromUSD(s.budgetUSD), { domestic: true })) : undefined,
      });
      setResult(res);
      if (fromButton) {
        const n = res.suggestions.length + res.alternatives.length;
        setStatus(
          n
            ? `Listo: ${n} destinos para tu búsqueda.`
            : s.longWeekends
              ? "No encontramos escapadas para los próximos fines de semana largos. Probá subir el presupuesto o quitar el filtro."
              : s.mealPlan === "all"
                ? "No encontramos destinos con all inclusive para ese presupuesto. Probá subir el presupuesto, bajar las noches o elegir otro régimen."
                : "No encontramos destinos con esos datos. Probá subir el presupuesto o cambiar fechas.",
        );
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    } catch (e) {
      setError((e as Error).message);
      if (fromButton) setStatus(`No pudimos buscar: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  // Al entrar mostramos ideas con la última búsqueda (o el perfil).
  useEffect(() => {
    run(lastSearch ?? defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.origin, profile.includeDaily]);

  // Cambia la moneda en el momento (sin ir a Perfil) y convierte el presupuesto escrito.
  function setCurrency(currency: Profile["currency"]) {
    if (currency === profile.currency) return;
    const usd = app.toUSD(Number(budgetInput) || 0);
    const rate = meta?.usdArsRate ?? 1450;
    if (budgetInput) setBudgetInput(String(Math.round(currency === "ARS" ? usd * rate : usd)));
    app.setProfile({ ...profile, currency });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateWhen(form.when);
    if (problem) {
      setFormError(problem);
      setSheet("when");
      return;
    }
    const budgetUSD = Math.round(app.toUSD(Number(budgetInput) || 0));
    if (budgetUSD <= 0) {
      setFormError("Poné cuánto querés gastar en total.");
      return;
    }
    setFormError(null);
    setSheet(null);
    const s = { ...form, budgetUSD };
    setForm(s);
    setLastSearch(s);
    run(s, true);
  }

  const filteredDest = destinations.filter((d) =>
    `${d.name} ${d.country} ${d.tags.join(" ")}`.toLowerCase().includes(destQuery.toLowerCase()),
  );
  const originName = meta?.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;
  const shown = lastSearch ?? defaults;
  const nightsShown = shown.when.kind === "exact" ? nightsBetween(shown.when.depart, shown.when.ret) : shown.nights;
  const exact = form.when.kind === "exact";
  const rangeShown =
    shown.when.kind === "window"
      ? { from: shown.when.from, to: shown.when.to }
      : shown.when.kind === "exact"
        ? { from: shown.when.depart, to: shown.when.depart }
        : undefined;

  const searched = Boolean(lastSearch);
  const activeFilters =
    (form.regions.length ? 1 : 0) + (form.maxFlightPP ? 1 : 0) + (form.directOnly ? 1 : 0) + (form.longWeekends && !exact ? 1 : 0) + form.interests.length;

  // Un solo bloque (con el ancla para bajar hasta los resultados al buscar).
  const resultsArea = (
    <div ref={resultsRef} className="stack-lg scroll-anchor">
      {error && (
        <div className="card empty" role="alert">
          <Icon name="info" size={28} />
          <p>No pudimos cargar los precios: {error}</p>
          <button className="secondary" onClick={() => run(lastSearch ?? defaults)}>
            Reintentar
          </button>
        </div>
      )}

      {loading && (
        <section aria-busy="true" aria-label="Buscando opciones">
          <div className="section-head">
            <h2>Buscando las mejores opciones</h2>
          </div>
          <div className="grid-cards">
            {Array.from({ length: 6 }, (_, i) => (
              <SuggestionSkeleton key={i} />
            ))}
          </div>
        </section>
      )}

      {result && !loading && (
        <>
          <section>
            <div className="section-head">
              <h2>{searched ? "Mejores opciones para vos" : "Ideas para vos"}</h2>
              <div className="section-tools">
                <span className="small muted">
                  {result.suggestions.length} de {result.considered} destinos entran en {app.money(shown.budgetUSD)} · {describeParty(shown.party)}
                </span>
                <Segmented
                  label="Moneda"
                  value={profile.currency}
                  onChange={setCurrency}
                  options={[
                    { value: "USD", label: "USD" },
                    { value: "ARS", label: "ARS" },
                  ]}
                />
              </div>
            </div>
            {profile.currency === "ARS" && (
              <p className="small muted fx-note">Pesos al dólar tarjeta. Pagando con dólares propios no hay percepción del 30 %.</p>
            )}
            {shown.longWeekends && shown.when.kind !== "exact" && result.suggestions.length > 0 && (
              <p className="small muted fx-note">Salidas en los próximos fines de semana largos, a destinos de hasta 6 horas de vuelo.</p>
            )}
            {result.suggestions.length === 0 ? (
              <div className="card empty">
                <Icon name={shown.longWeekends ? "calendar" : "search"} size={28} />
                <h3>{shown.longWeekends ? "No hay escapadas para los fines largos con ese presupuesto" : "Con ese presupuesto no hay opciones todavía"}</h3>
                <p className="muted">
                  {shown.longWeekends
                    ? "Probá subir el presupuesto, elegir alojamiento económico o quitar el filtro de fines de semana largos."
                    : "Probá con menos noches, alojamiento económico o fechas flexibles: suelen abrir muchas opciones."}
                </p>
              </div>
            ) : (
              <div className="grid-cards">
                {result.suggestions.map((s) => (
                  <SuggestionCard key={s.destination.id} s={s} nights={nightsShown} party={shown.party} range={rangeShown} style={shown.style} />
                ))}
              </div>
            )}
          </section>

          {result.alternatives.length > 0 && (
            <section>
              <div className="section-head">
                <h2 className="section-title">
                  <Icon name="sparkles" size={22} />
                  Quizás no lo estabas considerando
                </h2>
                <span className="small muted">También entran en tu presupuesto</span>
              </div>
              <div className="grid-cards">
                {result.alternatives.map((s) => (
                  <SuggestionCard key={s.destination.id} s={s} nights={nightsShown} party={shown.party} range={rangeShown} style={shown.style} />
                ))}
              </div>
            </section>
          )}

          {result.extra.length > 0 && (
            <section>
              <div className="section-head">
                <h2 className="section-title">
                  <Icon name="globe" size={22} />
                  Más destinos con precio real
                </h2>
                <span className="small muted">Vuelo ida y vuelta por persona, fechas sugeridas por Google</span>
              </div>
              <div className="grid-cards">
                {result.extra.map((e) => (
                  <a key={`${e.name}-${e.airport}`} className="card suggestion" href={e.link ?? "#"} target="_blank" rel="noreferrer">
                    <Photo src={e.thumbnail} name={e.name} />
                    <div className="suggestion-head">
                      <div>
                        <h3>{e.name}</h3>
                        <p className="small muted">
                          {e.country} · {e.ret ? formatRange(e.depart, e.ret) : formatDate(e.depart)}
                        </p>
                      </div>
                      <Icon name="external" size={18} className="muted" />
                    </div>
                    <div className="price-row">
                      <div>
                        <div className="price">{app.money(e.flightPP)}</div>
                        <div className="small muted">Vuelo por persona{e.airline ? ` · ${e.airline}` : ""}</div>
                      </div>
                      {e.hotelNight && (
                        <div className="breakdown">
                          <span>
                            <Icon name="bed" size={14} /> desde {app.money(e.hotelNight)} por noche
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="card-foot">
                      <span className="source live">Google Flights, últimas 24 h</span>
                      <span>Ver en Google</span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="stack-lg">
      <section className="search-panel" aria-labelledby="search-title">
        <div className="hero">
          <div className="hero-copy">
            <p className="hero-eyebrow">{profile.name ? `Hola ${profile.name}` : "Tu agente de viajes"}</p>
            <h1 id="search-title">
              Viajá más lejos <span>con lo que tenés.</span>
            </h1>
            {/* En el celular se acorta: el mosaico ya dice desde dónde son los precios. */}
            <p className={`lead ${app.profileSaved ? "hide-sm" : ""}`}>
              <span className="hide-sm">Precios reales de vuelos y hoteles, saliendo desde {originName}. </span>
              {!app.profileSaved && (
                <>
                  <Link to="/perfil">Completá tu perfil</Link> para recomendaciones a tu medida.
                </>
              )}
            </p>
          </div>
          <HeroMosaic originName={originName} />
        </div>

        {/* Botones con aria-pressed (no role="tab"): cada uno cambia el formulario de abajo. */}
        <div className="search-tabs" role="group" aria-label="Tipo de búsqueda">
          {HOME_TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "vuelos" || tab === "paquete" ? (
          <FlightForm key={tab} kind={tab} />
        ) : tab === "hoteles" ? (
          <HotelForm />
        ) : tab === "multi" ? (
          <MultiForm />
        ) : tab === "budget" ? (
          <form className="stack" style={{ gap: 16 }} onSubmit={submit} noValidate>
            <div className="search-grid five">
              <label className="tile">
                <span>Presupuesto total ({profile.currency})</span>
                <input inputMode="numeric" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d]/g, ""))} required />
              </label>
              <button
                type="button"
                className="tile tile-button"
                aria-expanded={sheet === "when"}
                aria-controls="sheet"
                onClick={() => setSheet(sheet === "when" ? null : "when")}
              >
                <span>Cuándo</span>
                <strong>{describeWhen(form.when)}</strong>
              </button>
              <label className="tile">
                <span>Noches</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  disabled={exact}
                  value={form.when.kind === "exact" && form.when.depart && form.when.ret ? nightsBetween(form.when.depart, form.when.ret) : form.nights}
                  onChange={(e) => setForm({ ...form, nights: Number(e.target.value) })}
                />
              </label>
              <button
                type="button"
                className="tile tile-button"
                aria-expanded={sheet === "party"}
                aria-controls="sheet"
                onClick={() => setSheet(sheet === "party" ? null : "party")}
              >
                <span>Pasajeros</span>
                <strong>{describeParty(form.party)}</strong>
              </button>
              <label className="tile">
                <span>Equipaje por persona</span>
                <select value={form.party.bags} onChange={(e) => setForm({ ...form, party: { ...form.party, bags: e.target.value as Bags } })}>
                  {(Object.keys(BAGS_LABEL) as Bags[]).map((b) => (
                    <option key={b} value={b}>
                      {BAGS_LABEL[b]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {sheet && (
              <div className="sheet" id="sheet">
                <div className="sheet-head">
                  <h3>{sheet === "when" ? "¿Cuándo querés viajar?" : "¿Quiénes viajan?"}</h3>
                  <button type="button" className="plain" onClick={() => setSheet(null)}>
                    Listo
                  </button>
                </div>
                {sheet === "when" ? (
                  <WhenPicker value={form.when} onChange={(when) => (setForm({ ...form, when }), setFormError(null))} />
                ) : (
                  <PartyPicker value={form.party} onChange={(party) => setForm({ ...form, party })} />
                )}
              </div>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}

            <button
              type="button"
              className="more-filters-btn"
              aria-expanded={moreFilters}
              aria-controls="search-extras"
              onClick={() => setMoreFilters((v) => !v)}
            >
              <Icon name="sliders" size={16} />
              {moreFilters ? "Menos filtros" : activeFilters ? `Más filtros (${activeFilters})` : "Más filtros"}
              <Icon name="chevronDown" size={16} className={moreFilters ? "flip" : undefined} />
            </button>
            <div id="search-extras" className={`search-extras ${moreFilters ? "open" : ""}`}>
            <div className="search-row">
              <LodgingPicker
                value={form.style}
                onChange={(style) => setForm({ ...form, style })}
                mealPlan={form.mealPlan ?? "room"}
                onMealPlan={(mealPlan) => setForm({ ...form, mealPlan })}
              />
              <select
                className="inline"
                aria-label="Región"
                value={form.regions[0] ?? ""}
                onChange={(e) => setForm({ ...form, regions: e.target.value ? [e.target.value as Region] : [] })}
              >
                <option value="">Cualquier región</option>
                {meta?.regions.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <select
                className="inline"
                aria-label="Precio máximo de vuelo por persona"
                value={form.maxFlightPP}
                onChange={(e) => setForm({ ...form, maxFlightPP: Number(e.target.value) })}
              >
                <option value={0}>Sin tope de vuelo</option>
                {FLIGHT_CAPS.map((p) => (
                  <option key={p} value={p}>
                    Vuelo hasta {app.money(p)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`chip ${form.directOnly ? "on" : ""}`}
                aria-pressed={form.directOnly}
                onClick={() => setForm({ ...form, directOnly: !form.directOnly })}
              >
                Solo directos
              </button>
              <button
                type="button"
                className={`chip ${form.longWeekends && !exact ? "on" : ""}`}
                aria-pressed={Boolean(form.longWeekends && !exact)}
                disabled={exact}
                title={exact ? "Con fechas exactas no aplica" : "Salidas en los próximos fines de semana largos"}
                onClick={() => setForm({ ...form, longWeekends: !form.longWeekends })}
              >
                <Icon name="calendar" size={14} />
                Fines de semana largos
              </button>
            </div>
            {meta && <InterestPicker options={meta.interests} value={form.interests} onChange={(interests) => setForm({ ...form, interests })} />}
            </div>
            <button className="search-cta" disabled={loading}>
              <Icon name="search" size={18} />
              {loading ? "Buscando precios…" : "Ver a dónde me alcanza"}
            </button>
            {status && !loading && (
              <p className={status.startsWith("Listo") ? "search-status" : "form-error"} role="status">
                {status}
              </p>
            )}
          </form>
        ) : (
          <div className="stack-lg">
            <TripForm />
            <Link to="/rutas" className="routes-hint">
              <Icon name="compass" size={18} />
              ¿Sin ideas para combinar? Mirá rutas armadas
              <Icon name="chevronRight" size={16} />
            </Link>
            <div className="stack">
            <p className="catalog-title">O elegí un destino con ficha completa</p>
            <div className="dest-search">
              <Icon name="search" size={18} />
              <input
                aria-label="Buscar destino"
                placeholder="Destino, país o tipo de viaje"
                value={destQuery}
                onChange={(e) => setDestQuery(e.target.value)}
              />
            </div>
            <div className="dest-list">
              {filteredDest.map((d) => (
                <div key={d.id} className="dest-item-wrap">
                  <button className="dest-item" onClick={() => navigate(`/destino/${d.id}`)}>
                    {photos[d.id] && <img className="dest-thumb" src={photos[d.id]} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    <span className="stack-sm grow">
                      <span>{d.name}</span>
                      <span className="sub">
                        {d.country} · {d.tags.slice(0, 3).join(", ")}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={18} />
                  </button>
                  <CompareToggle id={d.id} name={d.name} iconOnly />
                </div>
              ))}
              {filteredDest.length === 0 && <p>No hay destinos del catálogo con ese nombre. Usá el buscador de arriba: encuentra cualquier lugar.</p>}
            </div>
            </div>
          </div>
        )}
      </section>

      {/* Con búsqueda propia, los resultados van primero; si son ideas por defecto, al final. */}
      {searched && resultsArea}

      <ContinueTrip />

      <RadarSection />

      <LongWeekends />

      <Inspire showMap={Boolean(meta?.liveFlights)} />

      {!searched && resultsArea}
    </div>
  );
}

function WatchRow({ w }: { w: WatchItem }) {
  const { profile, destinations, money, removeWatch } = useApp();
  const [current, setCurrent] = useState<{ total: number; month: number; year: number } | null>(null);
  const dest = destinations.find((d) => d.id === w.destinationId);

  useEffect(() => {
    api
      .destination(w.destinationId, { origin: profile.origin, nights: w.nights, travelers: profile.travelers, style: profile.style })
      .then(({ months }) => {
        const pool = w.month ? months.filter((m) => m.month === w.month) : months;
        const best = pool.reduce((a, b) => (b.totalPerPersonUSD < a.totalPerPersonUSD ? b : a));
        setCurrent({ total: best.totalPerPersonUSD * profile.travelers, month: best.month, year: best.year });
      })
      .catch(() => setCurrent(null));
  }, [w, profile.origin, profile.travelers, profile.style]);

  if (!dest) return null;
  const ok = current && current.total <= w.targetUSD;
  return (
    <div className="list-row">
      <Link to={`/destino/${dest.id}`} className="grow" style={{ color: "inherit" }}>
        <div className="headline">{dest.name}</div>
        <div className="small muted">
          Objetivo {money(w.targetUSD)} · {w.nights} noches · {w.month ? capitalize(monthName(w.month)) : "fechas flexibles"}
        </div>
      </Link>
      {current && (
        <div className={`watch-status ${ok ? "ok" : "over"}`}>
          <strong>
            {ok && <Icon name="check" size={14} />}
            {ok ? "Entra" : "Todavía no"}
          </strong>
          <div>
            {money(current.total)} en {monthName(current.month)}
          </div>
        </div>
      )}
      <button className="icon-btn" onClick={() => removeWatch(w.id)} aria-label={`Dejar de seguir ${dest.name}`}>
        <Icon name="trash" size={18} />
      </button>
    </div>
  );
}

/** Último viaje guardado que todavía no pasó (propio o compartido). */
function latestTrip(list: TripPackage[], today: string): TripPackage | null {
  const upcoming = list.filter((p) => {
    const end = p.returnDate || p.departDate;
    return !end || end >= today;
  });
  return upcoming.reduce<TripPackage | null>((a, b) => (!a || Date.parse(b.createdAt) > Date.parse(a.createdAt) ? b : a), null);
}

/** "Seguí con tu viaje": el último viaje guardado y los destinos que seguís. */
function ContinueTrip() {
  const { packages, sharedTrips, watchlist, photos, destinations, money } = useApp();
  const trip = useMemo(() => {
    const seen = new Set<string>();
    const all = [...sharedTrips.map((t) => t.pkg), ...packages].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    return latestTrip(all, new Date().toISOString().slice(0, 10));
  }, [packages, sharedTrips]);
  // Última revisión de precios guardada en este navegador (no consulta nada).
  const check = useMemo(() => (trip ? savedCheck(trip) : null), [trip]);
  if (!trip && watchlist.length === 0) return null;

  const domestic = trip ? isDomestic(destinations.find((d) => d.id === trip.destinationId)?.region) : false;
  const tripMoney = (usd: number) => money(usd, { domestic });
  return (
    <section className="stack" aria-labelledby="continue-title">
      <h2 id="continue-title">Seguí con tu viaje</h2>
      {trip && (
        <Link to={`/viajes#viaje-${trip.id}`} className="card continue-trip">
          {photos[trip.destinationId] ? (
            <img src={photos[trip.destinationId]} alt="" width={56} height={56} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          ) : (
            <span className="continue-thumb" aria-hidden="true">
              <Icon name="bookmark" size={22} />
            </span>
          )}
          <span className="continue-body">
            <strong>Viaje a {trip.destinationName}</strong>
            <span className="small muted">
              {trip.departDate && trip.returnDate ? formatRange(trip.departDate, trip.returnDate) : "Fechas a definir"} · {trip.travelers}{" "}
              {trip.travelers === 1 ? "viajero" : "viajeros"}
            </span>
            {check && (
              <span className={`small continue-check ${check.status === "subio" ? "warn-text" : check.status === "bajo" ? "success" : "muted"}`}>
                {check.status !== "igual" && <Icon name={check.status === "subio" ? "trendUp" : "trendDown"} size={14} />}
                {check.status === "subio"
                  ? `Subió ${tripMoney(check.deltaUSD)}`
                  : check.status === "bajo"
                    ? `Bajó ${tripMoney(-check.deltaUSD)}`
                    : "Sigue igual"}
                {` · revisado ${timeAgo(check.checkedAt)}`}
              </span>
            )}
          </span>
          <span className="continue-total">
            <strong>{tripMoney(trip.totalUSD)}</strong>
            <span className="small muted">total</span>
          </span>
          <Icon name="chevronRight" size={18} />
        </Link>
      )}
      {watchlist.length > 0 && (
        <div>
          <p className="grouped-title">Destinos que seguís</p>
          <div className="grouped">
            {watchlist.map((w) => (
              <WatchRow key={w.id} w={w} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Rutas armadas, cruceros y mapa: tres accesos chicos en una fila. */
function Inspire({ showMap }: { showMap: boolean }) {
  const tiles = [
    { to: "/rutas", icon: "compass" as const, title: "Rutas armadas", sub: "Viajes de varias paradas" },
    { to: "/cruceros", icon: "ship" as const, title: "Cruceros", sub: "Rutas y temporadas" },
    ...(showMap ? [{ to: "/mapa", icon: "globe" as const, title: "Mapa", sub: "Vuelos baratos" }] : []),
  ];
  return (
    <section className="stack" aria-labelledby="inspire-title">
      <h2 id="inspire-title">Para inspirarte</h2>
      <div className="inspire-row">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="card inspire-tile">
            <span className="inspire-art" aria-hidden="true">
              <Icon name={t.icon} size={22} />
            </span>
            <strong>{t.title}</strong>
            <span className="small muted">{t.sub}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * Banner: mosaico de tres fotos con precios del radar. La grande es la oferta del día.
 * Sin radar, fotos del catálogo sin precios (nunca montos inventados).
 */
function HeroMosaic({ originName }: { originName: string }) {
  const { profile, meta, photos, destinations, money } = useApp();
  const { snap, state } = useRadar(profile.origin, Boolean(meta?.liveFlights));
  const byId = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations]);
  const tiles = useMemo(
    () =>
      pickHeroTiles(snap?.items, {
        photos,
        regionOf: (id) => byId.get(id)?.region,
        nameOf: (id) => byId.get(id)?.name,
        fallbackIds: HERO_FALLBACK,
      }),
    [snap, photos, byId],
  );

  if (state === "loading") {
    return (
      <div className="hero-art" aria-hidden="true">
        <div className="hero-mosaic">
          {[0, 1, 2].map((k) => (
            <span key={k} className={`mosaic-tile mosaic-sk ${k === 0 ? "big" : ""}`} />
          ))}
        </div>
      </div>
    );
  }
  if (tiles.length < 3) return null;
  const priced = tiles.some((t) => t.priceUSD);
  return (
    <div className="hero-art">
      <div className="hero-mosaic">
        {tiles.map((t, k) => {
          const price = t.priceUSD ? money(t.priceUSD, { domestic: isDomestic(byId.get(t.destinationId)?.region) }) : null;
          const dates = k === 0 && t.depart && t.ret ? shortRange(t.depart, t.ret) : null;
          const label = [t.name, k === 0 && t.deal && "hoy conviene", price && `desde ${price} ida y vuelta por persona`, dates && `del ${dates}`]
            .filter(Boolean)
            .join(", ");
          return (
            <Link key={t.destinationId} to={tileHref(t)} className={`mosaic-tile ${k === 0 ? "big" : ""}`} aria-label={label}>
              <img
                src={photos[t.destinationId]}
                alt={t.name}
                width={k === 0 ? 220 : 160}
                height={k === 0 ? 240 : 116}
                decoding="async"
                referrerPolicy="no-referrer"
              />
              {k === 0 && t.deal && <span className="mosaic-pill">Hoy conviene</span>}
              <span className="mosaic-info">
                <strong>{t.name}</strong>
                {price && <span>desde {price}</span>}
                {dates && <span className="mosaic-dates">{dates}</span>}
              </span>
            </Link>
          );
        })}
      </div>
      {priced && <p className="mosaic-caption">Ida y vuelta por persona desde {originName}, visto en los últimos días.</p>}
    </div>
  );
}
