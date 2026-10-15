import { Link } from "react-router-dom";
import Icon, { BrandMark } from "../components/Icon.tsx";
import type { IconName } from "../lib/icons.ts";
import { LegalFooter } from "./Legal.tsx";

// "Cómo funciona": de dónde salen los precios, qué es gratis y cómo se sostiene
// FindMyTrip. Se puede leer sin iniciar sesión.

type Row = { icon: IconName; title: string; text: string; tone?: "brand" | "green" | "gray" };

const SOURCES: Row[] = [
  {
    icon: "plane",
    title: "Vuelos: Aviasales",
    text: "Precios reales que se vieron en los últimos días para cada ruta (Data API de Travelpayouts). Sirven para comparar y descubrir; el precio final lo confirma la aerolínea o la agencia.",
  },
  {
    icon: "search",
    title: "Google Flights y Google Hotels",
    text: "Cuando elegís fechas concretas, la app consulta Google automáticamente para traer el precio del día. Tiene una cuota mensual, por eso se usa solo cuando hace falta.",
  },
  {
    icon: "bed",
    title: "Hoteles: Xotelo",
    text: "Compara lo que cobran Booking, Agoda, Expedia y otros por el mismo hotel y te muestra la mejor tarifa.",
  },
  {
    icon: "utensils",
    title: "Comidas, paseos y lugares fuera del catálogo",
    text: "Son estimados propios según el destino y tu estilo de viaje. Siempre van marcados como estimados y, salvo que lo pidas, quedan aparte del total.",
  },
  {
    icon: "tag",
    title: "Precios en pesos",
    text: "Se calculan con el dólar tarjeta del día, que tomamos de dolarapi.com. Son orientativos.",
  },
];

const RADAR: Row[] = [
  {
    icon: "radar",
    title: "El radar revisa 5 veces por día",
    text: "Mira los precios desde tu ciudad hacia todos los destinos del catálogo y guarda lo que va viendo. Así sabe qué es caro y qué es una oportunidad.",
    tone: "brand",
  },
  {
    icon: "trendDown",
    title: "Qué cuenta como oferta",
    text: "Cuando un vuelo está al menos 15 % por debajo de lo habitual para esa ruta, o es el más barato desde que la seguimos. Si todavía no hay historial, compara contra un precio de referencia propio.",
    tone: "brand",
  },
  {
    icon: "bell",
    title: "Alertas por Telegram",
    text: "Con \"Avisarme si baja\" te escribimos cuando un viaje entra en tu presupuesto, y si querés también te mandamos las mejores ofertas del radar. Se activan y desactivan desde Perfil.",
    tone: "brand",
  },
];

const FREE: Row[] = [
  { icon: "check", title: "Buscar, comparar y armar viajes", text: "Sin límite y sin costo.", tone: "green" },
  { icon: "check", title: "Radar, historial de precios y alertas", text: "Funcionan solos, todos los días.", tone: "green" },
  {
    icon: "check",
    title: "Trippy, el agente de viajes",
    text: "Usa una inteligencia artificial gratuita. Quien administra el sitio puede sumar Claude como opción, pero a vos no te cuesta nada.",
    tone: "green",
  },
];

const NOT: Row[] = [
  { icon: "close", title: "No vende pasajes ni hoteles", text: "Te llevamos al sitio del proveedor; la compra es con ellos.", tone: "gray" },
  { icon: "close", title: "No cobra nada", text: "Ni suscripción ni cargos por reserva.", tone: "gray" },
  { icon: "close", title: "No guarda tarjetas", text: "Nunca te pedimos datos de pago.", tone: "gray" },
  { icon: "close", title: "No vende tus datos", text: "Sin publicidad, sin analítica de terceros y sin newsletters.", tone: "gray" },
];

function Group({ title, rows, id }: { title: string; rows: Row[]; id: string }) {
  return (
    <section className="how-group" aria-labelledby={id}>
      <h2 id={id} className="grouped-title">
        {title}
      </h2>
      <ul className="grouped how-list">
        {rows.map((r) => (
          <li key={r.title}>
            <span className={`how-icon ${r.tone ?? ""}`} aria-hidden="true">
              <Icon name={r.icon} size={18} />
            </span>
            <div>
              <strong>{r.title}</strong>
              <p>{r.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="legal">
      <header className="legal-top">
        <Link to="/" className="legal-brand">
          <BrandMark size={32} />
          <span>FindMyTrip</span>
        </Link>
        <Link to="/">Volver al inicio</Link>
      </header>
      <article className="how">
        <div className="how-hero">
          <p className="eyebrow">Cómo funciona</p>
          <h1>Precios reales, sin letra chica</h1>
          <p className="lead">
            FindMyTrip busca por vos vuelos, alojamiento y destinos que entran en tu presupuesto. Acá te contamos de dónde sale cada
            número y cómo se sostiene el sitio.
          </p>
        </div>

        <Group id="how-sources" title="De dónde salen los precios" rows={SOURCES} />
        <Group id="how-radar" title="El radar y las alertas" rows={RADAR} />
        <Group id="how-free" title="Qué es gratis" rows={FREE} />

        <section className="how-group" aria-labelledby="how-money">
          <h2 id="how-money" className="grouped-title">
            Cómo gana FindMyTrip
          </h2>
          <div className="card how-money">
            <span className="how-icon brand" aria-hidden="true">
              <Icon name="external" size={18} />
            </span>
            <div>
              <p>
                Algunos links son <strong>de afiliado</strong>, a través de Travelpayouts. Si comprás por ellos, el proveedor nos paga una
                comisión <strong>sin costo extra para vos</strong>: pagás lo mismo que entrando directo.
              </p>
              <p className="small muted">Eso no cambia el orden ni los precios que te mostramos.</p>
            </div>
          </div>
        </section>

        <Group id="how-not" title="Lo que no hace" rows={NOT} />

        <div className="how-cta">
          <Link to="/" className="button primary">
            <Icon name="compass" size={18} /> Empezar a explorar
          </Link>
          <p className="small muted">
            Más detalles en los <Link to="/legal/terminos">términos</Link> y la <Link to="/legal/privacidad">política de privacidad</Link>.
          </p>
        </div>
      </article>
      <LegalFooter />
    </div>
  );
}
