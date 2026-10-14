import { useEffect, useState } from "react";
import type { RadarSnapshot } from "../../shared/types.ts";
import { api } from "./api.ts";

// Una sola consulta al radar por ciudad de salida: la usan el banner y la
// sección de ofertas del inicio.
const cache = new Map<string, Promise<RadarSnapshot>>();

export function loadRadar(origin: string): Promise<RadarSnapshot> {
  let p = cache.get(origin);
  if (!p) {
    p = api.radar(origin);
    cache.set(origin, p);
    // Si falla, la próxima visita vuelve a intentar.
    p.catch(() => cache.delete(origin));
  }
  return p;
}

/** Guarda una foto nueva (por ejemplo, después de "Actualizar"). */
export function rememberRadar(origin: string, snap: RadarSnapshot): void {
  cache.set(origin, Promise.resolve(snap));
}

export type RadarState = "off" | "loading" | "ready" | "error";

export function useRadar(origin: string, enabled: boolean): { snap: RadarSnapshot | null; state: RadarState } {
  const [res, setRes] = useState<{ key: string; snap: RadarSnapshot | null; state: RadarState }>({ key: "", snap: null, state: "loading" });
  const key = enabled ? origin : "";

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadRadar(origin)
      .then((snap) => alive && setRes({ key: origin, snap, state: "ready" }))
      .catch(() => alive && setRes({ key: origin, snap: null, state: "error" }));
    return () => {
      alive = false;
    };
  }, [origin, enabled]);

  if (!enabled) return { snap: null, state: "off" };
  return res.key === key ? { snap: res.snap, state: res.state } : { snap: null, state: "loading" };
}
