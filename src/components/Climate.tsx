import { useEffect, useState } from "react";
import { climateSummary, rainText, roundCoord, type ClimateMonth, type ClimateTone } from "../../shared/climate.ts";
import { api } from "../lib/api.ts";
import { capitalize, monthName, monthShort } from "../lib/format.ts";
import type { IconName } from "../lib/icons.ts";
import Icon from "./Icon.tsx";

// Clima esperado por mes (promedio de los últimos años, Open-Meteo).

const TONE_ICON: Record<ClimateTone, IconName> = {
  snow: "snowflake",
  cold: "thermometer",
  rain: "cloudRain",
  hot: "sun",
  beach: "sun",
  warm: "sun",
  mild: "thermometer",
  cool: "thermometer",
};

// Caché en memoria de la app: varias paradas o destinos cercanos piden lo mismo una sola vez.
const pending = new Map<string, Promise<ClimateMonth[]>>();

function loadClimate(lat: number, lon: number): Promise<ClimateMonth[]> {
  const key = `${roundCoord(lat)},${roundCoord(lon)}`;
  let p = pending.get(key);
  if (!p) {
    p = api.climate(lat, lon).then((r) => r.months);
    p.catch(() => {
      pending.delete(key);
    });
    pending.set(key, p);
  }
  return p;
}

function useClimate(lat: number, lon: number) {
  const [state, setState] = useState<{ months: ClimateMonth[] | null; error: boolean }>({ months: null, error: false });
  useEffect(() => {
    let cancelled = false;
    setState({ months: null, error: false });
    loadClimate(lat, lon)
      .then((months) => {
        if (!cancelled) setState({ months, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ months: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);
  return state;
}

const deg = (n: number) => `${n}°`;

/**
 * Bloque de la ficha de destino: tira de 12 meses alineada con las barras de
 * "Cuándo conviene ir" y el resumen del mes elegido.
 */
export function ClimateBlock({ lat, lon, order, month }: { lat: number; lon: number; order: number[]; month: number | null }) {
  const { months, error } = useClimate(lat, lon);

  if (error) return <p className="small muted climate-error">No pudimos cargar el clima de este destino.</p>;
  if (!months)
    return (
      <div className="climate skeleton" aria-busy="true" aria-label="Cargando el clima">
        <div className="sk" style={{ width: "100%", height: 44 }} />
        <div className="sk" style={{ width: "70%", height: 14 }} />
      </div>
    );

  const byMonth = new Map(months.map((c) => [c.m, c]));
  const maxRain = Math.max(...months.map((c) => c.rainMm), 1);
  const current = month ? byMonth.get(month) : undefined;
  const summary = current ? climateSummary(current) : null;

  return (
    <div className="climate">
      <div className="climate-strip" role="list" aria-label="Clima promedio por mes">
        {order.map((m, i) => {
          const c = byMonth.get(m);
          if (!c) return <span key={i} role="listitem" />;
          return (
            <span
              key={i}
              role="listitem"
              className={`climate-cell ${m === month ? "on" : ""}`}
              aria-label={`${capitalize(monthName(m))}: máxima ${c.tmax}°, mínima ${c.tmin}°, ${rainText(c).toLowerCase()}`}
            >
              <span className="hi">{deg(c.tmax)}</span>
              <span className="lo">{deg(c.tmin)}</span>
              <span className="rain" style={{ height: `${Math.max(2, Math.round((c.rainMm / maxRain) * 16))}px` }} />
            </span>
          );
        })}
      </div>
      {current && summary && month && (
        <div className="climate-now">
          <span className={`climate-icon ${summary.tone}`} aria-hidden="true">
            <Icon name={TONE_ICON[summary.tone]} size={20} />
          </span>
          <span className="grow">
            <strong>
              Clima en {monthName(month)}: {summary.label.toLowerCase()}
            </strong>
            <span className="small muted">
              Máx. {deg(current.tmax)} · mín. {deg(current.tmin)} · {rainText(current).toLowerCase()}
            </span>
          </span>
        </div>
      )}
      <p className="small muted">Temperaturas máximas y mínimas promedio; la barra es la lluvia del mes. Historial de los últimos 4 años (Open-Meteo).</p>
    </div>
  );
}

/** Una línea para las paradas del viaje: el clima del mes en que llegás. */
export function ClimateLine({ lat, lon, date }: { lat: number; lon: number; date: string }) {
  const { months, error } = useClimate(lat, lon);
  const m = Number(date.slice(5, 7));
  if (error) return null;
  if (!months) return <div className="sk" style={{ width: "60%", height: 14 }} aria-hidden="true" />;
  const c = months.find((x) => x.m === m);
  if (!c) return null;
  const s = climateSummary(c);
  return (
    <p className="small info-line">
      <Icon name={TONE_ICON[s.tone]} size={16} />
      <span>
        <strong>
          {capitalize(monthShort(m))}: {s.label.toLowerCase()}
        </strong>
        <span className="muted">
          {" "}
          · {deg(c.tmax)} / {deg(c.tmin)} · {rainText(c).toLowerCase()}
        </span>
      </span>
    </p>
  );
}
