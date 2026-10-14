import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  DURATION_BANDS,
  ROUTES,
  ROUTE_STYLES,
  bestMonthsLabel,
  inBand,
  routeCountries,
  routeDays,
  routePrice,
  routeSearchParams,
  type CuratedRoute,
  type DurationBand,
  type RoutePrice,
  type RouteStyle,
  type RoutesResponse,
} from "../../shared/routes.ts";
import { TripForm } from "../components/FullSearch.tsx";
import Icon from "../components/Icon.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, monthName, monthShort } from "../lib/format.ts";

/** Topes de precio por persona (USD). */
const PRICE_CAPS = [1000, 1500, 2500];
/** Países que se ven sin tocar "Ver todos". */
const COUNTRIES_SHOWN = 8;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Este mes y los cinco siguientes, como YYYY-MM. */
function nextMonths(n = 6): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Salida sugerida: el 1 del mes elegido, o dentro de dos semanas si ya pasó. */
function suggestedDepart(month: string): string {
  const soon = new Date(Date.now() + 14 * 86400000);
  const first = `${month}-01`;
  return first > ymd(soon) ? first : ymd(soon);
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export default function RoutesPage() {
  const { profile, meta, money, photos } = useApp();
  const months = useMemo(() => nextMonths(), []);
  const [month, setMonth] = useState(months[1]);
  const [band, setBand] = useState<DurationBand | null>(null);
  const [styles, setStyles] = useState<RouteStyle[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [cap, setCap] = useState<number | null>(null);
  const [allCountries, setAllCountries] = useState(false);
  const [more, setMore] = useState(false);
  const [data, setData] = useState<RoutesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<CuratedRoute | null>(null);
  const [params, setParams] = useSearchParams();

  const originName = meta?.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;
  const monthNum = Number(month.slice(5, 7));
  const monthLabel = monthName(monthNum);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    api
      .routes(profile.origin, month)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [profile.origin, month]);

  const prices = useMemo(() => {
    const out: Record<string, RoutePrice> = {};
    for (const r of ROUTES) out[r.id] = routePrice(data?.quotes[r.id], monthLabel);
    return out;
  }, [data, monthLabel]);

  const countryList = useMemo(() => routeCountries(), []);
  const shownCountries = allCountries ? countryList : countryList.slice(0, COUNTRIES_SHOWN);

  const base = ROUTES.filter(
    (r) =>
      (!band || inBand(r, band)) &&
      styles.every((s) => r.styles.includes(s)) &&
      (countries.length === 0 || countries.some((c) => r.countries.includes(c))),
  );
  const withCap = cap == null ? base : base.filter((r) => prices[r.id].kind === "estimate" && (prices[r.id] as { perPersonUSD: number }).perPersonUSD <= cap);
  const hiddenByCap = cap == null ? 0 : base.filter((r) => prices[r.id].kind === "live").length;
  const goodSeason = (r: CuratedRoute) => r.bestMonths.includes(monthNum);
  const list = [...withCap].sort((a, b) => {
    const s = Number(goodSeason(b)) - Number(goodSeason(a));
    if (s) return s;
    const pa = prices[a.id];
    const pb = prices[b.id];
    const va = pa.kind === "estimate" ? pa.perPersonUSD : Infinity;
    const vb = pb.kind === "estimate" ? pb.perPersonUSD : Infinity;
    return va - vb || a.name.localeCompare(b.name, "es");
  });

  const extraActive = styles.length + countries.length + (cap != null ? 1 : 0);
  const anyFilter = extraActive > 0 || band != null;
  const clear = () => {
    setBand(null);
    setStyles([]);
    setCountries([]);
    setCap(null);
  };

  function start(r: CuratedRoute) {
    // TripForm toma las paradas de la URL ("Ya sé a dónde" precargado); fecha y grupo los elige la persona.
    setParams(routeSearchParams(r, { depart: suggestedDepart(month) }), { replace: true });
    setOpen(r);
  }
  function close() {
    setOpen(null);
    setParams({}, { replace: true });
  }

  return (
    <div className="stack-lg routes-page">
      <section className="stack">
        <Link to="/" className="back">
          <Icon name="chevronLeft" size={22} />
          Explorar
        </Link>
        <h1>Rutas armadas</h1>
        <p className="muted subhead">
          Viajes de varias paradas para salir desde {originName}. Elegí uno y lo ajustás a tu fecha y a quiénes viajan.
        </p>
      </section>

      <section className="card routes-filters" aria-label="Filtros">
        <div className="routes-group">
          <h2 className="eyebrow" id="rf-month">
            Cuándo viajás
          </h2>
          <div className="chips" role="group" aria-labelledby="rf-month">
            {months.map((m) => (
              <button key={m} type="button" className={`chip${m === month ? " on" : ""}`} aria-pressed={m === month} onClick={() => setMonth(m)}>
                {capitalize(monthShort(Number(m.slice(5, 7))))}
                {m.slice(0, 4) !== months[0].slice(0, 4) ? ` ${m.slice(2, 4)}` : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="routes-group">
          <h2 className="eyebrow" id="rf-days">
            Duración
          </h2>
          <div className="chips" role="group" aria-labelledby="rf-days">
            {DURATION_BANDS.map((b) => (
              <button key={b.id} type="button" className={`chip${band === b.id ? " on" : ""}`} aria-pressed={band === b.id} onClick={() => setBand(band === b.id ? null : b.id)}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="ghost routes-more" aria-expanded={more} aria-controls="rf-more" onClick={() => setMore((m) => !m)}>
          <Icon name="sliders" size={18} />
          {more ? "Menos filtros" : "Estilo, países y precio"}
          {extraActive > 0 && <span className="badge-count">{extraActive}</span>}
        </button>

        {more && (
          <div id="rf-more" className="stack routes-more-panel">
            <div className="routes-group">
              <h2 className="eyebrow" id="rf-style">
                Estilo
              </h2>
              <div className="chips" role="group" aria-labelledby="rf-style">
                {ROUTE_STYLES.map((s) => (
                  <button key={s} type="button" className={`chip${styles.includes(s) ? " on" : ""}`} aria-pressed={styles.includes(s)} onClick={() => setStyles((l) => toggle(l, s))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="routes-group">
              <h2 className="eyebrow" id="rf-country">
                Países
              </h2>
              <div className="chips" role="group" aria-labelledby="rf-country">
                {shownCountries.map((c) => (
                  <button key={c} type="button" className={`chip${countries.includes(c) ? " on" : ""}`} aria-pressed={countries.includes(c)} onClick={() => setCountries((l) => toggle(l, c))}>
                    {c}
                  </button>
                ))}
                {countryList.length > COUNTRIES_SHOWN && (
                  <button type="button" className="chip routes-chip-more" onClick={() => setAllCountries((a) => !a)}>
                    {allCountries ? "Ver menos" : `Ver todos (${countryList.length})`}
                  </button>
                )}
              </div>
            </div>
            <div className="routes-group">
              <h2 className="eyebrow" id="rf-price">
                Precio por persona
              </h2>
              <div className="chips" role="group" aria-labelledby="rf-price">
                <button type="button" className={`chip${cap == null ? " on" : ""}`} aria-pressed={cap == null} onClick={() => setCap(null)}>
                  Sin tope
                </button>
                {PRICE_CAPS.map((c) => (
                  <button key={c} type="button" className={`chip${cap === c ? " on" : ""}`} aria-pressed={cap === c} onClick={() => setCap(c)}>
                    Hasta {money(c)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="routes-count">
          <span className="small muted" role="status">
            {list.length === 1 ? "1 ruta" : `${list.length} rutas`}
            {hiddenByCap > 0 && ` · ${hiddenByCap} sin precio estimado quedan afuera del tope`}
          </span>
          {anyFilter && (
            <button type="button" className="plain" onClick={clear}>
              Limpiar filtros
            </button>
          )}
        </div>
      </section>

      {failed && <p className="small muted">No pudimos traer los precios de {monthLabel}. Las rutas se pueden armar igual con el precio de hoy.</p>}

      {list.length === 0 ? (
        <section className="card empty">
          <Icon name="compass" size={32} />
          <h3>Ninguna ruta coincide con esos filtros</h3>
          <p className="muted">Probá con menos países o sin tope de precio. También podés armar tu propio recorrido.</p>
          <div className="row wrap gap-sm" style={{ justifyContent: "center" }}>
            <button type="button" className="primary" onClick={clear}>
              Limpiar filtros
            </button>
            <Link to="/?tab=destination" className="button secondary">
              Armar el mío
            </Link>
          </div>
        </section>
      ) : (
        <section className="routes-grid" aria-label="Rutas" aria-busy={!data && !failed}>
          {list.map((r) => (
            <RouteCard
              key={r.id}
              route={r}
              price={prices[r.id]}
              loading={!data && !failed}
              photo={r.stops.map((s) => s.destinationId && photos[s.destinationId]).find(Boolean) || null}
              goodSeason={goodSeason(r)}
              monthLabel={monthLabel}
              money={(usd) => money(usd, { domestic: r.countries.every((c) => c === "Argentina") })}
              onStart={() => start(r)}
            />
          ))}
        </section>
      )}

      {/* Se abre cuando la URL ya tiene las paradas: TripForm las lee al montarse. */}
      {open && params.get("tipo") === "viaje" && params.getAll("stop").length > 0 && <StartSheet route={open} onClose={close} />}
    </div>
  );
}

function RouteCard({
  route: r,
  price,
  loading,
  photo,
  goodSeason,
  monthLabel,
  money,
  onStart,
}: {
  route: CuratedRoute;
  price: RoutePrice;
  loading: boolean;
  photo: string | null;
  goodSeason: boolean;
  monthLabel: string;
  money: (usd: number) => string;
  onStart: () => void;
}) {
  const titleId = `route-${r.id}`;
  return (
    <article className="card route-card" aria-labelledby={titleId}>
      <div className="photo">
        {photo ? (
          <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <Icon name="compass" size={36} />
        )}
      </div>
      <div className="route-body">
        <div className="stack-sm">
          <p className="small muted">{r.countries.join(" · ")}</p>
          <h3 id={titleId}>{r.name}</h3>
          <p className="small muted route-meta">
            {routeDays(r)} días · {r.stops.length} paradas
            {goodSeason && <span className="badge badge-ok">Buena época en {monthLabel}</span>}
          </p>
        </div>
        <ol className="route-line" aria-label="Recorrido">
          {r.stops.map((s, i) => (
            <li key={s.name}>
              {i > 0 && <Icon name="chevronRight" size={14} />}
              <span>{s.name}</span>
            </li>
          ))}
        </ol>
        <p className="small">{r.summary}</p>
        <div className="route-price">
          {loading ? (
            <div className="sk" style={{ width: "55%", height: 22 }} aria-hidden="true" />
          ) : price.kind === "estimate" ? (
            <>
              <p>
                <span className="small muted">Desde </span>
                <span className="price">{money(price.perPersonUSD)}</span>
                <span className="small muted"> por persona</span>
              </p>
              <p className="small muted">{price.basis}</p>
            </>
          ) : (
            <>
              <button type="button" className="link" onClick={onStart}>
                {price.label}
              </button>
              <p className="small muted">{price.reason}</p>
            </>
          )}
        </div>
        <p className="small muted route-season">
          <Icon name="sun" size={14} />
          Mejor época: {bestMonthsLabel(r.bestMonths)}
        </p>
        <button type="button" className="primary route-cta" onClick={onStart}>
          Armar este viaje
        </button>
      </div>
    </article>
  );
}

/** Hoja con "Ya sé a dónde" precargado: la persona revisa paradas, fecha y grupo. */
function StartSheet({ route, onClose }: { route: CuratedRoute; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal route-sheet" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()} aria-labelledby="route-sheet-title">
      <div className="search-panel compact">
        <div className="route-sheet-head">
          <div>
            <p className="catalog-title">Ya sé a dónde</p>
            <h2 id="route-sheet-title">{route.name}</h2>
            <p className="small">Elegí la fecha y quiénes viajan. Podés cambiar las paradas o las noches.</p>
          </div>
          <button type="button" className="icon-btn route-sheet-close" aria-label="Cerrar" onClick={() => ref.current?.close()}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <TripForm key={route.id} />
      </div>
    </dialog>
  );
}
