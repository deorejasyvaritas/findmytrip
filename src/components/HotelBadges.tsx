import { useState, type FormEvent, type ReactNode } from "react";
import type { MealPlan, Party, RealHotel } from "../../shared/types.ts";
import { hotelBadges, priceIncludesPlan } from "../../shared/hotel-badges.ts";
import { bookingSearchUrl } from "../../shared/links.ts";
import { MEAL_PLAN_LABEL, MEAL_PLANS } from "../../shared/meal-plan.ts";
import { headcount, partyToParams, roomsForParty } from "../../shared/pricing.ts";
import { api } from "../lib/api.ts";
import Icon from "./Icon.tsx";

/** Insignias del hotel (all inclusive, desayuno, playa, check-in), sin prometer más de lo que dice la fuente. */
export function HotelBadges({ h, mealPlan = "room" }: { h: RealHotel; mealPlan?: MealPlan }) {
  const badges = hotelBadges(h, mealPlan);
  if (!badges.length) return null;
  return (
    <span className="hotel-badges">
      {badges.map((b) => (
        <span key={b.label} className={`badge ${b.tone === "ok" ? "badge-ok" : b.tone === "warn" ? "badge-warn" : "badge-tint"}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Link para ver el precio con el régimen pedido en Booking (búsqueda por nombre
 * del hotel, mismas fechas y grupo, con el filtro de régimen). Solo cuando el
 * precio mostrado no lo incluye seguro.
 */
export function MealPlanPriceLink({
  h,
  city,
  checkin,
  checkout,
  party,
  mealPlan,
}: {
  h: RealHotel;
  city: string;
  checkin: string;
  checkout: string;
  party: Party;
  mealPlan: MealPlan;
}) {
  if (mealPlan === "room" || priceIncludesPlan(h, mealPlan)) return null;
  if (mealPlan === "all" && !h.allInclusive) return null;
  const url = bookingSearchUrl(`${h.name}, ${city}`, checkin, checkout, party, roomsForParty(party), mealPlan);
  return (
    <a className="small row gap-sm" href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      Ver precio {MEAL_PLAN_LABEL[mealPlan].toLowerCase()} en Booking <Icon name="external" size={12} />
    </a>
  );
}

/** "3 personas en 1 habitación · check-in desde 14:00", como en los sitios de reserva. */
export function RoomsLine({ label, checkIn }: { label?: string | null; checkIn?: string | null }) {
  const parts = [label, checkIn ? `check-in desde ${checkIn}` : null].filter(Boolean);
  if (!parts.length) return null;
  return <span className="small muted">{parts.join(" · ")}</span>;
}

/** Régimen de comidas (para buscar y en los selectores de hotel). */
export function MealPlanSelect({ value, onChange, className = "inline" }: { value: MealPlan; onChange: (m: MealPlan) => void; className?: string }) {
  return (
    <select className={className} aria-label="Régimen" value={value} onChange={(e) => onChange(e.target.value as MealPlan)}>
      {MEAL_PLANS.map((m) => (
        <option key={m} value={m}>
          {MEAL_PLAN_LABEL[m]}
        </option>
      ))}
    </select>
  );
}

/** "Frente al mar": prefiere hoteles con acceso a la playa (o la playa en el nombre). */
export function BeachToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`chip ${value ? "on" : ""}`} aria-pressed={value} onClick={() => onChange(!value)}>
      <Icon name="waves" size={14} />
      Frente al mar
    </button>
  );
}

/** Controles de los selectores de hotel: régimen y frente al mar. */
export function HotelFilters({
  mealPlan,
  onMealPlan,
  beachfront,
  onBeachfront,
}: {
  mealPlan: MealPlan;
  onMealPlan: (m: MealPlan) => void;
  beachfront: boolean;
  onBeachfront: (v: boolean) => void;
}) {
  return (
    <div className="hotel-filters">
      <MealPlanSelect value={mealPlan} onChange={onMealPlan} />
      <BeachToggle value={beachfront} onChange={onBeachfront} />
    </div>
  );
}

/** Aviso honesto según el régimen pedido. */
export function MealPlanNote({ mealPlan }: { mealPlan: MealPlan }) {
  if (mealPlan === "room") return null;
  return (
    <p className="small muted">
      {mealPlan === "all"
        ? "Primero los resorts all inclusive. El precio real es la tarifa más barata que vimos: si dice \"Ofrece all inclusive\", puede ser solo alojamiento. Confirmá el precio all inclusive en el link de cada hotel."
        : mealPlan === "breakfast"
          ? "Primero los que tienen desayuno. \"Desayuno incluido\" solo cuando la fuente lo dice; si no, confirmalo en la tarifa."
          : "Media pensión: la confirmás en la tarifa de cada hotel; los precios que mostramos pueden ser solo alojamiento."}
    </p>
  );
}

type FindResult = Awaited<ReturnType<typeof api.findHotel>>;

/**
 * "Buscar un hotel" por nombre (ej. "Brisa", "Ecoporto"): precio real para las
 * fechas y el grupo. Solo busca al enviar (en Google gasta cuota).
 */
export function HotelFinder({
  place,
  country,
  lat,
  lon,
  checkin,
  nights,
  party,
  mealPlan,
  renderHotel,
}: {
  place: string;
  country: string;
  lat: number;
  lon: number;
  checkin: string;
  nights: number;
  party: Party;
  mealPlan: MealPlan;
  renderHotel: (h: RealHotel, r: FindResult) => ReactNode;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FindResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = q.trim();
    if (name.length < 3) {
      setError("Escribí al menos 3 letras del nombre.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.findHotel({ q: name, place, country, lat, lon, checkin, nights, travelers: headcount(party), meal: mealPlan, ...partyToParams(party) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hotel-finder stack-sm">
      <form className="hotel-finder-form" onSubmit={submit} role="search">
        <Icon name="search" size={16} />
        <input
          aria-label="Buscar un hotel por nombre"
          placeholder="Buscar un hotel (ej. Brisa)"
          value={q}
          maxLength={60}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="secondary" disabled={busy}>
          {busy ? "Buscando…" : "Buscar"}
        </button>
      </form>
      {error && (
        <p className="form-error small" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="stack-sm" role="status">
          {result.hotels.length ? (
            <>
              <p className="small muted">
                {result.source === "google" ? "Precio de Google Hotels" : "El mejor precio entre Booking, Agoda, Expedia y más"} para tus fechas ·{" "}
                {result.roomsLabel}
              </p>
              <div className="hotel-results">{result.hotels.map((h) => renderHotel(h, result))}</div>
            </>
          ) : (
            <p className="small muted">
              No encontramos "{q.trim()}" con precio para esas fechas
              {result.searchedGoogle ? "" : " en la lista de la zona"}. Probá buscarlo directo:
            </p>
          )}
          <div className="results-foot">
            {result.links.map((l) => (
              <a key={l.label} className="pill-link" href={l.url} target="_blank" rel="noreferrer">
                {l.label} <Icon name="external" size={14} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
