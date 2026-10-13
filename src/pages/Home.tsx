import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ExploreResponse, Interest, Region, Style, WatchItem } from "../../shared/types.ts";
import InterestPicker from "../components/InterestPicker.tsx";
import Segmented from "../components/Segmented.tsx";
import SuggestionCard, { SuggestionSkeleton } from "../components/SuggestionCard.tsx";
import Icon from "../components/Icon.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate, formatRange, monthName } from "../lib/format.ts";
import { useStored } from "../lib/storage.ts";

interface Search {
  budgetUSD: number;
  nights: number;
  travelers: number;
  month: number | null;
  style: Style;
  interests: Interest[];
  regions: Region[];
}

export default function Home() {
  const app = useApp();
  const { profile, meta, destinations, packages, watchlist } = app;
  const navigate = useNavigate();
  const [tab, setTab] = useState<"budget" | "destination">("budget");
  const [lastSearch, setLastSearch] = useStored<Search | null>("fmt.lastSearch", null);

  const defaults: Search = {
    budgetUSD: 1500 * profile.travelers,
    nights: 7,
    travelers: profile.travelers,
    month: null,
    style: profile.style,
    interests: profile.interests,
    regions: [],
  };
  const [form, setForm] = useState<Search>(lastSearch ?? defaults);
  const [budgetInput, setBudgetInput] = useState(String(app.fromUSD(form.budgetUSD)));
  const [result, setResult] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destQuery, setDestQuery] = useState("");

  // Destinos que el usuario ya tiene en mente: los usamos para sugerir alternativas.
  const known = useMemo(
    () => [...new Set([...packages.map((p) => p.destinationId), ...watchlist.map((w) => w.destinationId)])],
    [packages, watchlist],
  );

  async function run(s: Search) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.explore({
        origin: profile.origin,
        budgetUSD: s.budgetUSD,
        travelers: s.travelers,
        nights: s.nights,
        month: s.month,
        style: s.style,
        interests: s.interests,
        regions: s.regions.length ? s.regions : undefined,
        exclude: profile.visited,
        known,
        maxFlightHours: profile.maxFlightHours,
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Al entrar mostramos ideas con la última búsqueda (o el perfil).
  useEffect(() => {
    run(lastSearch ?? defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.origin]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const s = { ...form, budgetUSD: Math.round(app.toUSD(Number(budgetInput) || 0)) };
    setForm(s);
    setLastSearch(s);
    run(s);
  }

  const upcoming = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { month: d.getMonth() + 1, year: d.getFullYear() };
    });
  }, []);

  const filteredDest = destinations.filter((d) =>
    `${d.name} ${d.country} ${d.tags.join(" ")}`.toLowerCase().includes(destQuery.toLowerCase()),
  );
  const originName = meta?.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;

  const nightsShown = (lastSearch ?? defaults).nights;

  return (
    <div className="stack-lg">
      <section className="search-panel" aria-labelledby="search-title">
        <div>
          <h1 id="search-title">{profile.name ? `Hola ${profile.name}, ¿a dónde vamos?` : "¿A dónde vamos?"}</h1>
          <p className="lead">
            Saliendo desde {originName}.{" "}
            {!app.profileSaved && (
              <>
                <Link to="/perfil">Completá tu perfil</Link> para recomendaciones a tu medida.
              </>
            )}
          </p>
        </div>

        <div className="search-tabs" role="tablist" aria-label="Tipo de búsqueda">
          <button role="tab" aria-selected={tab === "budget"} className={tab === "budget" ? "on" : ""} onClick={() => setTab("budget")}>
            Presupuesto y fechas
          </button>
          <button role="tab" aria-selected={tab === "destination"} className={tab === "destination" ? "on" : ""} onClick={() => setTab("destination")}>
            Ya sé a dónde
          </button>
        </div>

        {tab === "budget" ? (
          <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
            <div className="search-grid">
              <label className="tile">
                <span>Presupuesto total ({profile.currency})</span>
                <input
                  inputMode="numeric"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d]/g, ""))}
                  required
                />
              </label>
              <label className="tile">
                <span>Cuándo</span>
                <select value={form.month ?? 0} onChange={(e) => setForm({ ...form, month: Number(e.target.value) || null })}>
                  <option value={0}>Flexible, el mejor mes</option>
                  {upcoming.map((m) => (
                    <option key={m.month} value={m.month}>
                      {capitalize(monthName(m.month))} {m.year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tile">
                <span>Noches</span>
                <input type="number" min={1} max={60} value={form.nights} onChange={(e) => setForm({ ...form, nights: Number(e.target.value) })} />
              </label>
              <label className="tile">
                <span>Viajeros</span>
                <input type="number" min={1} max={12} value={form.travelers} onChange={(e) => setForm({ ...form, travelers: Number(e.target.value) })} />
              </label>
            </div>
            <div className="search-row">
              <Segmented
                label="Estilo de viaje"
                value={form.style}
                onChange={(style) => setForm({ ...form, style })}
                options={[
                  { value: "low", label: "Económico" },
                  { value: "mid", label: "Confort" },
                  { value: "high", label: "Premium" },
                ]}
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
            </div>
            {meta && <InterestPicker options={meta.interests} value={form.interests} onChange={(interests) => setForm({ ...form, interests })} />}
            <button className="search-cta" disabled={loading}>
              <Icon name="search" size={18} />
              {loading ? "Buscando precios…" : "Ver a dónde me alcanza"}
            </button>
          </form>
        ) : (
          <div className="stack">
            <div className="dest-search">
              <Icon name="search" size={18} />
              <input
                aria-label="Buscar destino"
                placeholder="Destino, país o tipo de viaje"
                value={destQuery}
                onChange={(e) => setDestQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="dest-list">
              {filteredDest.map((d) => (
                <button key={d.id} className="dest-item" onClick={() => navigate(`/destino/${d.id}`)}>
                  <span className="stack-sm">
                    <span>{d.name}</span>
                    <span className="sub">
                      {d.country} · {d.tags.slice(0, 3).join(", ")}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </button>
              ))}
              {filteredDest.length === 0 && <p>No hay destinos que coincidan. Probá con otra palabra, por ejemplo "playa".</p>}
            </div>
          </div>
        )}
      </section>

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
              <span className="small muted">
                {result.suggestions.length} de {result.considered} destinos entran en {app.money((lastSearch ?? defaults).budgetUSD)}
              </span>
            </div>
            {result.suggestions.length === 0 ? (
              <div className="card empty">
                <Icon name="search" size={28} />
                <h3>Con ese presupuesto no hay opciones todavía</h3>
                <p className="muted">Probá con menos noches, estilo Económico o fechas flexibles: suelen abrir muchas opciones.</p>
              </div>
            ) : (
              <div className="grid-cards">
                {result.suggestions.map((s) => (
                  <SuggestionCard key={s.destination.id} s={s} nights={nightsShown} />
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
                  <SuggestionCard key={s.destination.id} s={s} nights={nightsShown} />
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
                      <span className="source live">Precio real de hoy</span>
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
