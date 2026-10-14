import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Bags, ExploreResponse, Interest, MealPlan, Party, Profile, Region, Style, WatchItem, When } from "../../shared/types.ts";
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
import { capitalize, formatDate, formatRange, monthName } from "../lib/format.ts";
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

  return (
    <div className="stack-lg">
      <section className="search-panel" aria-labelledby="search-title">
        <div className="hero">
          <div className="hero-copy">
            <p className="hero-eyebrow">{profile.name ? `Hola ${profile.name}` : "Tu agente de viajes"}</p>
            <h1 id="search-title">
              Viajá más lejos <span>con lo que tenés.</span>
            </h1>
            <p className="lead">
              Precios reales de vuelos y hoteles, saliendo desde {originName}.{" "}
              {!app.profileSaved && (
                <>
                  <Link to="/perfil">Completá tu perfil</Link> para recomendaciones a tu medida.
                </>
              )}
            </p>
          </div>
          <HeroPostcards />
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

      <RadarSection />

      <Link to="/rutas" className="card map-teaser">
        <span className="map-teaser-art" aria-hidden="true">
          <Icon name="compass" size={28} />
        </span>
        <span className="grow">
          <strong>Rutas armadas</strong>
          <span className="small muted">Nordeste de Brasil, Perú clásico, Europa y más: viajes de varias paradas listos para ajustar.</span>
        </span>
        <Icon name="chevronRight" size={18} />
      </Link>

      <Link to="/cruceros" className="card map-teaser">
        <span className="map-teaser-art" aria-hidden="true">
          <Icon name="ship" size={28} />
        </span>
        <span className="grow">
          <strong>Cruceros</strong>
          <span className="small muted">Brasil desde Buenos Aires, Caribe, Mediterráneo, fiordos y Cabo de Hornos: rutas, temporadas y dónde ver las salidas.</span>
        </span>
        <Icon name="chevronRight" size={18} />
      </Link>

      {meta?.liveFlights && (
        <Link to="/mapa" className="card map-teaser">
          <span className="map-teaser-art" aria-hidden="true">
            <Icon name="globe" size={28} />
          </span>
          <span className="grow">
            <strong>Mapa de vuelos baratos</strong>
            <span className="small muted">Mirá en el mapa cuánto sale volar a cada destino desde tu ciudad.</span>
          </span>
          <Icon name="chevronRight" size={18} />
        </Link>
      )}

      <LongWeekends />

      {watchlist.length > 0 && (
        <section>
          <p className="grouped-title">Destinos que seguís</p>
          <div className="grouped">
            {watchlist.map((w) => (
              <WatchRow key={w.id} w={w} />
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="card empty" role="alert">
          <Icon name="info" size={28} />
          <p>No pudimos cargar los precios: {error}</p>
          <button className="secondary" onClick={() => run(lastSearch ?? defaults)}>
            Reintentar
          </button>
        </div>
      )}

      <div ref={resultsRef} className="scroll-anchor" />
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
              <h2>{lastSearch ? "Mejores opciones para vos" : "Ideas para vos"}</h2>
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

// Postales del banner: tres destinos con foto, inclinadas como en una cartelera de viaje.
const HERO_PICKS = ["florianopolis", "bariloche", "cusco", "madrid", "cartagena", "rio"];

function HeroPostcards() {
  const { photos, destinations } = useApp();
  const picks = HERO_PICKS.map((id) => destinations.find((d) => d.id === id)).filter((d) => d && photos[d.id]).slice(0, 3);
  if (picks.length < 3) return null;
  return (
    <div className="hero-cards" aria-hidden="true">
      {picks.map((d) => (
        <figure key={d!.id} className="postcard">
          {/* lazy: en el celular las postales están ocultas y así no se bajan. */}
          <img src={photos[d!.id]} alt="" width={128} height={110} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          <figcaption>{d!.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}
