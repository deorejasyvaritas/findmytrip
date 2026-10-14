import type { MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/app-context.tsx";
import { COMPARE_MAX, useCompare } from "../lib/compare.ts";
import Icon from "./Icon.tsx";

/** Botón "Comparar" de una tarjeta o del catálogo (hasta 3 destinos). */
export function CompareToggle({ id, name, iconOnly = false }: { id: string; name: string; iconOnly?: boolean }) {
  const c = useCompare();
  const on = c.has(id);
  const blocked = !on && c.full;
  function onClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!blocked) c.toggle(id);
  }
  return (
    <button
      type="button"
      className={`${iconOnly ? "compare-icon" : "mini-action"} ${on ? "on" : ""}`}
      aria-pressed={on}
      aria-disabled={blocked || undefined}
      aria-label={blocked ? `Comparar ${name} (ya elegiste ${COMPARE_MAX})` : `Comparar ${name}`}
      title={blocked ? `Podés comparar hasta ${COMPARE_MAX} destinos` : undefined}
      onClick={onClick}
    >
      <Icon name={on ? "check" : "plus"} size={16} />
      {!iconOnly && "Comparar"}
    </button>
  );
}

/** Barra fija con los destinos elegidos para comparar. */
export function CompareBar() {
  const c = useCompare();
  const { destinations } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  if (!c.ids.length || location.pathname === "/comparar") return null;
  const names = c.ids.map((id) => destinations.find((d) => d.id === id)?.name ?? id);
  const hint = c.ids.length < 2 ? "Elegí otro destino para comparar" : c.full ? `Máximo ${COMPARE_MAX} destinos` : "Podés sumar uno más";
  return (
    <>
      <div className="compare-spacer" aria-hidden="true" />
      <section className="compare-bar" aria-label="Destinos para comparar">
        <div className="compare-bar-inner">
          <div className="compare-bar-text">
            <strong>{names.join(" · ")}</strong>
            <span className="small muted">{hint}</span>
          </div>
          <button type="button" className="ghost" onClick={c.clear}>
            Limpiar
          </button>
          <button type="button" className="primary" disabled={c.ids.length < 2} onClick={() => navigate(`/comparar?ids=${c.ids.join(",")}`)}>
            Comparar ({c.ids.length})
          </button>
        </div>
      </section>
    </>
  );
}
