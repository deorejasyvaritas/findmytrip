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
const monthKey = (m: MonthPrice) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const LEVEL = { low: "más barato de lo habitual", typical: "precio habitual", high: "más caro de lo habitual" } as Record<string, string>;
const hours = (min: number | null) => (min ? `${Math.floor(min / 60)} h ${min % 60} min` : "");

export default function DestinationPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const { profile, money, meta } = app;

  const [nights, setNights] = useState(Number(params.get("nights")) || 7);
  const [travelers, setTravelers] = useState(profile.travelers);
  const [style, setStyle] = useState<Style>(profile.style);
  const [dest, setDest] = useState<Destination | null>(null);
  const [months, setMonths] = useState<MonthPrice[]>([]);
  const [month, setMonth] = useState<string | null>(params.get("month"));
  const [calendar, setCalendar] = useState<FlightCalendar | null>(null);
  const [day, setDay] = useState<FlightDay | null>(null);
  const [stays, setStays] = useState<StayOption[]>([]);
  const [stayTier, setStayTier] = useState<Style>(profile.style);
  const [hotels, setHotels] = useState<RealHotel[]>([]);
  const [hotel, setHotel] = useState<RealHotel | null>(null);
  const [quote, setQuote] = useState<FlightQuote | null>(null);
  const [busy, setBusy] = useState<"quote" | "hotels" | null>(null);
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
        setDay(c.cheapest);
      })
      .catch((e) => setError(e.message));
  }, [id, month, nights, profile.origin]);

  // Al cambiar de día se descartan las cotizaciones exactas anteriores.
  useEffect(() => {
    setQuote(null);
    setHotels([]);
    setHotel(null);
    if (!day) return;
    api
      .stays({ dest: id, checkin: day.date, nights, travelers })
      .then((r) => setStays(r.options))
      .catch((e) => setError(e.message));
  }, [id, day, nights, travelers]);

  const priceBands = useMemo(() => {
    const prices = (calendar?.days ?? []).map((d) => d.priceUSD).sort((a, b) => a - b);
    return { low: prices[Math.floor(prices.length / 3)] ?? 0, high: prices[Math.floor((prices.length * 2) / 3)] ?? 0 };
  }, [calendar]);

  if (error && !dest) return <p className="error">{error}</p>;
  if (!dest) return <p className="muted">Cargando…</p>;

  const rooms = Math.max(1, Math.ceil(travelers / 2));
  const stay = stays.find((s) => s.tier === stayTier);
  const flightPP = quote?.lowestUSD ?? day?.priceUSD ?? 0;
  const flightSource = quote ? "Google Flights" : day?.source === "en vivo" ? "precio real" : "estimado";
  const flights = flightPP * travelers;
  const lodging = hotel ? hotel.totalUSD * rooms : (stay?.totalUSD ?? 0);
  const lodgingLabel = hotel ? hotel.name : stay ? `${stay.label} (${stay.source === "en vivo" ? "precio real" : "estimado"})` : "";
  const daily = dest.dailyUSD[style] * (nights + 1) * travelers;
  const total = flights + lodging + daily;
  const maxMonth = Math.max(...months.map((m) => m.totalPerPersonUSD), 1);

  function selectMonth(key: string) {
    setMonth(key);
    params.set("month", key);
    setParams(params, { replace: true });
  }

  async function confirmFlight() {
    if (!day) return;
    setBusy("quote");
    setError(null);
    try {
      setQuote(await api.flightQuote({ origin: profile.origin, dest: id, depart: day.date, nights }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadHotels() {
    if (!day) return;
    setBusy("hotels");
    setError(null);
    try {
      const r = await api.stays({ dest: id, checkin: day.date, nights, travelers, real: 1 });
      setStays(r.options);
      setHotels(r.hotels);
      if (!r.live) setError("Google Hotels no devolvió resultados para esas fechas.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function savePackage() {
    if (!dest || !day || (!stay && !hotel)) return;
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
          link: quote?.url ?? flightLinks(profile.origin, dest.iata, day.date, day.returnDate, travelers)[0].url,
        },
        {
          kind: "alojamiento",
          label: `${lodgingLabel} · ${nights} noches${rooms > 1 ? ` · ${rooms} hab.` : ""}`,
          amountUSD: lodging,
          link: hotel?.link ?? stay?.links[0].url,
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
              label="Estilo de gastos"
              value={style}
              onChange={setStyle}
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
          <p className="muted small">
            Costo total por persona (estimación para comparar meses). ★ = mejor combinación de precio y clima.
          </p>
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
                {calendar?.live ? "● precios reales (los días con ~ son estimados)" : "estimados"}
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
                const band = !d ? "" : d.priceUSD <= priceBands.low ? "cheap" : d.priceUSD >= priceBands.high ? "pricey" : "midp";
                const est = calendar?.live && d?.source === "estimado";
                return (
                  <button
                    key={date}
                    className={`cal-day ${band} ${est ? "est" : ""} ${day?.date === date ? "on" : ""}`}
                    disabled={!d}
                    onClick={() => d && setDay(d)}
                    title={d?.airline ? `${d.airline} · ${d.stops ?? 0} escala(s)` : undefined}
                  >
                    <span className="small">{i + 1}</span>
                    {d && (
                      <span className="cal-price">
                        {est && "~"}
                        {d.priceUSD}
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
                {meta?.googleQuotes && !quote && (
                  <button className="secondary" onClick={confirmFlight} disabled={busy !== null}>
                    {busy === "quote" ? "Consultando Google Flights…" : "Ver precio exacto en Google Flights"}
                  </button>
                )}
                {quote && (
                  <div className="card quote">
                    <div className="section-head">
                      <strong>Google Flights · precio real por persona</strong>
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
              </div>
            )}
          </section>
        )}

        {stays.length > 0 && (
          <section>
            <div className="section-head">
              <h2>Alojamiento</h2>
              {meta?.googleQuotes && hotels.length === 0 && (
                <button className="secondary small" onClick={loadHotels} disabled={busy !== null}>
                  {busy === "hotels" ? "Buscando hoteles…" : "Ver hoteles reales (Google Hotels)"}
                </button>
              )}
            </div>
            {hotels.length > 0 && (
              <div className="hotel-list">
                {hotels.slice(0, 12).map((h) => (
                  <button
                    key={h.name}
                    className={`card hotel ${hotel?.name === h.name ? "on" : ""}`}
                    onClick={() => setHotel(hotel?.name === h.name ? null : h)}
                    aria-pressed={hotel?.name === h.name}
                  >
                    {h.thumbnail && <img src={h.thumbnail} alt="" loading="lazy" />}
                    <span className="hotel-body">
                      <strong>{h.name}</strong>
                      <span className="muted small">
                        {h.stars ? `${h.stars}★ · ` : ""}
                        {h.rating ? `${h.rating}/5` : ""}
                        {h.reviews ? ` (${h.reviews.toLocaleString("es-AR")} reseñas)` : ""}
                      </span>
                      <span>
                        <strong>{money(h.nightlyUSD)}</strong>
                        <span className="muted small"> /noche · {money(h.totalUSD * rooms)} total</span>
                      </span>
                      {h.link && (
                        <a href={h.link} target="_blank" rel="noreferrer" className="small" onClick={(e) => e.stopPropagation()}>
                          Ver hotel ↗
                        </a>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="grid-3">
              {stays.map((s) => (
                <button
                  key={s.tier}
                  className={`card stay ${!hotel && stayTier === s.tier ? "on" : ""}`}
                  onClick={() => {
                    setHotel(null);
                    setStayTier(s.tier);
                  }}
                  aria-pressed={!hotel && stayTier === s.tier}
                >
                  <strong>{s.label}</strong>
                  <span className="muted small">
                    {s.area} · {s.source === "en vivo" ? "precio real (Google Hotels)" : "estimado"}
                  </span>
                  <span className="price">{money(s.totalUSD)}</span>
                  <span className="muted small">
                    {money(s.nightlyUSD)}/noche · {s.rooms} hab.
                  </span>
                  <span className="small">{s.description}</span>
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
          </section>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <aside className="card summary">
        <h2>Tu paquete</h2>
        {day && (stay || hotel) ? (
          <>
            <p className="muted small">
              {formatDate(day.date)} → {formatDate(day.returnDate)} · {travelers} {travelers === 1 ? "viajero" : "viajeros"}
            </p>
            <ul className="items">
              <li>
                <span>
                  ✈ Vuelos <span className="muted small">({flightSource})</span>
                </span>
                <span>{money(flights)}</span>
              </li>
              <li>
                <span>🛏 {hotel ? hotel.name : stay?.label}</span>
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
