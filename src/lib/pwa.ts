// App instalable: registra el service worker (public/sw.js) solo en producción.
// En desarrollo no, para que Vite recargue siempre lo último.
// Las actualizaciones son silenciosas: el worker nuevo toma el control y la
// próxima vez que abras o recargues ya ves la versión nueva (las páginas
// siempre se piden a la red primero, así que nunca quedás con una vieja online).

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
