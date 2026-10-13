import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ExploreResponse, Interest, Region, Style, WatchItem } from "../../shared/types.ts";
import InterestPicker from "../components/InterestPicker.tsx";
import Segmented from "../components/Segmented.tsx";
import SuggestionCard from "../components/SuggestionCard.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatDate, monthName } from "../lib/format.ts";
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

  return (
    <div className="stack-lg">
      <section className="hero">
        <h1>{profile.name ? `Hola ${profile.name}, ¿a dónde vamos?` : "¿A dónde vamos?"}</h1>
        <p className="muted">
          Saliendo desde <strong>{originName}</strong>.{" "}
          {!app.profileSaved && (
            <>
              <Link to="/perfil">Completá tu perfil</Link> para recomendaciones más precisas.
            </>
          )}
        </p>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "budget"} className={tab === "budget" ? "on" : ""} onClick={() => setTab("budget")}>
            Presupuesto y fechas
          </button>
          <button
            role="tab"
            aria-selected={tab === "destination"}
            className={tab === "destination" ? "on" : ""}
            onClick={() => setTab("destination")}
          >
            Ya sé a dónde
          </button>
        </div>

        {tab === "budget" ? (
          <form className="card search" onSubmit={submit}>
            <div className="grid-4">
              <label>
                Presupuesto ({profile.currency})
                <input
                  inputMode="numeric"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d]/g, ""))}
                  required
                />
              </label>
              <label>
                Cuándo
                <select
                  value={form.month ?? 0}
                  onChange={(e) => setForm({ ...form, month: Number(e.target.value) || null })}
                >
                  <option value={0}>Flexible (el mejor mes)</option>
                  {upcoming.map((m) => (
                    <option key={m.month} value={m.month}>
                      {capitalize(monthName(m.month))} {m.year}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Noches
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={form.nights}
                  onChange={(e) => setForm({ ...form, nights: Number(e.target.value) })}
                />
              </label>
              <label>
                Viajeros
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={form.travelers}
                  onChange={(e) => setForm({ ...form, travelers: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="row wrap gap">
              <Segmented
                label="Estilo"
                value={form.style}
                onChange={(style) => setForm({ ...form, style })}
                options={[
                  { value: "low", label: "Económico" },
                  { value: "mid", label: "Confort" },
                  { value: "high", label: "Premium" },
                ]}
              />
              <select
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
            {meta && (
              <InterestPicker
                options={meta.interests}
                value={form.interests}
                onChange={(interests) => setForm({ ...form, interests })}
              />
            )}
            <button className="primary" disabled={loading}>
              {loading ? "Buscando…" : "¿A dónde me alcanza?"}
            </button>
          </form>
        ) : (
          <div className="card search">
            <input
              placeholder="Buscá un destino, país o tipo de viaje (ej. playa, nieve)…"
              value={destQuery}
              onChange={(e) => setDestQuery(e.target.value)}
              autoFocus
            />
            <div className="dest-list">
              {filteredDest.map((d) => (
                <button key={d.id} className="dest-item" onClick={() => navigate(`/destino/${d.id}`)}>
                  <strong>{d.name}</strong>
                  <span className="muted small">
                    {d.country} · {d.tags.slice(0, 3).join(", ")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {watchlist.length > 0 && (
        <section>
          <h2>Tus viajes en mente</h2>
          <div className="watch-list">
            {watchlist.map((w) => (
              <WatchRow key={w.id} w={w} />
            ))}
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      {result && (
        <>
          <section>
            <div className="section-head">
              <h2>{lastSearch ? "Mejores opciones para vos" : "Ideas para vos"}</h2>
              <span className="muted small">
                {result.suggestions.length} de {result.considered} destinos entran en{" "}
                {app.money((lastSearch ?? defaults).budgetUSD)}
              </span>
            </div>
            {result.suggestions.length === 0 ? (
              <div className="card empty">
                Con ese presupuesto no encontramos opciones. Probá con menos noches, estilo económico o fechas flexibles.
              </div>
            ) : (
              <div className="grid-cards">
                {result.suggestions.map((s) => (
                  <SuggestionCard key={s.destination.id} s={s} nights={(lastSearch ?? defaults).nights} />
                ))}
              </div>
            )}
          </section>

          {result.alternatives.length > 0 && (
            <section className="alt-section">
              <div className="section-head">
                <h2>💡 Lugares que quizás no estabas considerando</h2>
                <span className="muted small">También entran en tu presupuesto</span>
              </div>
              <div className="grid-cards">
                {result.alternatives.map((s) => (
                  <SuggestionCard key={s.destination.id} s={s} nights={(lastSearch ?? defaults).nights} />
                ))}
              </div>
            </section>
          )}

          {result.extra.length > 0 && (
            <section>
              <div className="section-head">
                <h2>🌎 Más destinos con precio real de Google</h2>
                <span className="muted small">Vuelo ida y vuelta por persona, fechas sugeridas por Google</span>
              </div>
              <div className="grid-cards">
                {result.extra.map((e) => (
                  <a key={`${e.name}-${e.airport}`} className="card suggestion" href={e.link ?? "#"} target="_blank" rel="noreferrer">
                    <div className="suggestion-head">
                      <div>
                        <h3>{e.name}</h3>
                        <p className="muted small">
                          {e.country} · {formatDate(e.depart)}
                          {e.ret ? ` → ${formatDate(e.ret)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="price-row">
                      <div>
                        <div className="price">{app.money(e.flightPP)}</div>
                        <div className="muted small">vuelo p/p{e.airline ? ` · ${e.airline}` : ""}</div>
                      </div>
                      {e.hotelNight && <div className="small muted">🛏 desde {app.money(e.hotelNight)}/noche</div>}
                    </div>
                    <div className="card-foot small muted">
                      <span>● precio real hoy (Google)</span>
                      <span>Ver en Google ↗</span>
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
    <div className="card watch">
      <Link to={`/destino/${dest.id}`} className="grow">
        <strong>{dest.name}</strong>
        <div className="muted small">
          Objetivo {money(w.targetUSD)} · {w.nights} noches {w.month ? `en ${monthName(w.month)}` : "· fechas flexibles"}
        </div>
      </Link>
      {current && (
        <div className={`watch-status ${ok ? "ok" : "over"}`}>
          {ok ? "✓ Entra" : "Todavía no"}
          <div className="small">
            {money(current.total)} en {monthName(current.month)}
          </div>
        </div>
      )}
      <button className="ghost small" onClick={() => removeWatch(w.id)} aria-label={`Dejar de seguir ${dest.name}`}>
        ✕
      </button>
    </div>
  );
}
