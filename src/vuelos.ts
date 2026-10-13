import "./styles.css";

// Página del buscador en vivo (White Label de Travelpayouts / Aviasales).
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
  prefill.textContent = `Búsqueda sugerida: ${from} → ${to}, ida ${fmt(depart)}${ret ? `, vuelta ${fmt(ret)}` : ""}.`;
  prefill.hidden = false;
}

// Si a los pocos segundos el widget no se dibujó, avisamos que falta configurarlo.
setTimeout(() => {
  const search = document.getElementById("tpwl-search");
  const missing = document.getElementById("wl-missing");
  if (search && missing && search.childElementCount === 0) missing.hidden = false;
}, 6000);
