import { useEffect, useMemo, useState } from "react";
import type { RadarItem, RadarSnapshot, RadarTier, Region } from "../../shared/types.ts";
import { withRadarScore } from "../../shared/radar-score.ts";
import { airlineName } from "../../shared/airlines.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { capitalize, formatRange, timeAgo } from "../lib/format.ts";
import Icon from "./Icon.tsx";
import PurchaseModal, { type PurchaseTarget } from "./PurchaseModal.tsx";
import Segmented from "./Segmented.tsx";
import { Photo } from "./SuggestionCard.tsx";

export const MAX_PRICES = [300, 500, 800, 1200, 2000];

export const monthLabel = (key: string) =>
  capitalize(new Date(`${key}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" }));

/** Ofertas de un mes puntual, armadas con el mejor precio de cada destino en ese mes. */
export function itemsForMonth(snap: RadarSnapshot, month: string): RadarItem[] {
  const out: RadarItem[] = [];
  for (const item of snap.items) {
    const m = snap.byMonth[item.destinationId]?.[month];
    if (!m) continue;
    // Precio habitual de ese mismo mes y estadía (fotos viejas: el general).
    const typicalUSD = m.t ?? item.typicalUSD;
    const discountPct = Math.max(0, Math.round((1 - m.p / typicalUSD) * 100));
    const isMinimum = item.isMinimum && m.p <= item.priceUSD;
    out.push(withRadarScore({
      ...item,
      priceUSD: m.p,
      depart: m.dep,
      ret: m.ret,
      airline: m.al,
      flightNumber: m.p === item.priceUSD ? item.flightNumber : undefined,
      typicalUSD,
      baseline: m.b ?? item.baseline,
      discountPct,
      isMinimum,
      isDeal: discountPct >= 15 || isMinimum,
      trend: m.p === item.priceUSD ? item.trend : "same",
      score: discountPct + (isMinimum ? 10 : 0),
    }));
  }
  return out.sort((a, b) => b.score - a.score || a.priceUSD - b.priceUSD);
}

// Etiqueta pública según el puntaje: lo mejor en rosa de marca.
const TIER_CLS: Record<RadarTier, string> = {
  "Ofertón": "badge-brand",
  Excelente: "badge-ok",
  "Muy buena": "badge-ok",
  Buena: "badge-tint",
};

const TREND = {
  down: { icon: "trendDown" as const, label: "Bajó", cls: "success" },
  up: { icon: "trendUp" as const, label: "Subió", cls: "warn-text" },
  same: null,
  new: null,
};

export default function RadarSection() {
  const { profile, meta, money, photos, destinations } = useApp();
  const [snap, setSnap] = useState<RadarSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [view, setView] = useState<"deals" | "all">("deals");
  const [showMore, setShowMore] = useState(false);
  const [buying, setBuying] = useState<PurchaseTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState("");
  const [region, setRegion] = useState<Region | "">("");
  const [maxPrice, setMaxPrice] = useState(0);
  const regionOf = useMemo(() => new Map(destinations.map((d) => [d.id, d.region])), [destinations]);
  const months = useMemo(
    () => [...new Set(Object.values(snap?.byMonth ?? {}).flatMap((m) => Object.keys(m)))].sort(),
    [snap],
  );

  useEffect(() => {
    if (!meta?.liveFlights) return;
    setState("loading");
    api
      .radar(profile.origin)
      .then((s) => {
        setSnap(s);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [meta?.liveFlights, profile.origin]);

  if (!meta?.liveFlights || state === "error") return null;
  const originName = meta.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;

  async function refresh() {
    setRefreshing(true);
    try {
      setSnap(await api.radarRun(profile.origin));
    } finally {
      setRefreshing(false);
    }
  }

  // Las fotos guardadas antes del puntaje no lo traen: se calcula acá.
  const base = snap ? (month ? itemsForMonth(snap, month) : snap.items.map(withRadarScore)) : [];
  const filtered = base.filter(
    (i) => (!region || regionOf.get(i.destinationId) === region) && (!maxPrice || i.priceUSD <= maxPrice),
  );
  const deals = filtered.filter((i) => i.isDeal);
  const list = view === "deals" && deals.length ? deals : filtered;
  const visible = list.slice(0, showMore ? 24 : 6);
  const filtering = Boolean(month || region || maxPrice);

  return (
    <section className="radar" aria-labelledby="radar-title">
      <div className="radar-head">
        <div>
          <p className="eyebrow radar-live">
            <i aria-hidden="true" /> Radar activo
          </p>
          <h2 id="radar-title">Ofertas del radar desde {originName}</h2>
          <p className="small muted">
            {snap
              ? `Actualizado ${timeAgo(snap.updatedAt)} · ${snap.routes} rutas monitoreadas · revisa precios 5 veces por día`
              : "Buscando oportunidades…"}
          </p>
        </div>
        {snap && (
          <button className="plain" onClick={refresh} disabled={refreshing}>
            <Icon name="refresh" size={16} />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </button>
        )}
      </div>

      {snap && (
        <div className="radar-stats" role="list">
          <Stat icon="tag" value={snap.stats.deals} label="Ofertas" />
          <Stat icon="trendDown" value={snap.stats.down} label="Bajaron" />
          <Stat icon="trendUp" value={snap.stats.up} label="Subieron" />
          <Stat icon="star" value={snap.stats.minimums} label="Mínimos" />
        </div>
      )}

      {snap && snap.items.length > 0 && (
        <div className="radar-filters" role="group" aria-label="Filtrar ofertas">
          <select className="inline" aria-label="Mes" value={month} onChange={(e) => (setMonth(e.target.value), setShowMore(false))}>
            <option value="">Cualquier mes</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <select className="inline" aria-label="Región" value={region} onChange={(e) => (setRegion(e.target.value as Region | ""), setShowMore(false))}>
            <option value="">Cualquier región</option>
            {meta.regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select className="inline" aria-label="Precio máximo por persona" value={maxPrice} onChange={(e) => (setMaxPrice(Number(e.target.value)), setShowMore(false))}>
            <option value={0}>Sin tope de precio</option>
            {MAX_PRICES.map((p) => (
              <option key={p} value={p}>
                Hasta {money(p)} por persona
              </option>
            ))}
          </select>
          {filtering && (
            <button className="plain" onClick={() => (setMonth(""), setRegion(""), setMaxPrice(0))}>
              Limpiar
            </button>
          )}
        </div>
      )}

      {snap && deals.length > 0 && (
        <Segmented
          label="Qué mostrar"
          value={view}
          onChange={setView}
          options={[
            { value: "deals", label: `Ofertas (${deals.length})` },
            { value: "all", label: "Todos los destinos" },
          ]}
        />
      )}

      <div className="grid-cards">
        {state === "loading" &&
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="card skeleton" aria-hidden="true">
              <div className="sk photo" />
              <div className="sk" style={{ width: "50%", height: 18 }} />
              <div className="sk" style={{ width: "35%", height: 24 }} />
            </div>
          ))}
        {visible.map((item) => (
          <RadarCard key={item.destinationId} item={item} photo={photos[item.destinationId]} money={money} onBuy={setBuying} />
        ))}
      </div>
      {snap && snap.items.length > 0 && list.length === 0 && (
        <div className="card empty">
          <Icon name="radar" size={28} />
          <p className="muted">No hay precios del radar con esos filtros. Probá otro mes o subí el tope.</p>
        </div>
      )}
      {snap && snap.items.length === 0 && (
        <div className="card empty">
          <Icon name="radar" size={28} />
          <p className="muted">El radar todavía no encontró precios desde {originName}. El próximo barrido es en unas horas.</p>
        </div>
      )}
      {list.length > 6 && (
        <button className="plain" onClick={() => setShowMore((v) => !v)} aria-expanded={showMore}>
          {showMore ? "Ver menos" : `Ver ${Math.min(list.length, 24) - 6} más`}
          <Icon name="chevronDown" size={16} />
        </button>
      )}

      {buying && <PurchaseModal target={buying} onClose={() => setBuying(null)} />}
    </section>
  );
}

function Stat({ icon, value, label }: { icon: "tag" | "trendDown" | "trendUp" | "star"; value: number; label: string }) {
  return (
    <div className="radar-stat" role="listitem">
      <Icon name={icon} size={18} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RadarCard({
  item,
  photo,
  money,
  onBuy,
}: {
  item: RadarItem;
  photo?: string;
  money: (n: number) => string;
  onBuy: (t: PurchaseTarget) => void;
}) {
  const trend = TREND[item.trend];
  const canBuy = Boolean(item.depart && item.ret);
  return (
    <article className="card suggestion radar-card">
      <Photo src={photo} name={item.name} />
      <div className="suggestion-head">
        <div>
          <h3>{item.name}</h3>
          <p className="small muted">{item.depart && item.ret ? formatRange(item.depart, item.ret) : "Fechas flexibles"}</p>
        </div>
        {item.tier ? (
          <span className={`badge ${TIER_CLS[item.tier]}`} title={`Puntaje ${item.radarScore} de 100`}>
            {item.tier}
          </span>
        ) : item.isMinimum ? (
          <span className="badge badge-ok">Mínimo</span>
        ) : item.discountPct > 0 ? (
          <span className="badge badge-tint">−{item.discountPct} %</span>
        ) : null}
      </div>
      <div className="price-row">
        <div>
          <div className="price">{money(item.priceUSD)}</div>
          <div className="small muted">
            Ida y vuelta por persona · habitual{" "}
            {item.priceUSD < item.typicalUSD ? <s>{money(item.typicalUSD)}</s> : money(item.typicalUSD)}
            {item.baseline === "estimado" ? " (estimado)" : ""}
            {item.tier && item.discountPct > 0 ? ` · −${item.discountPct} %` : ""}
            {item.tier && item.isMinimum ? " · mínimo visto" : ""}
          </div>
        </div>
        {trend && (
          <span className={`small row gap-sm ${trend.cls}`}>
            <Icon name={trend.icon} size={16} />
            {trend.label}
          </span>
        )}
      </div>
      <div className="card-foot">
        <span>{[airlineName(item.airline), item.flightNumber].filter(Boolean).join(" · ") || "Varias aerolíneas"}</span>
        {canBuy && (
          <button
            className="link"
            onClick={() =>
              onBuy({
                destinationId: item.destinationId,
                name: item.name,
                iata: item.iata,
                depart: item.depart!,
                ret: item.ret!,
                priceUSD: item.priceUSD,
                typicalUSD: item.typicalUSD,
                airline: item.airline,
                flightNumber: item.flightNumber,
                seenAt: "radar",
              })
            }
          >
            Ver dónde comprar
          </button>
        )}
      </div>
    </article>
  );
}
