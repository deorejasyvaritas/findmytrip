import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { chartGeometry, historySentence, nearestIndex, summarizeHistory, type PricePoint } from "../../shared/price-history.ts";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { formatDate } from "../lib/format.ts";
import Icon from "./Icon.tsx";

// "Precio en las últimas semanas": lo que vio el radar para esta ruta.
// Gráfico en SVG puro; los puntos y textos van en HTML para que no se deformen.

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function PriceHistory({ destinationId }: { destinationId: string }) {
  const { profile, meta, money } = useApp();
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!meta?.liveFlights) return;
    let alive = true;
    setPoints(null);
    setFailed(false);
    api
      .radarHistory(profile.origin, destinationId)
      .then((r) => {
        if (alive) setPoints(r.points);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [meta?.liveFlights, profile.origin, destinationId]);

  const summary = useMemo(() => (points ? summarizeHistory(points) : null), [points]);
  const geo = useMemo(() => (summary ? chartGeometry(summary) : null), [summary]);

  // Sin radar (no hay token) o con error: no mostramos nada.
  if (!meta?.liveFlights || failed) return null;
  const originName = meta.origins.find((o) => o.code === profile.origin)?.name ?? profile.origin;

  const head = (
    <div className="section-head">
      <h2 id="ph-title">Precio en las últimas semanas</h2>
      <span className="small muted">Vuelo ida y vuelta por persona desde {originName}, según el radar</span>
    </div>
  );

  if (!points) {
    return (
      <section aria-labelledby="ph-title">
        {head}
        <div className="card skeleton" aria-busy="true" aria-label="Cargando el historial de precios">
          <div className="sk" style={{ width: "60%", height: 16 }} />
          <div className="sk" style={{ width: "100%", height: 120 }} />
        </div>
      </section>
    );
  }

  if (!summary || !geo) {
    return (
      <section aria-labelledby="ph-title">
        {head}
        <div className="card ph-empty">
          <Icon name="radar" size={24} />
          <p className="small">
            Todavía estamos juntando precios para esta ruta. El radar la revisa 5 veces por día: en unos días vas a ver cómo se mueve.
          </p>
        </div>
      </section>
    );
  }

  const s = summary;
  const first = s.points[0].t;
  const last = s.points[s.points.length - 1].t;
  const sentence = historySentence(s);
  const verdict = s.verdict === "below" ? { cls: "ph-below", icon: "trendDown" as const } : s.verdict === "above" ? { cls: "ph-above", icon: "trendUp" as const } : null;
  const shown = active ?? s.points.length - 1;
  const tip = geo.xy[shown];

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    setActive(nearestIndex(geo!.xy, ((e.clientX - box.left) / box.width) * 100));
  }

  const summaryText = `Precio de ${s.points.length} observaciones entre el ${formatDate(first, { day: "numeric", month: "long" })} y el ${formatDate(last, { day: "numeric", month: "long" })}: mínimo ${money(s.min)}, habitual ${money(s.typical)}, hoy ${money(s.current)}. ${sentence}`;

  return (
    <section aria-labelledby="ph-title">
      {head}
      <div className="card ph-card">
        <p className={`ph-sentence ${verdict?.cls ?? ""}`}>
          {verdict && <Icon name={verdict.icon} size={18} />}
          {sentence}
        </p>

        <figure className="ph-figure" role="img" aria-label={summaryText}>
          <div
            className="ph-plot"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setActive(null)}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="ph-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--brand)" stopOpacity="0.18" />
                  <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={geo.area} fill="url(#ph-fill)" />
              <line className="ph-typical" x1="0" x2="100" y1={geo.typicalY} y2={geo.typicalY} vectorEffect="non-scaling-stroke" />
              <path className="ph-line" d={geo.line} fill="none" vectorEffect="non-scaling-stroke" />
              {active != null && (
                <line className="ph-cross" x1={tip.x} x2={tip.x} y1="0" y2="100" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            <span className="ph-typical-label" style={{ top: `${geo.typicalY}%` }}>
              habitual
            </span>
            <span className="ph-dot ph-min" style={{ left: `${geo.xy[s.minIndex].x}%`, top: `${geo.xy[s.minIndex].y}%` }} />
            <span className="ph-dot ph-now" style={{ left: `${geo.xy[geo.xy.length - 1].x}%`, top: `${geo.xy[geo.xy.length - 1].y}%` }} />
            {active != null && <span className="ph-dot ph-active" style={{ left: `${tip.x}%`, top: `${tip.y}%` }} />}
            <span
              className={`ph-tip ${tip.x > 60 ? "left" : ""}`}
              style={{ left: `${tip.x}%`, top: `${tip.y}%` }}
              aria-hidden="true"
            >
              <strong>{money(s.points[shown].p)}</strong>
              <span>{active == null ? "Hoy" : when(s.points[shown].t)}</span>
            </span>
          </div>
          <figcaption className="ph-axis small muted">
            <span>{formatDate(first)}</span>
            <span>{formatDate(last)}</span>
          </figcaption>
        </figure>

        <dl className="ph-stats">
          <div>
            <dt>
              <span className="ph-key ph-key-min" aria-hidden="true" /> Mínimo
            </dt>
            <dd>{money(s.min)}</dd>
          </div>
          <div>
            <dt>
              <span className="ph-key ph-key-typical" aria-hidden="true" /> Habitual
            </dt>
            <dd>{money(s.typical)}</dd>
          </div>
          <div>
            <dt>
              <span className="ph-key ph-key-now" aria-hidden="true" /> Hoy
            </dt>
            <dd>{money(s.current)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
