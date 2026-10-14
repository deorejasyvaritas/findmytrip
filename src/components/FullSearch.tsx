import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { GeoPlace, Party, Place } from "../../shared/types.ts";
import { DEFAULT_PARTY, describeParty, partyFromParams, partyToParams } from "../../shared/pricing.ts";
import { describeWindow, quickWindows, tripDatesFromParams, tripDatesToParams, validWindow, type DateWindow } from "../../shared/trip-window.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import Icon from "./Icon.tsx";
import Segmented from "./Segmented.tsx";
import { PartyPicker } from "./TripPickers.tsx";

// Buscador completo (estilo Despegar): vuelos, hoteles, vuelo + hotel y multidestino.
// Cada formulario lleva a /buscar con los datos en la URL (se puede compartir y volver atrás).

export type SearchKind = "vuelos" | "hoteles" | "paquete" | "multi" | "viaje";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface PlaceValue {
  code: string;
  label: string;
}

/** Campo de ciudad o aeropuerto con sugerencias (combobox accesible). */
export function PlaceInput({
  label,
  value,
  onChange,
  placeholder,
  citiesOnly,
}: {
  label: string;
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  placeholder: string;
  citiesOnly?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  useEffect(() => {
    setText(value?.label ?? "");
  }, [value?.code, value?.label]);

  useEffect(() => {
    if (!typed.current || text.trim().length < 2) return setItems([]);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .places(text)
        .then((r) => !cancelled && (setItems(citiesOnly ? r.filter((p) => p.type === "city") : r), setActive(0)))
        .catch(() => !cancelled && setItems([]));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, citiesOnly]);

  function pick(p: Place) {
    const lbl = p.type === "airport" ? `${p.name} (${p.code})` : `${p.name}, ${p.country}`;
    typed.current = false;
    setText(lbl);
    setOpen(false);
    onChange({ code: p.code, label: lbl });
  }

  return (
    <label className="tile place">
      <span>{label}</span>
      <input
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          if (e.key === "Enter") (e.preventDefault(), pick(items[active]));
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul className="place-list" id={`${id}-list`} role="listbox">
          {items.map((p, i) => (
            <li
              key={`${p.type}-${p.code}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : ""}
              onMouseDown={(e) => (e.preventDefault(), pick(p))}
            >
              <Icon name={p.type === "airport" ? "plane" : "pin"} size={16} />
              <span className="grow">
                <strong>{p.name}</strong>
                <span className="small muted">
                  {p.type === "airport" ? `${p.city ?? ""} ${p.country}`.trim() : `${p.country}${p.airport ? ` · ${p.airport}` : ""}`}
                </span>
              </span>
              <span className="place-code">{p.code}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

/** Botón de pasajeros con su panel. */
function PartyTile({ party, onChange, label = "Pasajeros" }: { party: Party; onChange: (p: Party) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tile tile-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <strong>{describeParty(party)}</strong>
      </button>
      {open && (
        <div className="sheet span-all">
          <div className="sheet-head">
            <h3>¿Quiénes viajan?</h3>
            <button type="button" className="plain" onClick={() => setOpen(false)}>
              Listo
            </button>
          </div>
          <PartyPicker value={party} onChange={onChange} />
        </div>
      )}
    </>
  );
}

function DateTile({ label, value, min, onChange, disabled }: { label: string; value: string; min: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="tile">
      <span>{label}</span>
      <input type="date" value={value} min={min} disabled={disabled} required={!disabled} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function FormShell({ children, onSubmit, cta, error, extra }: { children: ReactNode; onSubmit: (e: FormEvent) => void; cta: string; error: string | null; extra?: ReactNode }) {
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={onSubmit} noValidate>
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="search-actions">
        <button className="search-cta">
          <Icon name="search" size={18} />
          {cta}
        </button>
        {extra}
      </div>
    </form>
  );
}

const placeParam = (p: PlaceValue) => `${p.code}|${p.label}`;
export const readPlace = (raw: string | null): PlaceValue | null => {
  if (!raw) return null;
  const [code, ...rest] = raw.split("|");
  return /^[A-Z]{3}$/.test(code) ? { code, label: rest.join("|") || code } : null;
};

function useOrigin(): PlaceValue {
  const { profile, meta } = useApp();
  const name = meta?.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;
  return { code: profile.origin, label: name === profile.origin ? profile.origin : `${name} (${profile.origin})` };
}

function useParty(prefill: URLSearchParams | null): [Party, (p: Party) => void] {
  const { profile } = useApp();
  const base: Party = { adults: profile.travelers || DEFAULT_PARTY.adults, childAges: profile.childAges ?? [], bags: profile.bags ?? "cabin" };
  return useState<Party>(() => (prefill ? partyFromParams(prefill, base) : base));
}

/** Si estamos en /buscar con una búsqueda del mismo tipo, el formulario arranca con esos datos. */
function usePrefill(kind: SearchKind): URLSearchParams | null {
  const [params] = useSearchParams();
  return params.get("tipo") === kind ? params : null;
}

/** Vuelos y Vuelo + Hotel comparten el formulario. */
export function FlightForm({ kind }: { kind: "vuelos" | "paquete" }) {
  const navigate = useNavigate();
  const home = useOrigin();
  const pre = usePrefill(kind);
  const [roundTrip, setRoundTrip] = useState<"rt" | "ow">(pre && !pre.get("ret") ? "ow" : "rt");
  const [origin, setOrigin] = useState<PlaceValue | null>(readPlace(pre?.get("from") ?? null) ?? home);
  // El nombre de la ciudad de salida llega con los datos del sitio: lo completamos cuando aparece.
  useEffect(() => {
    setOrigin((o) => (o && o.code === home.code && o.label !== home.label ? home : o));
  }, [home.code, home.label]);
  const [dest, setDest] = useState<PlaceValue | null>(readPlace(pre?.get("to") ?? null));
  const [depart, setDepart] = useState(pre?.get("depart") ?? plusDays(today(), 30));
  const [ret, setRet] = useState(pre?.get("ret") ?? plusDays(today(), 37));
  const [party, setParty] = useParty(pre);
  const [direct, setDirect] = useState(pre?.get("direct") === "1");
  const [error, setError] = useState<string | null>(null);
  const oneWay = kind === "vuelos" && roundTrip === "ow";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!origin || !dest) return setError("Elegí origen y destino de la lista de sugerencias.");
    if (origin.code === dest.code) return setError("El origen y el destino son iguales.");
    if (!depart) return setError("Elegí la fecha de ida.");
    if (!oneWay && (!ret || ret <= depart)) return setError("La vuelta tiene que ser después de la ida.");
    setError(null);
    const q = new URLSearchParams({ tipo: kind, from: placeParam(origin), to: placeParam(dest), depart, ...partyToParams(party) });
    if (!oneWay) q.set("ret", ret);
    if (direct) q.set("direct", "1");
    navigate(`/buscar?${q}`);
  }

  const liveUrl =
    origin && dest && depart
      ? `/vuelos.html?${new URLSearchParams({ from: origin.code, to: dest.code, depart, ...(oneWay ? {} : { ret }) })}`
      : "/vuelos.html";

  return (
    <FormShell
      onSubmit={submit}
      error={error}
      cta={kind === "paquete" ? "Armar vuelo + hotel" : "Buscar vuelos"}
      extra={
        kind === "vuelos" && (
          <a className="search-secondary" href={liveUrl}>
            Buscar en vivo en Aviasales
          </a>
        )
      }
    >
      {kind === "vuelos" && (
        <div className="search-row">
          <Segmented
            label="Tipo de viaje"
            value={roundTrip}
            onChange={setRoundTrip}
            options={[
              { value: "rt", label: "Ida y vuelta" },
              { value: "ow", label: "Solo ida" },
            ]}
          />
          <button type="button" className={`chip ${direct ? "on" : ""}`} aria-pressed={direct} onClick={() => setDirect((d) => !d)}>
            Solo directos
          </button>
        </div>
      )}
      <div className="search-grid flights">
        <div className="od">
          <PlaceInput label="Origen" value={origin} onChange={setOrigin} placeholder="Ciudad o aeropuerto" />
          <button type="button" className="swap" aria-label="Invertir origen y destino" onClick={() => (setOrigin(dest), setDest(origin))}>
            <Icon name="refresh" size={18} />
          </button>
          <PlaceInput label="Destino" value={dest} onChange={setDest} placeholder="¿A dónde vas?" />
        </div>
        <DateTile label="Ida" value={depart} min={today()} onChange={(v) => (setDepart(v), ret <= v && setRet(plusDays(v, 7)))} />
        <DateTile label="Vuelta" value={oneWay ? "" : ret} min={depart || today()} onChange={setRet} disabled={oneWay} />
        <PartyTile party={party} onChange={setParty} />
      </div>
    </FormShell>
  );
}

export function HotelForm() {
  const navigate = useNavigate();
  const pre = usePrefill("hoteles");
  const [dest, setDest] = useState<PlaceValue | null>(readPlace(pre?.get("to") ?? null));
  const [checkin, setCheckin] = useState(pre?.get("depart") ?? plusDays(today(), 30));
  const [checkout, setCheckout] = useState(pre?.get("ret") ?? plusDays(today(), 37));
  const [party, setParty] = useParty(pre);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!dest) return setError("Elegí la ciudad de la lista de sugerencias.");
    if (!checkin || !checkout || checkout <= checkin) return setError("La salida tiene que ser después de la entrada.");
    setError(null);
    navigate(`/buscar?${new URLSearchParams({ tipo: "hoteles", to: placeParam(dest), depart: checkin, ret: checkout, ...partyToParams(party) })}`);
  }

  return (
    <FormShell onSubmit={submit} error={error} cta="Buscar hoteles">
      <div className="search-grid hotels">
        <PlaceInput label="Destino" value={dest} onChange={setDest} placeholder="Ciudad" citiesOnly />
        <DateTile label="Entrada" value={checkin} min={today()} onChange={(v) => (setCheckin(v), checkout <= v && setCheckout(plusDays(v, 3)))} />
        <DateTile label="Salida" value={checkout} min={checkin || today()} onChange={setCheckout} />
        <PartyTile party={party} onChange={setParty} label="Huéspedes" />
      </div>
    </FormShell>
  );
}

interface LegDraft {
  origin: PlaceValue | null;
  destination: PlaceValue | null;
  date: string;
}

export function MultiForm() {
  const navigate = useNavigate();
  const home = useOrigin();
  const pre = usePrefill("multi");
  const [legs, setLegs] = useState<LegDraft[]>(() => {
    const fromUrl = (pre?.getAll("leg") ?? []).map((raw) => {
      const [a, b, date] = raw.split("~");
      return { origin: readPlace(a), destination: readPlace(b), date: date ?? "" };
    });
    return fromUrl.length >= 2
      ? fromUrl
      : [
          { origin: home, destination: null, date: plusDays(today(), 30) },
          { origin: null, destination: null, date: plusDays(today(), 35) },
        ];
  });
  const [party, setParty] = useParty(pre);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLegs((ls) => ls.map((l, i) => (i === 0 && l.origin?.code === home.code && l.origin.label !== home.label ? { ...l, origin: home } : l)));
  }, [home.code, home.label]);

  const update = (i: number, patch: Partial<LegDraft>) =>
    setLegs((ls) =>
      ls.map((l, j) => {
        if (j === i) return { ...l, ...patch };
        // El destino de un tramo es el origen sugerido del siguiente.
        if (j === i + 1 && patch.destination && !l.origin) return { ...l, origin: patch.destination };
        return l;
      }),
    );

  function submit(e: FormEvent) {
    e.preventDefault();
    if (legs.some((l) => !l.origin || !l.destination || !l.date)) return setError("Completá origen, destino y fecha de cada tramo.");
    if (legs.some((l, i) => i > 0 && l.date < legs[i - 1].date)) return setError("Las fechas tienen que ir en orden.");
    setError(null);
    const q = new URLSearchParams({ tipo: "multi", ...partyToParams(party) });
    legs.forEach((l) => q.append("leg", `${placeParam(l.origin!)}~${placeParam(l.destination!)}~${l.date}`));
    navigate(`/buscar?${q}`);
  }

  return (
    <FormShell onSubmit={submit} error={error} cta="Buscar multidestino">
      <ol className="legs">
        {legs.map((l, i) => (
          <li key={i} className="leg">
            <span className="leg-n" aria-hidden="true">
              {i + 1}
            </span>
            <div className="search-grid multi">
              <PlaceInput label={`Tramo ${i + 1}: origen`} value={l.origin} onChange={(origin) => update(i, { origin })} placeholder="Ciudad o aeropuerto" />
              <PlaceInput label="Destino" value={l.destination} onChange={(destination) => update(i, { destination })} placeholder="Ciudad o aeropuerto" />
              <DateTile label="Fecha" value={l.date} min={i ? legs[i - 1].date : today()} onChange={(date) => update(i, { date })} />
            </div>
            {legs.length > 2 && (
              <button type="button" className="leg-remove" aria-label={`Quitar tramo ${i + 1}`} onClick={() => setLegs((ls) => ls.filter((_, j) => j !== i))}>
                <Icon name="close" size={16} />
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="search-row">
        {legs.length < 5 && (
          <button
            type="button"
            className="chip"
            onClick={() => setLegs((ls) => [...ls, { origin: ls[ls.length - 1].destination, destination: null, date: plusDays(ls[ls.length - 1].date, 4) }])}
          >
            <Icon name="plus" size={16} />
            Agregar tramo
          </button>
        )}
      </div>
      <div className="search-grid party-only">
        <PartyTile party={party} onChange={setParty} />
      </div>
    </FormShell>
  );
}

// ---------------------------------------------------------------------------
// "Ya sé a dónde": una o varias paradas, en cualquier lugar (también pueblos sin aeropuerto).
// ---------------------------------------------------------------------------

const geoLabel = (p: GeoPlace) => [p.name, p.region, p.country].filter(Boolean).join(", ");

/** Campo de lugar (ciudad, pueblo o playa) con sugerencias. */
export function GeoInput({ label, value, onChange }: { label: string; value: GeoPlace | null; onChange: (v: GeoPlace | null) => void }) {
  const id = useId();
  const [text, setText] = useState(value ? geoLabel(value) : "");
  const [items, setItems] = useState<GeoPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef(false);

  useEffect(() => {
    setText(value ? geoLabel(value) : "");
  }, [value?.lat, value?.lon, value?.name]);

  useEffect(() => {
    if (!typed.current || text.trim().length < 2) return setItems([]);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .geo(text)
        .then((r) => !cancelled && (setItems(r), setActive(0)))
        .catch(() => !cancelled && setItems([]));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text]);

  function pick(p: GeoPlace) {
    typed.current = false;
    setText(geoLabel(p));
    setOpen(false);
    onChange(p);
  }

  return (
    <label className="tile place">
      <span>{label}</span>
      <input
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={text}
        placeholder="Ciudad, pueblo o playa"
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          if (e.key === "Enter") (e.preventDefault(), pick(items[active]));
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul className="place-list" id={`${id}-list`} role="listbox">
          {items.map((p, i) => (
            <li
              key={`${p.name}-${p.lat}-${p.lon}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : ""}
              onMouseDown={(e) => (e.preventDefault(), pick(p))}
            >
              <Icon name="pin" size={16} />
              <span className="grow">
                <strong>{p.name}</strong>
                <span className="small muted">{[p.region, p.country].filter(Boolean).join(", ")}</span>
              </span>
              {p.destinationId && <span className="place-code">Con ficha</span>}
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

interface StopDraft {
  place: GeoPlace | null;
  nights: number;
}

export const stopParam = (p: GeoPlace, nights: number) => [p.name, p.region ?? "", p.country, p.lat, p.lon, nights, p.destinationId ?? ""].join("~");
export function readStop(raw: string): (GeoPlace & { nights: number }) | null {
  const [name, region, country, lat, lon, nights, destinationId] = raw.split("~");
  if (!name || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  return { name, region: region || null, country: country ?? "", lat: Number(lat), lon: Number(lon), nights: Math.max(1, Number(nights) || 1), destinationId: destinationId || null };
}

export function TripForm() {
  const navigate = useNavigate();
  const home = useOrigin();
  const pre = usePrefill("viaje");
  const [origin, setOrigin] = useState<PlaceValue | null>(readPlace(pre?.get("from") ?? null) ?? home);
  useEffect(() => {
    setOrigin((o) => (o && o.code === home.code && o.label !== home.label ? home : o));
  }, [home.code, home.label]);
  const preDates = pre ? tripDatesFromParams(pre) : null;
  const [depart, setDepart] = useState(preDates?.depart || plusDays(today(), 30));
  // Fechas flexibles: una ventana (por ejemplo, la segunda quincena de julio) y el servidor elige el día más barato.
  const [flex, setFlex] = useState<"exact" | "flex">(preDates?.window ? "flex" : "exact");
  const [win, setWin] = useState<DateWindow>(() => preDates?.window ?? defaultWindow(plusDays(today(), 30)));
  const [stops, setStops] = useState<StopDraft[]>(() => {
    const fromUrl = (pre?.getAll("stop") ?? []).map(readStop).filter((s): s is NonNullable<typeof s> => Boolean(s));
    return fromUrl.length ? fromUrl.map((s) => ({ place: s, nights: s.nights })) : [{ place: null, nights: 5 }];
  });
  const [party, setParty] = useParty(pre);
  const [error, setError] = useState<string | null>(null);
  const totalNights = stops.reduce((n, s) => n + (s.nights || 0), 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!origin) return setError("Elegí desde dónde salís.");
    if (stops.some((s) => !s.place)) return setError("Elegí cada lugar de la lista de sugerencias.");
    if (stops.some((s) => !s.nights || s.nights < 1)) return setError("Cada parada necesita al menos 1 noche.");
    if (flex === "exact" && !depart) return setError("Elegí la fecha de salida.");
    if (flex === "flex" && !validWindow(win)) return setError("Elegí una ventana de fechas de hasta 31 días, con el desde antes del hasta.");
    if (flex === "flex" && win.to < today()) return setError("La ventana de fechas ya pasó: elegí otra.");
    setError(null);
    const dates = flex === "flex" ? { depart: win.from, window: win, pinned: null } : { depart, window: null, pinned: null };
    const q = new URLSearchParams({ tipo: "viaje", from: placeParam(origin), ...tripDatesToParams(dates), ...partyToParams(party) });
    stops.forEach((s) => q.append("stop", stopParam(s.place!, s.nights)));
    navigate(`/buscar?${q}`);
  }

  return (
    <FormShell onSubmit={submit} error={error} cta="Armar el viaje">
      <ol className="legs">
        {stops.map((s, i) => (
          <li key={i} className="leg">
            <span className="leg-n" aria-hidden="true">
              {i + 1}
            </span>
            <div className="search-grid stop">
              <GeoInput label={stops.length > 1 ? `Parada ${i + 1}` : "¿A dónde vas?"} value={s.place} onChange={(place) => setStops((ls) => ls.map((l, j) => (j === i ? { ...l, place } : l)))} />
              <label className="tile">
                <span>Noches</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  value={s.nights}
                  onChange={(e) => setStops((ls) => ls.map((l, j) => (j === i ? { ...l, nights: Number(e.target.value) } : l)))}
                />
              </label>
            </div>
            {stops.length > 1 && (
              <button type="button" className="leg-remove" aria-label={`Quitar parada ${i + 1}`} onClick={() => setStops((ls) => ls.filter((_, j) => j !== i))}>
                <Icon name="close" size={16} />
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="search-row">
        {stops.length < 5 && (
          <button type="button" className="chip" onClick={() => setStops((ls) => [...ls, { place: null, nights: 4 }])}>
            <Icon name="plus" size={16} />
            Agregar otra parada
          </button>
        )}
        {stops.length > 1 && <span className="trip-nights">{totalNights} noches en total</span>}
      </div>
      <div className="search-row">
        <Segmented
          label="Fechas"
          value={flex}
          onChange={setFlex}
          options={[
            { value: "exact", label: "Fecha exacta" },
            { value: "flex", label: "Fechas flexibles" },
          ]}
        />
      </div>
      {flex === "flex" && <WindowPicker value={win} onChange={setWin} />}
      <div className="search-grid trip">
        <PlaceInput label="Salís desde" value={origin} onChange={setOrigin} placeholder="Ciudad o aeropuerto" />
        {flex === "exact" ? (
          <DateTile label="Fecha de salida" value={depart} min={today()} onChange={setDepart} />
        ) : (
          <div className="tile window-summary" aria-live="polite">
            <span>Salida entre</span>
            <strong>{capitalizeFirst(describeWindow(win))}</strong>
          </div>
        )}
        <PartyTile party={party} onChange={setParty} />
      </div>
    </FormShell>
  );
}

const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ventana que contiene la fecha: primera o segunda quincena de su mes. */
function defaultWindow(iso: string): DateWindow {
  const q = quickWindows(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  return Number(iso.slice(8, 10)) <= 15 ? q[0].window : q[1].window;
}

/** Próximos 12 meses para elegir la ventana. */
function nextMonths(): { year: number; month: number }[] {
  const t = today();
  let y = Number(t.slice(0, 4));
  let m = Number(t.slice(5, 7));
  return Array.from({ length: 12 }, () => {
    const out = { year: y, month: m };
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
    return out;
  });
}

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "Fechas flexibles": mes, atajos (quincenas, todo el mes) y desde–hasta a mano. */
function WindowPicker({ value, onChange }: { value: DateWindow; onChange: (w: DateWindow) => void }) {
  const year = Number(value.from.slice(0, 4));
  const month = Number(value.from.slice(5, 7));
  const quick = quickWindows(year, month);
  const current = quick.findIndex((q) => q.window.from === value.from && q.window.to === value.to);
  return (
    <div className="window-picker">
      <label className="tile window-month">
        <span>Mes</span>
        <select
          value={`${year}-${month}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split("-").map(Number);
            onChange(quickWindows(y, m)[current >= 0 ? current : 1].window);
          }}
        >
          {nextMonths().map((x) => (
            <option key={`${x.year}-${x.month}`} value={`${x.year}-${x.month}`}>
              {MONTH_NAMES[x.month - 1]} {x.year}
            </option>
          ))}
        </select>
      </label>
      <div className="chips" role="group" aria-label="Atajos de fechas">
        {quick.map((q, i) => (
          <button key={q.label} type="button" className={`chip ${i === current ? "on" : ""}`} aria-pressed={i === current} onClick={() => onChange(q.window)}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="search-grid window-dates">
        <DateTile label="Desde" value={value.from} min={today()} onChange={(v) => v && onChange({ from: v, to: value.to < v ? v : value.to })} />
        <DateTile label="Hasta" value={value.to} min={value.from} onChange={(v) => v && onChange({ ...value, to: v })} />
      </div>
      <p className="window-hint">Buscamos el día de salida más barato de tu ventana con los precios vistos en Aviasales.</p>
    </div>
  );
}
