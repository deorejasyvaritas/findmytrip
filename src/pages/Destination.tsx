import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  Destination,
  FlightCalendar,
  FlightDay,
  FlightQuote,
  MonthPrice,
  RealHotel,
  StayOption,
  Style,
  TripPackage,
} from "../../shared/types.ts";
import { flightLinks } from "../../shared/links.ts";
import Segmented from "../components/Segmented.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { INTEREST_EMOJI, STYLE_LABEL, capitalize, formatDate, monthName, monthShort } from "../lib/format.ts";

const WEEKDAYS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];
const STYLES: Style[] = ["low", "mid", "high"];
const monthKey = (m: MonthPrice) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const LEVEL: Record<string, string> = {
  low: "más barato de lo habitual",
  typical: "precio habitual",
  high: "más caro de lo habitual",
};
const hours = (min: number | null) => (min ? `${Math.floor(min / 60)} h ${min % 60} min` : "");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Elige un hotel real representativo para cada estilo. */
function pickTiers(hotels: RealHotel[]): Record<Style, RealHotel | undefined> {
  const good = hotels.filter((h) => (h.rating ?? 0) >= 4);
  const pool = (good.length >= 3 ? good : hotels).slice().sort((a, b) => a.nightlyUSD - b.nightlyUSD);
  if (!pool.length) return { low: undefined, mid: undefined, high: undefined };
  const low = pool[0];
  const top = pool.slice(Math.floor(pool.length * 0.7));
  const high = top.reduce((a, b) => ((b.stars ?? 0) * 10 + (b.rating ?? 0) > (a.stars ?? 0) * 10 + (a.rating ?? 0) ? b : a));
  const median = pool[Math.floor(pool.length / 2)].nightlyUSD;
  const midPool = pool.filter((h) => h !== low && h !== high);
  const mid = midPool.length
    ? midPool.reduce((a, b) => (Math.abs(b.nightlyUSD - median) < Math.abs(a.nightlyUSD - median) ? b : a))
    : undefined;
  return { low, mid, high: high === low ? undefined : high };
}

