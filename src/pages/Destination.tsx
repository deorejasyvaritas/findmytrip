import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Destination, FlightCalendar, FlightDay, MonthPrice, StayOption, Style, TripPackage } from "../../shared/types.ts";
import { flightLinks } from "../../shared/links.ts";
import Segmented from "../components/Segmented.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { INTEREST_EMOJI, STYLE_LABEL, capitalize, formatDate, monthName, monthShort } from "../lib/format.ts";

const WEEKDAYS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];
const monthKey = (m: MonthPrice) => `${m.year}-${String(m.month).padStart(2, "0")}`;

export default function DestinationPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const { profile, money } = app;

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

  useEffect(() => {
    if (!day) return;
    api.stays({ dest: id, checkin: day.date, nights, travelers }).then(setStays).catch((e) => setError(e.message));
  }, [id, day, nights, travelers]);

  const priceBands = useMemo(() => {
    const prices = (calendar?.days ?? []).map((d) => d.priceUSD).sort((a, b) => a - b);
    return { low: prices[Math.floor(prices.length / 3)] ?? 0, high: prices[Math.floor((prices.length * 2) / 3)] ?? 0 };
  }, [calendar]);

  if (error) return <p className="error">{error}</p>;
  if (!dest) return <p className="muted">Cargando…</p>;

  const stay = stays.find((s) => s.tier === stayTier);
  const flights = (day?.priceUSD ?? 0) * travelers;
  const daily = dest.dailyUSD[style] * (nights + 1) * travelers;
  const total = flights + (stay?.totalUSD ?? 0) + daily;
  const maxMonth = Math.max(...months.map((m) => m.totalPerPersonUSD), 1);

  function selectMonth(key: string) {
    setMonth(key);
    params.set("month", key);
    setParams(params, { replace: true });
  }

  function savePackage() {
    if (!dest || !day || !stay) return;
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
          label: `Vuelo ${profile.origin} ⇄ ${dest.iata} (${travelers} × USD ${day.priceUSD})`,
          amountUSD: flights,
          link: flightLinks(profile.origin, dest.iata, day.date, day.returnDate, travelers)[0].url,
        },
        {
          kind: "alojamiento",
          label: `${stay.label} en ${stay.area} · ${nights} noches`,
          amountUSD: stay.totalUSD,
          link: stay.links[0].url,
        },
        {
          kind: "gastos",
          label: `Comidas, traslados y actividades (${STYLE_LABEL[style].toLowerCase()})`,
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
          <p className="muted small">Costo total por persona estimado. ★ = mejor combinación de precio y clima.</p>
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
                Ida y vuelta por persona, {nights} noches · {calendar?.live ? "● precios en vivo" : "estimados"}
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
                return (
                  <button
                    key={date}
                    className={`cal-day ${band} ${day?.date === date ? "on" : ""}`}
                    disabled={!d}
                    onClick={() => d && setDay(d)}
                  >
                    <span className="small">{i + 1}</span>
                    {d && <span className="cal-price">{d.priceUSD}</span>}
                  </button>
                );
              })}
            </div>
            {day && (
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
            )}
          </section>
        )}

        {stays.length > 0 && (
          <section>
            <h2>Alojamiento</h2>
            <div className="grid-3">
              {stays.map((s) => (
                <button
                  key={s.tier}
                  className={`card stay ${stayTier === s.tier ? "on" : ""}`}
                  onClick={() => setStayTier(s.tier)}
                  aria-pressed={stayTier === s.tier}
                >
                  <strong>{s.label}</strong>
                  <span className="muted small">{s.area}</span>
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
      </div>

      <aside className="card summary">
        <h2>Tu paquete</h2>
        {day && stay ? (
          <>
            <p className="muted small">
              {formatDate(day.date)} → {formatDate(day.returnDate)} · {travelers} {travelers === 1 ? "viajero" : "viajeros"}
            </p>
            <ul className="items">
              <li>
                <span>✈ Vuelos</span>
                <span>{money(flights)}</span>
              </li>
              <li>
                <span>🛏 {stay.label}</span>
                <span>{money(stay.totalUSD)}</span>
              </li>
              <li>
                <span>🍽 Gastos diarios</span>
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
