import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Destination, FlightCalendar, MonthPrice, Party, Style } from "../../shared/types.ts";
import { describeParty, partyToParams } from "../../shared/pricing.ts";
import { estimateTrip, lodgingFor, lowest, type TripEstimate } from "../../shared/compare.ts";
import Icon from "../components/Icon.tsx";
import Segmented from "../components/Segmented.tsx";
import { Photo } from "../components/SuggestionCard.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { COMPARE_MAX, useCompare } from "../lib/compare.ts";
import { capitalize, formatDate, isDomestic, monthName, monthShort, pesoRate, STYLE_LABEL } from "../lib/format.ts";
import { load } from "../lib/storage.ts";

// Comparar 2 o 3 destinos lado a lado: vuelo (real si lo vieron en Aviasales
// para ese mes; si no, estimado), alojamiento, gastos diarios y el total del grupo.

const STYLES: Style[] = ["low", "mid", "high"];
const NIGHTS = [3, 4, 5, 7, 10, 14, 21];

/** Última búsqueda de Explorar (grupo, noches y alojamiento), si la hay. */
function lastSearch(): { nights?: number; party?: Party; style?: Style } {
  const s = load<{ nights?: unknown; party?: unknown; style?: unknown } | null>("fmt.lastSearch", null);
  if (!s || typeof s !== "object") return {};
  const party = s.party as Party | undefined;
  return {
    nights: typeof s.nights === "number" && s.nights > 0 ? s.nights : undefined,
    party: party && typeof party.adults === "number" && Array.isArray(party.childAges) ? party : undefined,
    style: STYLES.includes(s.style as Style) ? (s.style as Style) : undefined,
  };
}

interface Column {
  dest: Destination;
  /** Mes usado para los precios (null mientras carga o si falló). */
  when: { month: number; year: number } | null;
  flightPP: number | null;
  /** Precio visto en Aviasales para ese mes (si no, estimado). */
  real: { date: string } | null;
  trip: TripEstimate | null;
  status: "loading" | "ok" | "error";
}

