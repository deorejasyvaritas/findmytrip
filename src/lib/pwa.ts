// App instalable: registra el service worker (public/sw.js) solo en producción.
// En desarrollo no, para que Vite recargue siempre lo último.
// Las actualizaciones son silenciosas: el worker nuevo toma el control y la
// próxima vez que abras o recargues ya ves la versión nueva (las páginas
// siempre se piden a la red primero, así que nunca quedás con una vieja online).
// Si una pestaña vieja pide un archivo que ya no existe, ver handleStaleChunks.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Si la app queda abierta mucho tiempo, busca versiones nuevas al volver a ella.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => undefined);
        });
      })
      .catch((err) => console.warn("[pwa] no se pudo registrar el service worker:", (err as Error).message));
  });
}

// Después de un deploy, los archivos viejos de /assets dejan de existir. Si una
// pestaña abierta con la versión anterior pide uno, el import falla: no es un
// error de la app sino que hay una versión nueva. Recargamos una sola vez (para no
// entrar en un bucle si el problema es otro) y, si no alcanza, avisamos.
const RELOAD_KEY = "fmt:chunk-reload";

/** True si el error es de un archivo de la app que no se pudo bajar (versión vieja o sin red). */
export function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as Error)?.message ?? error ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload CSS|Loading chunk/i.test(
    msg,
  );
}

/** Recarga la página una vez cada 30 s como mucho. Devuelve false si ya se intentó (y no recarga). */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // sin sessionStorage no podemos evitar un bucle: mejor avisar en pantalla
  }
  location.reload();
  return true;
}

/** Vite avisa cuando no puede bajar un archivo de una pantalla: probamos con la versión nueva. */
export function handleStaleChunks(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnceForNewVersion()) event.preventDefault();
  });
}
