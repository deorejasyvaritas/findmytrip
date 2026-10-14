// Service worker de FindMyTrip: permite abrir la app sin conexión.
// - Páginas: primero la red (siempre la versión nueva); sin conexión, la última guardada.
// - Archivos de /assets (llevan hash en el nombre, no cambian): se guardan al usarlos.
// - /api: siempre a la red. Solo el catálogo público (destinos, fotos, datos
//   generales) queda de respaldo; nunca respuestas con datos de la cuenta.
// - Otros dominios (mapas, fotos, socios): no se tocan.

// v2: se descartan cachés de v1 que podían tener index.html guardado como si fuera un .js.
const VERSION = "v2";
const SHELL = `fmt-shell-${VERSION}`;
const ASSETS = `fmt-assets-${VERSION}`;
const API = `fmt-api-${VERSION}`;
const MAX_ASSETS = 80;

const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/apple-touch-icon.png"];
// Respuestas de /api iguales para todos los usuarios (sin datos personales).
const PUBLIC_API = new Set(["/api/meta", "/api/destinations", "/api/photos"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => Promise.all(PRECACHE.map((url) => fetch(url, { cache: "reload" }).then((res) => store(cache, url, res)))))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fmt-") && ![SHELL, ASSETS, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (PUBLIC_API.has(url.pathname)) event.respondWith(networkFirst(req, API));
    return; // el resto va directo a la red, sin guardar nada
  }

  if (req.mode === "navigate") {
    event.respondWith(page(req, url));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(req));
  }
});

/** Páginas: red primero; sin conexión, la misma página guardada o la app (SPA). */
async function page(req, url) {
  const key = url.pathname === "/vuelos.html" || url.pathname === "/vuelos" ? "/vuelos.html" : "/";
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(SHELL);
      await store(cache, key, res.clone());
    }
    return res;
  } catch {
    const cached = (await caches.match(key)) || (await caches.match("/"));
    return cached || Response.error();
  }
}

async function networkFirst(req, name) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(name);
      await cache.put(req, res.clone());
    }
    return res;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit && !isHtml(hit)) return hit;
  const res = await fetch(req);
  // El sitio responde index.html (200) para cualquier ruta que no existe, también para
  // un archivo de un deploy anterior. Eso no se guarda: la app detecta el error y recarga.
  if (res.ok && res.type === "basic" && !isHtml(res)) {
    const cache = await caches.open(ASSETS);
    await cache.put(req, res.clone());
    trim(cache);
  }
  return res;
}

function isHtml(res) {
  return (res.headers.get("content-type") || "").includes("text/html");
}

/** Guarda una página como respuesta "limpia" (Safari no acepta redirecciones en navegación). */
async function store(cache, key, res) {
  if (!res.ok || res.type !== "basic") return;
  const type = res.headers.get("content-type") || "";
  if (key.endsWith(".html") || key === "/") {
    if (!type.includes("text/html")) return;
  }
  const body = res.redirected ? new Response(await res.blob(), { headers: res.headers }) : res;
  await cache.put(key, body);
}

/** Deja solo los últimos archivos (las versiones viejas de cada deploy se van). */
async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
}