export default function DestinationPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const { profile, money, meta } = app;
  const google = Boolean(meta?.googleQuotes);

  const [nights, setNights] = useState(Number(params.get("nights")) || 7);
  const [travelers, setTravelers] = useState(profile.travelers);
  const [style, setStyle] = useState<Style>(profile.style);
  const [dest, setDest] = useState<Destination | null>(null);
  const [months, setMonths] = useState<MonthPrice[]>([]);
  const [month, setMonth] = useState<string | null>(params.get("month"));
  const [calendar, setCalendar] = useState<FlightCalendar | null>(null);
  const [day, setDay] = useState<FlightDay | null>(null);
  const [stays, setStays] = useState<StayOption[]>([]);
  const [hotels, setHotels] = useState<RealHotel[]>([]);
  const [hotelsFor, setHotelsFor] = useState<string | null>(null);
  const [tier, setTier] = useState<Style>(profile.style);
  const [custom, setCustom] = useState<RealHotel | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [quote, setQuote] = useState<FlightQuote | null>(null);
  const [loading, setLoading] = useState({ quote: false, hotels: false });
  const [quota, setQuota] = useState<{ left: number | null; total: number | null } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .destination(id, { origin: profile.origin, nights, travelers, style })
      .then((r) => {
        setDest(r.destination);
        setMonths(r.months);
        setMonth((m) => m ?? monthKey(r.months.find((x) => x.best) ?? r.months[0]));
      })
      .catch((e) => setError(e.message));
  }, [id, profile.origin, nights, travelers, style]);

  useEffect(() => {
    if (!month) return;
    setCalendar(null);
    api
      .calendar({ origin: profile.origin, dest: id, month, nights })
      .then((c) => {
        setCalendar(c);
        // Si venimos de una sugerencia con fecha concreta, arrancamos en esa fecha.
        const depart = params.get("depart");
        const fromParam = depart?.startsWith(month) ? c.days.find((d) => d.date === depart) : undefined;
        setDay(fromParam ?? c.cheapest);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, month, nights, profile.origin]);

  const dayKey = day ? `${day.date}_${day.returnDate}` : null;

  // Precio exacto de Google Flights para el día elegido (automático).
  useEffect(() => {
    setQuote(null);
    if (!day || !google) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading((l) => ({ ...l, quote: true }));
      api
        .flightQuote({ origin: profile.origin, dest: id, depart: day.date, ret: day.returnDate })
        .then((q) => !cancelled && setQuote(q))
        .catch(() => !cancelled && setQuote(null))
        .finally(() => {
          if (!cancelled) setLoading((l) => ({ ...l, quote: false }));
          api.quota().then(setQuota).catch(() => {});
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, google, id, profile.origin]);

  // Alojamiento: estimado al instante y hoteles reales de Google (automático).
  useEffect(() => {
    setCustom(null);
    setShowAll(false);
    if (!day) return;
    api
      .stays({ dest: id, checkin: day.date, nights, travelers })
      .then((r) => setStays(r.options))
      .catch((e) => setError(e.message));
    if (!google) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading((l) => ({ ...l, hotels: true }));
      api
        .stays({ dest: id, checkin: day.date, nights, travelers, real: 1 })
        .then((r) => {
          if (cancelled) return;
          setHotels(r.hotels);
          setHotelsFor(`${day.date}_${nights}`);
        })
        .catch(() => !cancelled && setHotels([]))
        .finally(() => !cancelled && setLoading((l) => ({ ...l, hotels: false })));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day?.date, nights, travelers, google, id]);

  const priceBands = useMemo(() => {
    const prices = (calendar?.days ?? []).map((d) => d.priceUSD).sort((a, b) => a - b);
    return { low: prices[Math.floor(prices.length / 3)] ?? 0, high: prices[Math.floor((prices.length * 2) / 3)] ?? 0 };
  }, [calendar]);

  const realHotels = day && hotelsFor === `${day.date}_${nights}` ? hotels : [];
  const tiers = useMemo(() => pickTiers(realHotels), [realHotels]);

  if (error && !dest) return <p className="error">{error}</p>;
  if (!dest) return <p className="muted">Cargando…</p>;

  const rooms = Math.max(1, Math.ceil(travelers / 2));
  const quoteOk = quote && day && quote.depart === day.date && quote.returnDate === day.returnDate;
  const flightPP = quoteOk ? quote.lowestUSD : (day?.priceUSD ?? 0);
  const flightSource = quoteOk ? "Google Flights, hoy" : day?.source === "en vivo" ? "visto en los últimos días" : "estimado";
  const flights = flightPP * travelers;

  const realPick = custom ?? tiers[tier];
  const estStay = stays.find((s) => s.tier === tier);
  const lodging = realPick ? realPick.totalUSD * rooms : (estStay?.totalUSD ?? 0);
  const lodgingLabel = realPick ? realPick.name : estStay ? `${estStay.label} (estimado)` : "";
  const daily = dest.dailyUSD[style] * (nights + 1) * travelers;
  const total = flights + lodging + daily;
  const maxMonth = Math.max(...months.map((m) => m.totalPerPersonUSD), 1);

  function selectMonth(key: string) {
    setMonth(key);
    params.set("month", key);
    params.delete("depart");
    setParams(params, { replace: true });
  }

  function savePackage() {
    if (!dest || !day || (!realPick && !estStay)) return;
    const pkg: TripPackage = {
      id: `pkg_${Date.now().toString(36)}`,
      destinationId: dest.id,
      destinationName: dest.name,
      origin: profile.origin,
      departDate: day.date,
      returnDate: day.returnDate,
      travelers,
      style,
      items: [
        {
          kind: "vuelo",
          label: `Vuelo ${profile.origin} ⇄ ${dest.iata} (${travelers} × USD ${flightPP}, ${flightSource})`,
          amountUSD: flights,
          link: (quoteOk && quote.url) || flightLinks(profile.origin, dest.iata, day.date, day.returnDate, travelers)[0].url,
        },
        {
          kind: "alojamiento",
          label: `${lodgingLabel} · ${nights} noches${rooms > 1 ? ` · ${rooms} hab.` : ""}${realPick ? " (precio real)" : ""}`,
          amountUSD: lodging,
          link: realPick?.link ?? estStay?.links[0].url,
        },
        {
          kind: "gastos",
          label: `Comidas, traslados y actividades (${STYLE_LABEL[style].toLowerCase()}, estimado)`,
          amountUSD: daily,
        },
      ],
      totalUSD: total,
      createdAt: new Date().toISOString(),
      status: "armando",
    };
    app.savePackage(pkg);
    setSaved(pkg.id);
  }

  function follow() {
    if (!dest) return;
    const m = month ? Number(month.slice(5, 7)) : null;
    app.addWatch({ destinationId: dest.id, targetUSD: Math.round(total), month: m, nights });
    setSaved("watch");
  }

  // Grilla del calendario: arranca en lunes.
  const firstDay = month ? new Date(`${month}-01T12:00:00`) : null;
  const offset = firstDay ? (firstDay.getDay() + 6) % 7 : 0;
  const daysInMonth = firstDay ? new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate() : 0;
  const byDate = new Map((calendar?.days ?? []).map((d) => [d.date, d]));

  return (
    <div className="dest-layout">
      <div className="stack-lg">
        <section>
          <Link to="/" className="muted small">
            ← Volver a explorar
          </Link>
          <h1>{dest.name}</h1>
          <p className="muted">
            {dest.country} · {dest.flightHours} h de vuelo aprox. desde Buenos Aires · {dest.docs}
          </p>
          <p>{dest.blurb}</p>
          <div className="chips static">
            {dest.tags.map((t) => (
              <span key={t} className="chip">
                {INTEREST_EMOJI[t]} {t}
              </span>
            ))}
          </div>
          <p className="small">
            <strong>Imperdibles:</strong> {dest.highlights.join(" · ")}
          </p>
        </section>

        <section className="card">
          <div className="row wrap gap">
            <label className="inline">
              Noches
              <input type="number" min={1} max={60} value={nights} onChange={(e) => setNights(Number(e.target.value) || 1)} />
            </label>
            <label className="inline">
              Viajeros
              <input type="number" min={1} max={12} value={travelers} onChange={(e) => setTravelers(Number(e.target.value) || 1)} />
            </label>
            <Segmented
              label="Estilo"
              value={style}
              onChange={(s) => {
                setStyle(s);
                setTier(s);
                setCustom(null);
              }}
              options={[
                { value: "low", label: "Económico" },
                { value: "mid", label: "Confort" },
                { value: "high", label: "Premium" },
              ]}
            />
          </div>
        </section>

        <section>
          <h2>¿Cuándo conviene ir?</h2>
          <p className="muted small">Comparación aproximada entre meses. ★ = mejor combinación de precio y clima.</p>
          <div className="month-bars" role="list">
            {months.map((m) => (
              <button
                key={monthKey(m)}
                role="listitem"
                className={`month-bar ${month === monthKey(m) ? "on" : ""} ${m.best ? "best" : ""}`}
                onClick={() => selectMonth(monthKey(m))}
                title={`${capitalize(monthName(m.month))} ${m.year}: ${money(m.totalPerPersonUSD)} por persona`}
              >
                <span className="bar-value small">{money(m.totalPerPersonUSD)}</span>
                <span className="bar" style={{ height: `${Math.max(12, (m.totalPerPersonUSD / maxMonth) * 120)}px` }} />
                <span className="small">
                  {monthShort(m.month)}
                  {m.best && " ★"}
                </span>
              </button>
            ))}
          </div>
        </section>

        {month && (
          <section>
            <div className="section-head">
              <h2>Vuelos en {monthName(Number(month.slice(5, 7)))}</h2>
              <span className="muted small">
                Ida y vuelta por persona, {nights} noches ·{" "}
                {calendar?.live ? "precios vistos en los últimos días (~ = estimado)" : "estimados"}
              </span>
            </div>
            <div className="calendar">
              {WEEKDAYS.map((w) => (
                <div key={w} className="cal-head small muted">
                  {w}
                </div>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <div key={`e${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                const d = byDate.get(date);
                const selected = day?.date === date;
                const price = selected && quoteOk ? quote.lowestUSD : d?.priceUSD;
                const band = !d ? "" : d.priceUSD <= priceBands.low ? "cheap" : d.priceUSD >= priceBands.high ? "pricey" : "midp";
                const est = !(selected && quoteOk) && d?.source === "estimado";
                return (
                  <button
                    key={date}
                    className={`cal-day ${band} ${est ? "est" : ""} ${selected ? "on" : ""}`}
                    disabled={!d}
                    onClick={() => d && setDay(d)}
                    title={d?.airline ? `${d.airline} · ${d.stops ?? 0} escala(s)` : undefined}
                  >
                    <span className="small">{i + 1}</span>
                    {d && (
                      <span className="cal-price">
                        {est && "~"}
                        {price}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {day && (
              <div className="stack">
                <div className="row wrap gap small">
                  <span>
                    Salida <strong>{formatDate(day.date, { weekday: "short", day: "numeric", month: "short" })}</strong> · vuelta{" "}
                    <strong>{formatDate(day.returnDate, { weekday: "short", day: "numeric", month: "short" })}</strong>
                  </span>
                  {flightLinks(profile.origin, dest.iata, day.date, day.returnDate, travelers).map((l) => (
                    <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="pill-link">
                      {l.label} ↗
                    </a>
                  ))}
                </div>
                {loading.quote && <p className="muted small">Buscando el precio de hoy en Google Flights…</p>}
                {quoteOk && (
                  <div className="card quote">
                    <div className="section-head">
                      <strong>Precio real hoy · Google Flights (por persona)</strong>
                      {quote.typicalRangeUSD && (
                        <span className="muted small">
                          Habitual: USD {quote.typicalRangeUSD[0]}–{quote.typicalRangeUSD[1]}
                          {quote.priceLevel && ` · hoy está ${LEVEL[quote.priceLevel] ?? quote.priceLevel}`}
                        </span>
                      )}
                    </div>
                    <ul className="items">
                      {quote.offers.map((o, i) => (
                        <li key={i}>
                          <span className="grow">
                            {o.airlines.join(" + ") || "Aerolínea"} · {o.stops === 0 ? "directo" : `${o.stops} escala(s)`}
                            {o.durationMin ? ` · ${hours(o.durationMin)}` : ""}
                          </span>
                          <strong>{money(o.priceUSD)}</strong>
                        </li>
                      ))}
                    </ul>
                    {quote.url && (
                      <a href={quote.url} target="_blank" rel="noreferrer" className="small">
                        Abrir en Google Flights ↗
                      </a>
                    )}
                  </div>
                )}
                {google && !loading.quote && !quoteOk && (
                  <p className="muted small">Google Flights no devolvió vuelos para estas fechas; se muestra el precio del calendario.</p>
                )}
              </div>
            )}
          </section>
        )}

        {day && (
          <section>
            <div className="section-head">
              <h2>Alojamiento</h2>
              <span className="muted small">
                {formatDate(day.date)} → {formatDate(addDays(day.date, nights))} · {rooms} hab.
                {realHotels.length ? " · precios reales de Google Hotels" : google ? "" : " · estimado"}
              </span>
            </div>
            {loading.hotels && <p className="muted small">Buscando hoteles en Google Hotels…</p>}

            {realHotels.length > 0 ? (
              <>
                <div className="grid-3">
                  {STYLES.map((s) => {
                    const h = tiers[s];
                    if (!h) return null;
                    const on = !custom && tier === s;
                    return (
                      <button key={s} className={`card stay ${on ? "on" : ""}`} onClick={() => (setCustom(null), setTier(s))} aria-pressed={on}>
                        {h.thumbnail && <img className="stay-img" src={h.thumbnail} alt="" loading="lazy" />}
                        <span className="muted small">{STYLE_LABEL[s]}</span>
                        <strong>{h.name}</strong>
                        <span className="muted small">
                          {h.stars ? `${h.stars}★ · ` : ""}
                          {h.rating ? `${h.rating}/5` : ""}
                          {h.reviews ? ` (${h.reviews.toLocaleString("es-AR")})` : ""}
                        </span>
                        <span className="price">{money(h.totalUSD * rooms)}</span>
                        <span className="muted small">{money(h.nightlyUSD)}/noche</span>
                        {h.link && (
                          <a href={h.link} target="_blank" rel="noreferrer" className="small" onClick={(e) => e.stopPropagation()}>
                            Ver hotel ↗
                          </a>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button className="ghost small" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Ocultar" : `Ver los ${realHotels.length} hoteles`}
                </button>
                {showAll && (
                  <div className="hotel-list">
                    {realHotels.map((h) => (
                      <button
                        key={h.name}
                        className={`card hotel ${custom?.name === h.name ? "on" : ""}`}
                        onClick={() => setCustom(custom?.name === h.name ? null : h)}
                        aria-pressed={custom?.name === h.name}
                      >
                        {h.thumbnail && <img src={h.thumbnail} alt="" loading="lazy" />}
                        <span className="hotel-body">
                          <strong>{h.name}</strong>
                          <span className="muted small">
                            {h.stars ? `${h.stars}★ · ` : ""}
                            {h.rating ? `${h.rating}/5` : ""}
                          </span>
                          <span>
                            <strong>{money(h.nightlyUSD)}</strong>
                            <span className="muted small"> /noche · {money(h.totalUSD * rooms)} total</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              !loading.hotels && (
                <div className="grid-3">
                  {stays.map((s) => (
                    <button
                      key={s.tier}
                      className={`card stay ${tier === s.tier ? "on" : ""}`}
                      onClick={() => setTier(s.tier)}
                      aria-pressed={tier === s.tier}
                    >
                      <strong>{s.label}</strong>
                      <span className="muted small">{s.area} · estimado</span>
                      <span className="price">{money(s.totalUSD)}</span>
                      <span className="muted small">
                        {money(s.nightlyUSD)}/noche · {s.rooms} hab.
                      </span>
                      <span className="row gap small">
                        {s.links.map((l) => (
                          <a key={l.label} href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            {l.label} ↗
                          </a>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}
          </section>
        )}
        {error && <p className="error">{error}</p>}
        {quota?.left != null && (
          <p className="muted small">
            Búsquedas de Google disponibles este mes: {quota.left}
            {quota.total ? ` de ${quota.total}` : ""}. Las búsquedas repetidas no se descuentan (caché de 12-24 h).
          </p>
        )}
      </div>

      <aside className="card summary">
        <h2>Tu paquete</h2>
        {day && (realPick || estStay) ? (
          <>
            <p className="muted small">
              {formatDate(day.date)} → {formatDate(day.returnDate)} · {travelers} {travelers === 1 ? "viajero" : "viajeros"}
            </p>
            <ul className="items">
              <li>
                <span>
                  ✈ Vuelos <span className="muted small">({loading.quote ? "actualizando…" : flightSource})</span>
                </span>
                <span>{money(flights)}</span>
              </li>
              <li>
                <span>
                  🛏 {lodgingLabel}
                  {realPick && <span className="muted small"> (real)</span>}
                </span>
                <span>{money(lodging)}</span>
              </li>
              <li>
                <span>
                  🍽 Gastos diarios <span className="muted small">(estimado)</span>
                </span>
                <span>{money(daily)}</span>
              </li>
            </ul>
            <div className="total">
              <span>Total</span>
              <span className="price">{money(total)}</span>
            </div>
            <p className="muted small">{money(Math.round(total / travelers))} por persona</p>
            <button className="primary" onClick={savePackage}>
              Guardar en Mis viajes
            </button>
            <button className="secondary" onClick={follow}>
              Seguir este destino
            </button>
            {saved && (
              <p className="success small">
                {saved === "watch" ? "Lo vas a ver en Explorar con el precio actualizado." : "Guardado."}{" "}
                <Link to={saved === "watch" ? "/" : "/viajes"}>Ver</Link>
              </p>
            )}
          </>
        ) : (
          <p className="muted">Elegí un mes y un día para armar el paquete.</p>
        )}
      </aside>
    </div>
  );
}