const monthKey = (m: { month: number; year: number }) => `${m.year}-${String(m.month).padStart(2, "0")}`;

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const { destinations, profile, money, meta, moneyHint } = useApp();
  // Por Argentina se paga en pesos al oficial y afuera con dólar tarjeta: cada columna con su cambio.
  const domesticOf = (d: Destination) => isDomestic(d.region);
  const colMoney = (d: Destination, usd: number) => money(usd, { domestic: domesticOf(d) });
  const rates = { card: meta?.usdArsRate ?? 1450, official: meta?.usdArsOfficialRate };
  // Para elegir "Más barato" comparamos lo que se paga en pesos.
  const payFactor = (d: Destination) => (profile.currency === "ARS" && domesticOf(d) ? pesoRate(rates, true) / pesoRate(rates, false) : 1);
  const compare = useCompare();
  const last = useMemo(lastSearch, []);
  const party: Party = last.party ?? { adults: profile.travelers, childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" };
  const [style, setStyle] = useState<Style>(last.style ?? profile.style);
  const [nights, setNights] = useState<number>(Number(params.get("nights")) || last.nights || 7);
  // "best" = el mejor mes de cada destino; si no, un mes "YYYY-MM" para todos.
  const [monthChoice, setMonthChoice] = useState<string>(params.get("month") ?? "best");

  const ids = useMemo(
    () => [...new Set((params.get("ids") ?? "").split(",").filter(Boolean))].slice(0, COMPARE_MAX),
    [params],
  );
  const idsKey = ids.join(",");

  // La barra de abajo y esta página muestran lo mismo.
  useEffect(() => {
    for (const id of ids) if (!compare.has(id)) compare.toggle(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Precios por mes de cada destino (vuelo estimado desde tu ciudad).
  const [overview, setOverview] = useState<Record<string, MonthPrice[] | "error">>({});
  useEffect(() => {
    let alive = true;
    setOverview({});
    for (const id of ids) {
      api
        .destination(id, { origin: profile.origin, nights: 7, travelers: 2, style: "mid" })
        .then((r) => {
          if (alive) setOverview((o) => ({ ...o, [id]: r.months }));
        })
        .catch(() => {
          if (alive) setOverview((o) => ({ ...o, [id]: "error" }));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, profile.origin]);

  const monthFor = (id: string): { month: number; year: number } | null => {
    const rows = overview[id];
    if (!Array.isArray(rows) || !rows.length) return null;
    if (monthChoice !== "best") {
      const row = rows.find((r) => monthKey(r) === monthChoice);
      return row ? { month: row.month, year: row.year } : null;
    }
    const pool = rows.filter((r) => r.best);
    const best = (pool.length ? pool : rows).reduce((a, b) => (b.totalPerPersonUSD < a.totalPerPersonUSD ? b : a));
    return { month: best.month, year: best.year };
  };

  // Precio real del mes (Aviasales, gratis): el más barato para esas noches.
  const calKey = ids.map((id) => `${id}:${monthFor(id) ? monthKey(monthFor(id)!) : ""}`).join(",");
  const [calendars, setCalendars] = useState<Record<string, FlightCalendar | null>>({});
  useEffect(() => {
    let alive = true;
    for (const id of ids) {
      const m = monthFor(id);
      if (!m) continue;
      const key = `${id}:${monthKey(m)}:${nights}`;
      if (key in calendars) continue;
      api
        .calendar({ origin: profile.origin, dest: id, month: monthKey(m), nights })
        .then((c) => {
          if (alive) setCalendars((x) => ({ ...x, [key]: c }));
        })
        .catch(() => {
          if (alive) setCalendars((x) => ({ ...x, [key]: null }));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calKey, nights, profile.origin]);

  const columns: Column[] = ids.flatMap((id): Column[] => {
    const dest = destinations.find((d) => d.id === id);
    if (!dest) return [];
    const rows = overview[id];
    if (rows === "error") return [{ dest, when: null, flightPP: null, real: null, trip: null, status: "error" as const }];
    const when = monthFor(id);
    if (!when) return [{ dest, when: null, flightPP: null, real: null, trip: null, status: rows ? ("error" as const) : ("loading" as const) }];
    const estimate = rows!.find((r) => r.month === when.month && r.year === when.year)!.flightUSD;
    const cal = calendars[`${id}:${monthKey(when)}:${nights}`];
    const live = cal?.live && cal.cheapest ? cal.cheapest : null;
    const flightPP = live?.priceUSD ?? estimate;
    return [
      {
        dest,
        when,
        flightPP,
        real: live ? { date: live.date } : null,
        trip: estimateTrip(dest, flightPP, when.month, nights, party, style),
        status: "ok" as const,
      },
    ];
  });

  function setIds(next: string[]) {
    const p = new URLSearchParams(params);
    if (next.length) p.set("ids", next.join(","));
    else p.delete("ids");
    setParams(p, { replace: true });
  }
  function removeId(id: string) {
    compare.remove(id);
    setIds(ids.filter((x) => x !== id));
  }
  function addId(id: string) {
    if (!id || ids.includes(id) || ids.length >= COMPARE_MAX) return;
    if (!compare.has(id)) compare.toggle(id);
    setIds([...ids, id]);
  }

  const months = (() => {
    const first = Object.values(overview).find(Array.isArray);
    return Array.isArray(first) ? first.map((r) => ({ key: monthKey(r), label: `${capitalize(monthName(r.month))} ${r.year}` })) : [];
  })();
  const addable = destinations.filter((d) => !ids.includes(d.id)).sort((a, b) => a.name.localeCompare(b.name, "es"));

  const head = (
    <section className="search-head">
      <Link to="/" className="back">
        <Icon name="chevronLeft" size={22} />
        Explorar
      </Link>
      <div>
        <h1>Comparar destinos</h1>
        <p className="muted">
          {describeParty(party)} · {nights} noches · alojamiento {STYLE_LABEL[style].toLowerCase()}
        </p>
      </div>
    </section>
  );

  const addSelect = ids.length < COMPARE_MAX && addable.length > 0 && (
    <label className="cmp-add">
      <span className="visually-hidden">Sumar un destino a la comparación</span>
      <select value="" onChange={(e) => addId(e.target.value)}>
        <option value="">Sumar un destino</option>
        {addable.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.country})
          </option>
        ))}
      </select>
    </label>
  );

  if (ids.length < 2) {
    return (
      <div className="stack-lg">
        {head}
        <div className="card empty">
          <Icon name="search" size={28} />
          <h3>Elegí 2 o 3 destinos</h3>
          <p className="muted">
            Tocá "Comparar" en los resultados de Explorar o en el catálogo de "Ya sé a dónde". También podés sumarlos acá.
          </p>
          {ids.length === 1 && <p className="small">Ya elegiste: {destinations.find((d) => d.id === ids[0])?.name ?? ids[0]}</p>}
          {addSelect}
          <Link className="button secondary" to="/">
            Ir a Explorar
          </Link>
        </div>
      </div>
    );
  }

  if (!destinations.length) {
    return (
      <div className="stack-lg">
        {head}
        <div className="card skeleton cmp-skeleton" aria-busy="true" aria-label="Cargando destinos" />
      </div>
    );
  }

  const ok = columns.map((c) => (c.status === "ok" ? c : null));
  const best = {
    flight: lowest(ok.map((c) => (c?.flightPP != null ? c.flightPP * payFactor(c.dest) : null))),
    lodging: lowest(ok.map((c) => (c?.when ? lodgingFor(c.dest, style, c.when.month) * payFactor(c.dest) : null))),
    daily: lowest(columns.map((c) => c.dest.dailyUSD[style] * payFactor(c.dest))),
    total: lowest(ok.map((c) => (c?.trip?.total != null ? c.trip.total * payFactor(c.dest) : null))),
    hours: lowest(columns.map((c) => c.dest.flightHours)),
  };
  const BestTag = ({ show, children }: { show: boolean; children: ReactNode }) =>
    show ? (
      <span className="cmp-best">
        <Icon name="check" size={14} />
        {children}
      </span>
    ) : null;
  const pending = (c: Column) =>
    c.status === "loading" ? <span className="sk cmp-sk" aria-label="Cargando" /> : <span className="small muted">Sin datos por ahora</span>;

  const rows: { label: string; cells: ReactNode[] }[] = [
    {
      label: "Vuelo ida y vuelta por persona",
      cells: columns.map((c, i) =>
        c.status !== "ok" ? (
          pending(c)
        ) : (
          <div className="cmp-cell">
            <strong className="cmp-num">{colMoney(c.dest, c.flightPP!)}</strong>
            <span className={`small ${c.real ? "cmp-real" : "muted"}`}>
              {c.real ? `Visto en Aviasales, saliendo el ${formatDate(c.real.date)}` : "Estimado"}
            </span>
            <BestTag show={best.flight.has(i)}>Más barato</BestTag>
          </div>
        ),
      ),
    },
    {
      label: "Alojamiento por noche",
      cells: columns.map((c, i) => {
        const m = c.when?.month ?? new Date().getMonth() + 1;
        return (
          <div className="cmp-cell">
            <ul className="cmp-styles">
              {STYLES.map((st) => (
                <li key={st} className={st === style ? "on" : ""}>
                  <span>{STYLE_LABEL[st]}</span>
                  <span className="cmp-num">{colMoney(c.dest, lodgingFor(c.dest, st, m))}</span>
                </li>
              ))}
            </ul>
            <BestTag show={best.lodging.has(i)}>Más barato en {STYLE_LABEL[style].toLowerCase()}</BestTag>
          </div>
        );
      }),
    },
    {
      label: "Comidas y paseos por día, por persona",
      cells: columns.map((c, i) => (
        <div className="cmp-cell">
          <strong className="cmp-num">{colMoney(c.dest, c.dest.dailyUSD[style])}</strong>
          <span className="small muted">Estimado, aparte del total</span>
          <BestTag show={best.daily.has(i)}>Más barato</BestTag>
        </div>
      )),
    },
    {
      label: `Total para ${describeParty(party)}, ${nights} noches`,
      cells: columns.map((c, i) =>
        c.status !== "ok" || !c.trip ? (
          pending(c)
        ) : (
          <div className="cmp-cell">
            <strong className="cmp-num cmp-total">{colMoney(c.dest, c.trip.total)}</strong>
            <span className="small muted">
              {colMoney(c.dest, c.trip.perPerson)} por persona · vuelo, equipaje y alojamiento en {monthName(c.when!.month)}
            </span>
            <span className="small muted">+ {colMoney(c.dest, c.trip.daily)} de comidas y paseos</span>
            {moneyHint(domesticOf(c.dest)) && <span className="small muted">{moneyHint(domesticOf(c.dest))}</span>}
            <BestTag show={best.total.has(i)}>Más barato</BestTag>
          </div>
        ),
      ),
    },
    {
      label: "Mejor época",
      cells: columns.map((c) => (
        <div className="cmp-cell">
          <span>{c.dest.bestMonths.map((m) => monthShort(m)).join(", ")}</span>
          {c.when && (
            <span className={`small ${c.dest.bestMonths.includes(c.when.month) ? "cmp-real" : "muted"}`}>
              {c.dest.bestMonths.includes(c.when.month) ? `${capitalize(monthName(c.when.month))} es buena época` : `${capitalize(monthName(c.when.month))} no es la mejor época`}
            </span>
          )}
        </div>
      )),
    },
    {
      label: "Horas de vuelo",
      cells: columns.map((c, i) => (
        <div className="cmp-cell">
          <strong className="cmp-num">{String(c.dest.flightHours).replace(".", ",")} h</strong>
          <span className="small muted">Desde Buenos Aires, aprox.</span>
          <BestTag show={best.hours.has(i)}>Más corto</BestTag>
        </div>
      )),
    },
    {
      label: "Documentación",
      cells: columns.map((c) => <span className="small">{c.dest.docs}</span>),
    },
    {
      label: "Imperdibles",
      cells: columns.map((c) => (
        <ul className="cmp-list small">
          {c.dest.highlights.slice(0, 3).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )),
    },
  ];

  const linkFor = (c: Column) => {
    const q = new URLSearchParams({ nights: String(nights), ...partyToParams(party) });
    if (c.when) q.set("month", monthKey(c.when));
    return `/destino/${c.dest.id}?${q}`;
  };

  return (
    <div className="stack-lg">
      {head}

      <div className="cmp-controls">
        <div className="lodging-picker">
          <span className="lodging-label">Alojamiento</span>
          <Segmented label="Alojamiento" value={style} onChange={setStyle} options={STYLES.map((s) => ({ value: s, label: STYLE_LABEL[s] }))} />
        </div>
        <label className="cmp-field">
          <span>Noches</span>
          <select value={nights} onChange={(e) => setNights(Number(e.target.value))}>
            {[...new Set([...NIGHTS, nights])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n} noches
              </option>
            ))}
          </select>
        </label>
        <label className="cmp-field">
          <span>Cuándo</span>
          <select value={monthChoice} onChange={(e) => setMonthChoice(e.target.value)}>
            <option value="best">El mejor mes de cada uno</option>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        {addSelect}
      </div>

      <div className="cmp-scroll" role="region" aria-label="Comparación de destinos" tabIndex={0}>
        <table className="cmp-table" style={{ ["--cmp-cols" as string]: columns.length }}>
          <thead>
            <tr>
              <th scope="col" className="cmp-corner">
                <span className="visually-hidden">Dato</span>
              </th>
              {columns.map((c) => (
                <th key={c.dest.id} scope="col" className="cmp-head">
                  <CompareHead c={c} onRemove={() => removeId(c.dest.id)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.cells.map((cell, i) => (
                  <td key={columns[i].dest.id}>{cell}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">
                <span className="visually-hidden">Ficha</span>
              </th>
              {columns.map((c) => (
                <td key={c.dest.id}>
                  <Link className="button secondary cmp-go" to={linkFor(c)}>
                    Ver ficha
                    <Icon name="chevronRight" size={16} />
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Vuelo: lo más barato que vieron usuarios de Aviasales para ese mes y esas noches; si no hay dato, una estimación. Alojamiento por habitación
        doble. Comidas y paseos van aparte del total. Confirmá siempre antes de comprar.
      </p>
    </div>
  );
}

function CompareHead({ c, onRemove }: { c: Column; onRemove: () => void }) {
  const { photos } = useApp();
  return (
    <div className="cmp-head-body">
      <Photo src={photos[c.dest.id]} name={c.dest.name} />
      <div className="cmp-head-row">
        <div className="grow">
          <strong>{c.dest.name}</strong>
          <span className="small muted">
            {c.dest.country}
            {c.when ? ` · ${capitalize(monthName(c.when.month))} ${c.when.year}` : ""}
          </span>
        </div>
        <button type="button" className="icon-btn cmp-remove" aria-label={`Quitar ${c.dest.name} de la comparación`} onClick={onRemove}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </div>
  );
}
