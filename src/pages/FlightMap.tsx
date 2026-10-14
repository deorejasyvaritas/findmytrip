import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RadarItem, RadarSnapshot, Region } from "../../shared/types.ts";
import { withRadarScore } from "../../shared/radar-score.ts";
import { MAX_PRICES, itemsForMonth, monthLabel } from "../components/RadarSection.tsx";
import Icon from "../components/Icon.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../lib/app-context.tsx";
import { formatRange, timeAgo } from "../lib/format.ts";

// Mapa de vuelos baratos: los precios del radar desde tu ciudad, sobre un mapa.
// Mapa base: OpenStreetMap estándar (gratis, con atribución y uso liviano, según
// su política de teselas). En modo oscuro se invierte con un filtro de CSS.
// Se carga aparte (React.lazy) para no agrandar la app principal.

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">colaboradores de OpenStreetMap</a>';

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export default function FlightMapPage() {
  const { profile, meta, money, destinations } = useApp();
  const [snap, setSnap] = useState<RadarSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [month, setMonth] = useState("");
  const [region, setRegion] = useState<Region | "">("");
  const [maxPrice, setMaxPrice] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  const byId = useMemo(() => new Map(destinations.map((d) => [d.id, d])), [destinations]);
  const origin = meta?.origins.find((o) => o.code === profile.origin);
  const months = useMemo(
    () => [...new Set(Object.values(snap?.byMonth ?? {}).flatMap((m) => Object.keys(m)))].sort(),
    [snap],
  );

  useEffect(() => {
    if (!meta?.liveFlights) return;
    let alive = true;
    setState("loading");
    api
      .radar(profile.origin)
      .then((s) => {
        if (!alive) return;
        setSnap(s);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [meta?.liveFlights, profile.origin]);

  // Lo que se ve: mes elegido (o el mejor precio de cada destino), región y tope.
  const items = useMemo(() => {
    if (!snap) return [];
    const base = month ? itemsForMonth(snap, month) : snap.items.map(withRadarScore);
    return base
      .filter((i) => byId.has(i.destinationId))
      .filter((i) => (!region || byId.get(i.destinationId)?.region === region) && (!maxPrice || i.priceUSD <= maxPrice))
      .sort((a, b) => a.priceUSD - b.priceUSD);
  }, [snap, month, region, maxPrice, byId]);
  const sel = items.find((i) => i.destinationId === selected) ?? null;

  /** Desde la lista: elegir el destino y llevar el mapa hasta él. */
  function showOnMap(id: string) {
    setSelected(id);
    const d = byId.get(id);
    const map = mapRef.current;
    if (!d || !map) return;
    if (!map.getBounds().contains([d.lat, d.lon])) map.panTo([d.lat, d.lon], { animate: !reducedMotion() });
    mapEl.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  }
  const filtering = Boolean(month || region || maxPrice);

  // Crear el mapa una sola vez (y destruirlo al salir).
  useEffect(() => {
    const el = mapEl.current;
    if (!el || state !== "ready") return;
    const map = L.map(el, {
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 10,
      zoomControl: true,
      zoomAnimation: !reducedMotion(),
      fadeAnimation: !reducedMotion(),
      markerZoomAnimation: !reducedMotion(),
      attributionControl: true,
    }).setView([origin?.lat ?? -34.6, origin?.lon ?? -58.38], 3);
    map.attributionControl.setPrefix(false);
    map.on("click", () => setSelected(null));

    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [state]); // el origen solo centra la vista inicial; después manda el encuadre de los pines

  // Pines con el precio. Los más baratos quedan arriba si se superponen.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (origin) {
      const home = L.marker([origin.lat, origin.lon], {
        icon: L.divIcon({ className: "map-origin", html: `<span>${escapeHtml(origin.name)}</span>`, iconSize: undefined }),
        keyboard: false,
        interactive: false,
        zIndexOffset: 2000,
      });
      layer.addLayer(home);
    }
    const placed: { marker: L.Marker; text: string; on: boolean }[] = [];
    items.forEach((item) => {
      const d = byId.get(item.destinationId);
      if (!d) return;
      const label = `${d.name}: ${money(item.priceUSD)}${item.discountPct >= 5 ? `, ${item.discountPct} % más barato que lo habitual` : ""}`;
      const marker = L.marker([d.lat, d.lon], {
        icon: L.divIcon({
          className: "map-pin-wrap",
          html: `<span class="map-pin${item.isDeal ? " deal" : ""}${item.destinationId === selected ? " on" : ""}">${escapeHtml(money(item.priceUSD))}</span>`,
          iconSize: undefined,
        }),
        title: label,
        alt: label,
        riseOnHover: true,
      });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setSelected(item.destinationId);
      });
      layer.addLayer(marker);
      placed.push({ marker, text: money(item.priceUSD), on: item.destinationId === selected });
    });

    // Si dos pastillas se pisan, la más cara queda como punto (se toca igual).
    // El elegido y los más baratos tienen prioridad.
    const declutter = () => {
      const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const order = [...placed.filter((p) => p.on), ...placed.filter((p) => !p.on)];
      order.forEach((p, i) => {
        const pt = map.latLngToContainerPoint(p.marker.getLatLng());
        const w = 24 + p.text.length * 8;
        const box = { x1: pt.x - w / 2 - 2, y1: pt.y - 16, x2: pt.x + w / 2 + 2, y2: pt.y + 16 };
        const hit = boxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1);
        if (!hit) boxes.push(box);
        p.marker.getElement()?.querySelector(".map-pin")?.classList.toggle("dot", hit);
        // Leaflet ordena por altura en pantalla: el ajuste tiene que ganarle a eso.
        p.marker.setZIndexOffset(hit ? 0 : 200000 - i * 1000);
      });
    };
    declutter();
    map.on("zoomend resize", declutter);
    return () => {
      map.off("zoomend resize", declutter);
    };
  }, [items, selected, money, byId, origin?.code, state]);

  // Encuadre: cada vez que cambian los filtros, que entren todos los pines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngTuple[] = items.map((i) => byId.get(i.destinationId)).filter((d) => d != null).map((d) => [d.lat, d.lon]);
    if (origin) pts.push([origin.lat, origin.lon]);
    if (pts.length < 2) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 6, animate: !reducedMotion() });
  }, [items, state]);

  // Escape cierra la ficha.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [sel]);

  const head = (
    <div className="map-head">
      <Link to="/" className="back">
        <Icon name="chevronLeft" size={20} /> Explorar
      </Link>
      <h1>Mapa de vuelos baratos</h1>
      <p className="small muted">
        {origin ? `Ida y vuelta por persona desde ${origin.name}` : "Ida y vuelta por persona"}
        {snap ? ` · actualizado ${timeAgo(snap.updatedAt)}` : ""}
      </p>
    </div>
  );

  if (meta && !meta.liveFlights) {
    return (
      <div className="stack-lg">
        {head}
        <div className="card empty">
          <Icon name="radar" size={28} />
          <p className="muted">El mapa usa los precios del radar, que todavía no está activado en este sitio.</p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="stack-lg">
        {head}
        <div className="card empty" role="alert">
          <Icon name="info" size={28} />
          <p className="muted">No pudimos traer los precios del radar. Probá de nuevo en un rato.</p>
          <button className="secondary" onClick={() => location.reload()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="map-page">
      {head}

      <div className="radar-filters" role="group" aria-label="Filtrar el mapa">
        <select className="inline" aria-label="Mes" value={month} onChange={(e) => setMonth(e.target.value)} disabled={!snap}>
          <option value="">Cualquier mes</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select className="inline" aria-label="Precio máximo por persona" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} disabled={!snap}>
          <option value={0}>Sin tope de precio</option>
          {MAX_PRICES.map((p) => (
            <option key={p} value={p}>
              Hasta {money(p)}
            </option>
          ))}
        </select>
        <select className="inline" aria-label="Región" value={region} onChange={(e) => setRegion(e.target.value as Region | "")} disabled={!snap}>
          <option value="">Cualquier región</option>
          {meta?.regions.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        {filtering && (
          <button className="plain" onClick={() => (setMonth(""), setRegion(""), setMaxPrice(0))}>
            Limpiar
          </button>
        )}
      </div>

      <div className="map-wrap">
        {state === "loading" ? (
          <div className="map-canvas map-loading" aria-busy="true" aria-label="Cargando el mapa" />
        ) : (
          <div ref={mapEl} className="map-canvas" role="region" aria-label="Mapa con el precio de cada destino" />
        )}

        {state === "ready" && items.length === 0 && (
          <div className="map-empty" role="status">
            <p>{snap?.items.length ? "No hay vuelos con esos filtros." : "El radar todavía no encontró precios desde tu ciudad."}</p>
            {filtering && (
              <button className="secondary" onClick={() => (setMonth(""), setRegion(""), setMaxPrice(0))}>
                Quitar filtros
              </button>
            )}
          </div>
        )}

        {sel && <PinSheet item={sel} month={month} money={money} name={byId.get(sel.destinationId)?.name ?? sel.name} country={byId.get(sel.destinationId)?.country} onClose={() => setSelected(null)} />}
      </div>

      <p className="small muted map-legend">
        <span className="map-pin deal static" aria-hidden="true">USD</span> Oferta: bastante por debajo de lo habitual
        <span className="map-pin static" aria-hidden="true">USD</span> Precio del radar
      </p>

      {items.length > 0 && (
        <section aria-labelledby="map-list-title">
          <h2 id="map-list-title" className="grouped-title">
            Los más baratos
          </h2>
          <ul className="grouped map-list">
            {items.slice(0, 8).map((i) => (
              <li key={i.destinationId}>
                <button type="button" onClick={() => showOnMap(i.destinationId)} aria-label={`Ver ${i.name} en el mapa`}>
                  <span className="grow">
                    <strong>{byId.get(i.destinationId)?.name ?? i.name}</strong>
                    <span className="small muted">{i.depart && i.ret ? formatRange(i.depart, i.ret) : byId.get(i.destinationId)?.country}</span>
                  </span>
                  <span className="map-list-price">{money(i.priceUSD)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PinSheet({
  item,
  name,
  country,
  month,
  money,
  onClose,
}: {
  item: RadarItem;
  name: string;
  country?: string;
  month: string;
  money: (usd: number) => string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [item.destinationId]);
  const depMonth = month || item.depart?.slice(0, 7) || "";
  const to = `/destino/${item.destinationId}${depMonth ? `?month=${depMonth}` : ""}`;
  return (
    <div className="map-sheet" role="dialog" aria-label={`${name}, ${money(item.priceUSD)}`}>
      <div className="map-sheet-head">
        <div>
          <h3>{name}</h3>
          {country && <p className="small muted">{country}</p>}
        </div>
        <button ref={closeRef} type="button" className="icon-button map-sheet-close" aria-label="Cerrar" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="map-sheet-price">
        <strong>{money(item.priceUSD)}</strong>
        <span className="small muted">ida y vuelta por persona</span>
      </div>
      <div className="row gap-sm map-sheet-badges">
        {item.discountPct >= 5 && (
          <span className={`badge ${item.isDeal ? "badge-brand" : "badge-ok"}`}>
            <Icon name="trendDown" size={14} /> {item.discountPct} % menos que lo habitual
          </span>
        )}
        {item.isMinimum && <span className="badge badge-ok">Mínimo del radar</span>}
        {item.tier && <span className="badge badge-tint">{item.tier}</span>}
      </div>
      {item.depart && item.ret && (
        <p className="small">
          <Icon name="calendar" size={14} /> {formatRange(item.depart, item.ret)}
        </p>
      )}
      <Link to={to} className="button primary map-sheet-cta">
        Ver destino <Icon name="chevronRight" size={18} />
      </Link>
    </div>
  );
}
