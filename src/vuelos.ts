import "./styles.css";
import { TABS, iconSvg } from "./lib/icons.ts";
import { registerServiceWorker } from "./lib/pwa.ts";

registerServiceWorker();

// Si el sitio pide usuario y no hay sesión, volvemos al inicio (que muestra el ingreso).
fetch("/api/session")
  .then((r) => r.json())
  .then((s: { authenticated: boolean }) => {
    if (!s.authenticated) location.replace("/");
  })
  .catch(() => {});

// Página del buscador en vivo (White Label de Travelpayouts / Aviasales).
// Es una página aparte del resto de la app, así que armamos la navegación acá.

for (const el of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  el.innerHTML = iconSvg("plane", 18);
}
for (const nav of document.querySelectorAll<HTMLElement>("[data-tabs]")) {
  const withIcons = nav.dataset.tabs === "icons";
  for (const tab of TABS) {
    const a = document.createElement("a");
    a.href = tab.to;
    if (tab.to === "/") {
      // Vuelos es una pestaña del buscador, que vive en Explorar.
      a.className = "active";
      a.setAttribute("aria-current", "page");
    }
    a.innerHTML = `${withIcons ? iconSvg(tab.icon, 24) : ""}<span>${tab.label}</span>`;
    nav.append(a);
  }
}

// Si venimos desde un destino, mostramos qué búsqueda conviene hacer.
const params = new URLSearchParams(location.search);
const from = params.get("from");
const to = params.get("to");
const depart = params.get("depart");
const ret = params.get("ret");
const prefill = document.getElementById("prefill");
if (prefill && from && to && depart) {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
  prefill.textContent = `Búsqueda sugerida: ${from} a ${to}, ida ${fmt(depart)}${ret ? `, vuelta ${fmt(ret)}` : ""}.`;
  prefill.hidden = false;
}

// Si a los pocos segundos el widget no se dibujó, avisamos que falta configurarlo.
setTimeout(() => {
  const search = document.getElementById("tpwl-search");
  const missing = document.getElementById("wl-missing");
  // El widget puede dibujarse dentro de un shadow DOM: miramos si ocupa lugar.
  const rendered = search && (search.childElementCount > 0 || search.shadowRoot || search.offsetHeight > 20);
  if (missing && !rendered) missing.hidden = false;
}, 8000);
