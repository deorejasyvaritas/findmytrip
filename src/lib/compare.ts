import { useSyncExternalStore } from "react";
import { load, save } from "./storage.ts";

// Destinos elegidos para comparar (hasta 3). Un solo estado para toda la app:
// las tarjetas, el catálogo y la barra de abajo se enteran a la vez.

export const COMPARE_MAX = 3;
const KEY = "fmt.compare";

let ids: string[] = (() => {
  const v = load<unknown>(KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, COMPARE_MAX) : [];
})();
const listeners = new Set<() => void>();

function set(next: string[]) {
  ids = next;
  save(KEY, ids);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useCompare() {
  const list = useSyncExternalStore(subscribe, () => ids, () => ids);
  return {
    ids: list,
    full: list.length >= COMPARE_MAX,
    has: (id: string) => list.includes(id),
    // Siempre sobre el valor actual (no el del render): se puede llamar varias veces seguidas.
    toggle: (id: string) => set(ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= COMPARE_MAX ? ids : [...ids, id]),
    remove: (id: string) => set(ids.filter((x) => x !== id)),
    clear: () => set([]),
  };
}
