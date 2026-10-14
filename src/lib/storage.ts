import { useCallback, useEffect, useState } from "react";

// Todo lo personal (perfil, viajes, conversación) vive en el navegador.
// Lecturas y escrituras protegidas: en modo privado el storage puede fallar.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin storage: la app sigue funcionando en memoria */
  }
}

export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  useEffect(() => {
    save(key, value);
  }, [key, value]);
  const set = useCallback((v: T | ((prev: T) => T)) => setValue(v), []);
  return [value, set];
}
