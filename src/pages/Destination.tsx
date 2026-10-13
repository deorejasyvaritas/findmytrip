import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type {
  Bags,
  Destination,
  Party,
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
import { PartyPicker } from "../components/TripPickers.tsx";
import {
  BAGS_LABEL,
  bagsCost,
  dailyUnits,
  describeParty,
  fareUnits,
  headcount,
  partyFromParams,
  roomsForParty,
} from "../../shared/pricing.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { STYLE_LABEL, capitalize, formatDate, formatRange, monthName, monthShort } from "../lib/format.ts";
import { INTEREST_ICON } from "../lib/icons.ts";
import Icon from "../components/Icon.tsx";
import CrossAndFly from "../components/CrossAndFly.tsx";
import TripExtras from "../components/TripExtras.tsx";

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

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default function DestinationPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const { profile, money, meta, photos } = app;
  const google = Boolean(meta?.googleQuotes);

  const [nights, setNights] = useState(Number(params.get("nights")) || 7);
  const [party, setParty] = useState<Party>(() =>
    partyFromParams(params, { adults: profile.travelers, childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" }),
  );
  const [editParty, setEditParty] = useState(false);
  // Para las APIs alcanza con la cantidad de personas; el detalle (edades, equipaje) se calcula acá.
  const travelers = headcount(party);
  const [style, setStyle] = useState<Style>(profile.style);
  const [dest, setDest] = useState<Destination | null>(null);
  const [months, setMonths] = useState<MonthPrice[]>([]);
  const [month, setMonth] = useState<string | null>(params.get("month"));
  const [calendar, setCalendar] = useState<FlightCalendar | null>(null);
  const [day, setDay] = useState<FlightDay | null>(null);
  const [stays, setStays] = useState<StayOption[]>([]);
  const [hotels, setHotels] = useState<RealHotel[]>([]);
  const [hotelsFor, setHotelsFor] = useState<string | null>(null);
  const [hotelsSource, setHotelsSource] = useState<"xotelo" | "google" | null>(null);
  const [tier, setTier] = useState<Style>(profile.style);
  const [custom, setCustom] = useState<RealHotel | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [quote, setQuote] = useState<FlightQuote | null>(null);
  // Día que se cotiza solo (el primero de cada mes); el resto, a pedido o desde la caché.
  const [autoKey, setAutoKey] = useState<string | null>(null);
  const [hotelsCheckin, setHotelsCheckin] = useState<string | null>(null);
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
        // Si la búsqueda tenía una ventana de fechas, arrancamos en el día más barato dentro de ella.
        const from = params.get("from");
        const to = params.get("to");
        const inRange = from && to ? c.days.filter((d) => d.date >= from && d.date <= to) : [];
        const bestInRange = inRange.reduce<FlightDay | undefined>((acc, d) => {
          if (!acc) return d;
          if (d.source !== acc.source) return d.source === "en vivo" ? d : acc;
          return d.priceUSD < acc.priceUSD ? d : acc;
        }, undefined);
        const first = fromParam ?? bestInRange ?? c.cheapest;
        setDay(first);
        setAutoKey(first ? `${first.date}_${first.returnDate}` : null);
        setHotelsCheckin(first?.date ?? null);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, month, nights, profile.origin]);

  const dayKey = day ? `${day.date}_${day.returnDate}` : null;

  // Precio de hoy en Google Flights: automático para el primer día del mes;
  // para los demás días, solo si ya está en caché (no gasta cuota).
  async function fetchQuote(cacheOnly: boolean, target: FlightDay) {
    setLoading((l) => ({ ...l, quote: true }));
    try {
      const q = await api.flightQuote({
        origin: profile.origin,
        dest: id,
        depart: target.date,
        ret: target.returnDate,
        ...(cacheOnly ? { cacheOnly: 1 as const } : {}),
      });
      setQuote(q);
    } catch {
      setQuote(null);
    } finally {
      setLoading((l) => ({ ...l, quote: false }));
      if (!cacheOnly) api.quota().then(setQuota).catch(() => {});
    }
  }

  useEffect(() => {
    setQuote(null);
    if (!day || !google) return;
    const t = setTimeout(() => fetchQuote(dayKey !== autoKey, day), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, autoKey, google, id, profile.origin]);

  // Los hoteles siguen al día elegido en el calendario.
  useEffect(() => {
    if (day) setHotelsCheckin(day.date);
  }, [day?.date]);

  // Alojamiento: estimado al instante y hoteles reales (automático).
  // Xotelo no tiene cuota; Google Hotels (con cuota) solo de respaldo y solo para la fecha inicial del mes.
  useEffect(() => {
    setCustom(null);
    setShowAll(false);
    if (!hotelsCheckin) return;
    const checkin = hotelsCheckin;
    api
      .stays({ dest: id, checkin, nights, travelers })
      .then((r) => setStays(r.options))
      .catch((e) => setError(e.message));
    let cancelled = false;
    const allowGoogle = google && Boolean(autoKey?.startsWith(checkin));
    const t = setTimeout(() => {
      setLoading((l) => ({ ...l, hotels: true }));
      api
        .stays({ dest: id, checkin, nights, travelers, real: 1, ...(allowGoogle ? { google: 1 as const } : {}) })
        .then((r) => {
          if (cancelled) return;
          setHotels(r.hotels);
          setHotelsSource(r.source);
          setHotelsFor(`${checkin}_${nights}`);
          if (r.source === "google") api.quota().then(setQuota).catch(() => {});
        })
        .catch(() => !cancelled && setHotels([]))
        .finally(() => !cancelled && setLoading((l) => ({ ...l, hotels: false })));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelsCheckin, nights, travelers, google, id]);

  const priceBands = useMemo(() => {
    const prices = (calendar?.days ?? []).map((d) => d.priceUSD).sort((a, b) => a - b);
    return { low: prices[Math.floor(prices.length / 3)] ?? 0, high: prices[Math.floor((prices.length * 2) / 3)] ?? 0 };
  }, [calendar]);

  const realHotels = hotelsCheckin && hotelsFor === `${hotelsCheckin}_${nights}` ? hotels : [];
  const tiers = useMemo(() => pickTiers(realHotels), [realHotels]);

  if (error && !dest) return <p className="error">{error}</p>;
  if (!dest)
    return (
      <div className="skeleton" aria-busy="true" aria-label="Cargando destino">
        <div className="sk" style={{ width: 120, height: 16 }} />
        <div className="sk" style={{ width: "40%", height: 36 }} />
        <div className="sk" style={{ width: "70%", height: 14 }} />
      </div>
    );

  const rooms = roomsForParty(party);
  const quoteOk = quote && day && quote.depart === day.date && quote.returnDate === day.returnDate;
  const flightPP = quoteOk ? quote.lowestUSD : (day?.priceUSD ?? 0);
  const flightSource = quoteOk ? "Google Flights, hoy" : day?.source === "en vivo" ? "visto en los últimos días" : "estimado";
  const flights = Math.round(flightPP * fareUnits(party));
  const bags = bagsCost(party, dest.region);

  const realPick = custom ?? tiers[tier];
  const estStay = stays.find((s) => s.tier === tier);
  const lodging = realPick ? realPick.totalUSD * rooms : (estStay?.totalUSD ?? 0);
  const lodgingLabel = realPick ? realPick.name : estStay ? `${estStay.label} (estimado)` : "";
  const daily = Math.round(dest.dailyUSD[style] * (nights + 1) * dailyUnits(party));
  const includeDaily = profile.includeDaily ?? false;
  const total = flights + bags + lodging + (includeDaily ? daily : 0);
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
          label: `Vuelo ${profile.origin}–${dest.iata} ida y vuelta (${describeParty(party)}, USD ${flightPP} por adulto, ${flightSource})`,
          amountUSD: flights,
          link: (quoteOk && quote.url) || flightLinks(profile.origin, dest.iata, day.date, day.returnDate, travelers, meta?.marker)[0].url,
        },
        ...(bags > 0
          ? [{ kind: "extra" as const, label: `Equipaje: ${BAGS_LABEL[party.bags].toLowerCase()} por persona, ida y vuelta (estimado)`, amountUSD: bags }]
          : []),
        {
          kind: "alojamiento",
          label: `${lodgingLabel} · ${nights} noches${rooms > 1 ? ` · ${rooms} hab.` : ""}${realPick ? " (precio real)" : ""}`,
          amountUSD: lodging,
          link: realPick?.link ?? estStay?.links[0].url,
        },
        ...(includeDaily
          ? [
              {
                kind: "gastos" as const,
                label: `Comidas, traslados y actividades (${STYLE_LABEL[style].toLowerCase()}, estimado)`,
                amountUSD: daily,
              },
            ]
          : []),
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
    app.addWatch({ destinationId: dest.id, targetUSD: Math.round(total), month: m, nights }, { party, style });
    setSaved("watch");
  }

  // Grilla del calendario: arranca en lunes.
  const firstDay = month ? new Date(`${month}-01T12:00:00`) : null;
  const offset = firstDay ? (firstDay.getDay() + 6) % 7 : 0;
  const daysInMonth = firstDay ? new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate() : 0;
  const byDate = new Map((calendar?.days ?? []).map((d) => [d.date, d]));

  const stayStart = hotelsCheckin ?? day?.date;
  const stayEnd = stayStart ? addDays(stayStart, nights) : "";

  return (
    <div className="dest-layout">
      <div className="stack-lg">
        <section className="dest-head">
          <Link to="/" className="back">
            <Icon name="chevronLeft" size={22} />
            Explorar
          </Link>
          <h1>{dest.name}</h1>
          {photos[dest.id] && (
            <div className="dest-hero">
              <img src={photos[dest.id]} alt={`Foto ilustrativa de ${dest.name}`} referrerPolicy="no-referrer" />
            </div>
          )}
          <div className="meta">
            <span>
              <Icon name="pin" size={16} />
              {dest.country}
            </span>
            <span>
              <Icon name="plane" size={16} />
              {dest.flightHours} h de vuelo desde Buenos Aires
            </span>
            <span>
              <Icon name="info" size={16} />
              {dest.docs}
            </span>
          </div>
          <p className="subhead">{dest.blurb}</p>
          <div className="chips static">
            {dest.tags.map((t) => (
              <span key={t} className="chip">
                <Icon name={INTEREST_ICON[t] ?? "sparkles"} size={16} />
                {capitalize(t)}
              </span>
            ))}
          </div>
          <p className="small muted">Imperdibles: {dest.highlights.join(" · ")}</p>
        </section>

        <section className="card controls" aria-label="Ajustes del viaje">
          <label className="field">
            Noches
            <input type="number" min={1} max={60} value={nights} onChange={(e) => setNights(Number(e.target.value) || 1)} />
          </label>
          <div className="field">
            <span>Pasajeros</span>
            <button type="button" className="secondary" aria-expanded={editParty} onClick={() => setEditParty((v) => !v)}>
              <Icon name="users" size={16} />
              {describeParty(party)}
            </button>
          </div>
          <label className="field">
            Equipaje por persona
            <select value={party.bags} onChange={(e) => setParty({ ...party, bags: e.target.value as Bags })}>
              {(Object.keys(BAGS_LABEL) as Bags[]).map((b) => (
                <option key={b} value={b}>
                  {BAGS_LABEL[b]}
                </option>
              ))}
            </select>
          </label>
          <div className="stack-sm">
            <span className="small muted" style={{ fontWeight: 500 }}>
              Estilo
            </span>
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

        {editParty && (
          <section className="card">
            <div className="sheet-head">
              <h3>¿Quiénes viajan?</h3>
              <button type="button" className="plain" onClick={() => setEditParty(false)}>
                Listo
              </button>
            </div>
            <PartyPicker value={party} onChange={setParty} />
          </section>
        )}

        <section>
          <div className="section-head">
            <h2>Cuándo conviene ir</h2>
            <span className="small muted">Costo aproximado por persona. Con estrella, la mejor combinación de precio y clima.</span>
          </div>
          <div className="month-bars" role="list">
            {months.map((m) => (
              <button
                key={monthKey(m)}
                role="listitem"
                className={`month-bar ${month === monthKey(m) ? "on" : ""} ${m.best ? "best" : ""}`}
                onClick={() => selectMonth(monthKey(m))}
                aria-pressed={month === monthKey(m)}
                aria-label={`${capitalize(monthName(m.month))} ${m.year}: ${money(m.totalPerPersonUSD)} por persona${m.best ? ", recomendado" : ""}`}
              >
                <span className="bar-value">{money(m.totalPerPersonUSD)}</span>
                <span className="bar" style={{ height: `${Math.max(12, (m.totalPerPersonUSD / maxMonth) * 120)}px` }} />
                <span className="month-label">
                  {capitalize(monthShort(m.month))}
                  {m.best && <Icon name="star" size={10} />}
                </span>
              </button>
            ))}
          </div>
        </section>

        {month && (
          <section>
            <div className="section-head">
              <h2>Vuelos en {monthName(Number(month.slice(5, 7)))}</h2>
              <span className="small muted">Ida y vuelta por persona, {nights} noches</span>
            </div>
            <div className="calendar">
              {WEEKDAYS.map((w) => (
                <div key={w} className="cal-head">
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
                const band = !d ? "" : d.priceUSD <= priceBands.low ? "cheap" : d.priceUSD >= priceBands.high ? "pricey" : "";
                const est = !(selected && quoteOk) && d?.source === "estimado";
                return (
                  <button
                    key={date}
                    className={`cal-day ${band} ${est ? "est" : ""} ${selected ? "on" : ""}`}
                    disabled={!d}
                    onClick={() => d && setDay(d)}
                    aria-pressed={selected}
                    aria-label={d ? `${formatDate(date, { weekday: "long", day: "numeric", month: "long" })}: USD ${price}${est ? " estimado" : ""}` : undefined}
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
            <div className="legend">
              <span>
                <i style={{ background: "var(--green-soft)" }} />
                Más barato
              </span>
              <span>
                <i style={{ background: "var(--orange-soft)" }} />
                Más caro
              </span>
              <span>~ Precio estimado</span>
              {calendar?.live && <span>Sin "~": visto por usuarios en los últimos días</span>}
            </div>

            {day && (
              <>
                <div className="date-line">
                  <span>
                    Salida <strong>{formatDate(day.date, { weekday: "short", day: "numeric", month: "short" })}</strong>, vuelta{" "}
                    <strong>{formatDate(day.returnDate, { weekday: "short", day: "numeric", month: "short" })}</strong>
                    {nightsBetween(day.date, day.returnDate) !== nights && (
                      <> · {nightsBetween(day.date, day.returnDate)} noches (el precio real más cercano a {nights})</>
                    )}
                  </span>
                </div>
                <div className="date-line">
                  <a
                    className="pill-link live"
                    href={`/vuelos.html?${new URLSearchParams({ from: profile.origin, to: dest.iata, depart: day.date, ret: day.returnDate })}`}
                  >
                    <Icon name="search" size={16} />
                    Buscar en vivo, sin límite
                  </a>
                  {flightLinks(profile.origin, dest.iata, day.date, day.returnDate, travelers, meta?.marker).map((l) => (
                    <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="pill-link">
                      {l.label}
                      <Icon name="external" size={14} />
                    </a>
                  ))}
                </div>

                {loading.quote && (
                  <div className="card quote skeleton" aria-busy="true" aria-label="Buscando el precio de hoy">
                    <div className="sk" style={{ width: "45%", height: 16 }} />
                    <div className="sk" style={{ width: "100%", height: 12 }} />
                    <div className="sk" style={{ width: "100%", height: 12 }} />
                  </div>
                )}
                {quoteOk && (
                  <div className="card quote">
                    <div className="section-head" style={{ marginBottom: 0 }}>
                      <h3>Precio real de hoy en Google Flights</h3>
                      {quote.typicalRangeUSD && (
                        <span className="small muted">
                          Habitual USD {quote.typicalRangeUSD[0]}–{quote.typicalRangeUSD[1]}
                          {quote.priceLevel && `, hoy está ${LEVEL[quote.priceLevel] ?? quote.priceLevel}`}
                        </span>
                      )}
                    </div>
                    <ul className="items">
                      {quote.offers.map((o, i) => (
                        <li key={i}>
                          <span className="label">
                            <Icon name="plane" size={16} />
                            <span>
                              {o.airlines.join(" + ") || "Aerolínea"} · {o.stops === 0 ? "Directo" : `${o.stops} escala${o.stops > 1 ? "s" : ""}`}
                              {o.durationMin ? ` · ${hours(o.durationMin)}` : ""}
                            </span>
                          </span>
                          <strong>{money(o.priceUSD)}</strong>
                        </li>
                      ))}
                    </ul>
                    {quote.url && (
                      <a href={quote.url} target="_blank" rel="noreferrer" className="small row gap-sm">
                        Abrir en Google Flights <Icon name="external" size={14} />
                      </a>
                    )}
                  </div>
                )}
                {google && !loading.quote && !quoteOk && (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    {dayKey === autoKey
                      ? "Google Flights no devolvió vuelos para estas fechas; se muestra el precio del calendario. "
                      : "Para cuidar la cuota, este día muestra el precio del calendario. "}
                    {dayKey !== autoKey && (
                      <button className="link" onClick={() => fetchQuote(false, day)}>
                        Ver precio de hoy (usa 1 búsqueda)
                      </button>
                    )}{" "}
                    También podés usar Buscar en vivo, que no tiene límite.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {month && <CrossAndFly destId={dest.id} iata={dest.iata} month={month} day={day} travelers={travelers} />}

        {day && (
          <section>
            <div className="section-head">
              <h2>Dónde dormir</h2>
              <span className="small muted">
                {formatRange(stayStart ?? day.date, stayEnd)} · {rooms} {rooms === 1 ? "habitación" : "habitaciones"}
                {realHotels.length
                  ? hotelsSource === "google"
                    ? " · precios reales de Google Hotels"
                    : " · el mejor precio entre Booking, Agoda, Expedia y más"
                  : " · precios estimados"}
              </span>
            </div>
            {loading.hotels && (
              <div className="grid-3" aria-busy="true" aria-label="Buscando hoteles">
                {STYLES.map((s) => (
                  <div key={s} className="card skeleton">
                    <div className="sk" style={{ width: "100%", aspectRatio: "16 / 10", height: "auto" }} />
                    <div className="sk" style={{ width: "70%", height: 14 }} />
                    <div className="sk" style={{ width: "40%", height: 20 }} />
                  </div>
                ))}
              </div>
            )}

            {!loading.hotels && realHotels.length > 0 && (
              <>
                <div className="grid-3">
                  {STYLES.map((s) => {
                    const h = tiers[s];
                    if (!h) return null;
                    const on = !custom && tier === s;
                    return (
                      <button
                        key={s}
                        className={`stay ${on ? "on" : ""}`}
                        onClick={() => {
                          setCustom(null);
                          setTier(s);
                        }}
                        aria-pressed={on}
                      >
                        {h.thumbnail ? <img className="stay-img" src={h.thumbnail} alt="" loading="lazy" /> : <div className="stay-img" />}
                        <span className="tier">{STYLE_LABEL[s]}</span>
                        <strong>{h.name}</strong>
                        <Rating stars={h.stars} rating={h.rating} reviews={h.reviews} />
                        <span className="price">{money(h.totalUSD * rooms)}</span>
                        <span className="small muted">
                          {money(h.nightlyUSD)} por noche{h.site ? ` en ${h.site}` : ""}
                        </span>
                        {h.link && (
                          <a href={h.link} target="_blank" rel="noreferrer" className="small row gap-sm" onClick={(e) => e.stopPropagation()}>
                            Ver hotel <Icon name="external" size={14} />
                          </a>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button className="plain" style={{ marginTop: 8 }} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                  {showAll ? "Ocultar la lista" : `Ver los ${realHotels.length} hoteles`}
                  <Icon name="chevronDown" size={16} />
                </button>
                {showAll && (
                  <div className="hotel-list">
                    {realHotels.map((h) => (
                      <button
                        key={h.name}
                        className={`hotel ${custom?.name === h.name ? "on" : ""}`}
                        onClick={() => setCustom(custom?.name === h.name ? null : h)}
                        aria-pressed={custom?.name === h.name}
                      >
                        {h.thumbnail ? <img src={h.thumbnail} alt="" loading="lazy" /> : <span className="stay-img" style={{ width: 64, height: 64 }} />}
                        <span className="hotel-body">
                          <strong>{h.name}</strong>
                          <Rating stars={h.stars} rating={h.rating} />
                          <span className="small">
                            <strong>{money(h.nightlyUSD)}</strong>
                            <span className="muted">
                              {" "}
                              por noche{h.site ? ` en ${h.site}` : ""} · {money(h.totalUSD * rooms)} total
                            </span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {!loading.hotels && realHotels.length === 0 && (
              <div className="grid-3">
                {stays.map((s) => (
                  <button key={s.tier} className={`stay ${tier === s.tier ? "on" : ""}`} onClick={() => setTier(s.tier)} aria-pressed={tier === s.tier}>
                    <span className="tier">{s.label}</span>
                    <strong>{s.area}</strong>
                    <span className="price">{money(s.totalUSD)}</span>
                    <span className="small muted">
                      {money(s.nightlyUSD)} por noche · estimado
                    </span>
                    <span className="row gap small">
                      {s.links.map((l) => (
                        <a key={l.label} href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="row gap-sm">
                          {l.label} <Icon name="external" size={14} />
                        </a>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        <TripExtras destId={dest.id} />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {quota?.left != null && (
          <p className="small muted">
            Búsquedas de Google disponibles este mes: {quota.left}
            {quota.total ? ` de ${quota.total}` : ""}. Repetir una búsqueda reciente no descuenta.
          </p>
        )}
      </div>

      <aside className="card summary" aria-label="Tu paquete">
        <h2>Tu paquete</h2>
        {day && (realPick || estStay) ? (
          <>
            <p className="small muted">
              {formatRange(day.date, day.returnDate)} · {describeParty(party)}
            </p>
            <ul className="items">
              <li>
                <span className="label">
                  <Icon name="plane" size={16} />
                  <span className="stack-sm" style={{ gap: 0 }}>
                    <span>Vuelos</span>
                    <span className="small muted">{loading.quote ? "Actualizando…" : capitalize(flightSource)}</span>
                  </span>
                </span>
                <span>{money(flights)}</span>
              </li>
              {bags > 0 && (
                <li>
                  <span className="label">
                    <Icon name="luggage" size={16} />
                    <span className="stack-sm" style={{ gap: 0 }}>
                      <span>Equipaje</span>
                      <span className="small muted">{BAGS_LABEL[party.bags]} · estimado</span>
                    </span>
                  </span>
                  <span>{money(bags)}</span>
                </li>
              )}
              <li>
                <span className="label">
                  <Icon name="bed" size={16} />
                  <span className="stack-sm" style={{ gap: 0 }}>
                    <span>{realPick ? realPick.name : estStay?.label}</span>
                    <span className="small muted">{realPick ? "Precio real" : "Estimado"}</span>
                  </span>
                </span>
                <span>{money(lodging)}</span>
              </li>
              <li>
                <span className="label">
                  <Icon name="utensils" size={16} />
                  <span className="stack-sm" style={{ gap: 0 }}>
                    <span>Comidas y paseos</span>
                    <span className="small muted">
                      {includeDaily ? "Estimado" : `Aparte · aprox. ${money(daily)}`}
                    </span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  aria-label="Sumar comidas y paseos al total"
                  checked={includeDaily}
                  onChange={(e) => app.setProfile({ ...profile, includeDaily: e.target.checked })}
                />
              </li>
            </ul>
            <div className="total">
              <span className="headline">Total</span>
              <span className="price">{money(total)}</span>
            </div>
            <p className="small muted">
              {money(Math.round(total / travelers))} por persona
              {includeDaily ? "" : " · sin comidas ni paseos"}
            </p>
            <button className="primary full" onClick={savePackage}>
              <Icon name="bookmark" size={18} />
              Guardar en Mis viajes
            </button>
            <button className="secondary full" onClick={follow}>
              <Icon name="bell" size={18} />
              Avisarme si baja
            </button>
            {saved && (
              <p className="success small row gap-sm" role="status">
                <Icon name="check" size={14} />
                {saved === "watch" ? "Lo vas a ver en Explorar con el precio al día." : "Guardado en Mis viajes."}
                <Link to={saved === "watch" ? "/" : "/viajes"}>Ver</Link>
              </p>
            )}
          </>
        ) : (
          <div className="skeleton" aria-busy="true">
            <div className="sk" style={{ width: "60%", height: 12 }} />
            <div className="sk" style={{ width: "100%", height: 12 }} />
            <div className="sk" style={{ width: "100%", height: 12 }} />
            <div className="sk" style={{ width: "50%", height: 28 }} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Rating({ stars, rating, reviews }: { stars: number | null; rating: number | null; reviews?: number | null }) {
  if (!stars && !rating) return null;
  return (
    <span className="rating">
      {stars ? `${stars} estrellas` : ""}
      {stars && rating ? " · " : ""}
      {rating ? (
        <>
          <Icon name="star" size={12} />
          {rating.toLocaleString("es-AR")}
        </>
      ) : null}
      {reviews ? ` (${reviews.toLocaleString("es-AR")})` : ""}
    </span>
  );
}
