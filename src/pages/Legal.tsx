import { Link, Navigate, useParams } from "react-router-dom";
import { BrandMark } from "../components/Icon.tsx";

// Información legal de FindMyTrip. Se puede ver sin iniciar sesión.

const UPDATED = "octubre de 2026";

export const DISCLAIMER =
  "FindMyTrip es una herramienta informativa. No vende pasajes, alojamientos ni servicios turísticos. Los precios y la disponibilidad pueden cambiar. La contratación y el pago se hacen directamente con cada proveedor.";

type Section = { title: string; body: (string | string[])[] };
type Doc = { title: string; intro: string; sections: Section[] };

const DOCS: Record<string, Doc> = {
  terminos: {
    title: "Términos y condiciones",
    intro: "Reglas de uso y alcance de FindMyTrip.",
    sections: [
      {
        title: "1. Qué es FindMyTrip",
        body: [
          "FindMyTrip es una herramienta tecnológica e informativa para planificar viajes: busca, compara y organiza precios de vuelos, alojamiento y servicios publicados por terceros, y sugiere destinos según tu presupuesto.",
          "FindMyTrip no vende pasajes, alojamientos ni paquetes turísticos; no procesa pagos ni cobra reservas; no emite tickets o vouchers y no interviene en la contratación entre vos y el proveedor.",
        ],
      },
      {
        title: "2. Acceso",
        body: [
          "El acceso es con usuario y contraseña. La cuenta principal administra el sitio y decide si se habilitan registros nuevos. Sos responsable de cuidar tu contraseña.",
        ],
      },
      {
        title: "3. Precios y disponibilidad",
        body: [
          "Los precios son informativos y corresponden al momento en que se consultaron. Pueden cambiar por disponibilidad, impuestos, tasas, equipaje, moneda, cotización, fechas o condiciones del proveedor.",
          "Los montos marcados como estimados (por ejemplo comidas, paseos, equipaje o alojamiento sin precio real) son aproximaciones propias. Los precios en pesos usan la cotización del dólar tarjeta del día y son orientativos.",
          "El precio definitivo es siempre el que informa el proveedor antes de contratar.",
        ],
      },
      {
        title: "4. Automatización e inteligencia artificial",
        body: [
          "FindMyTrip usa procesos automáticos y, en el agente, inteligencia artificial. Pueden existir errores, demoras o diferencias con la información final del proveedor.",
        ],
      },
      {
        title: "5. Etiquetas y radar",
        body: [
          "Expresiones como \"Entra holgado\", \"Oferta\", \"Mínimo\", \"Bajó\" o porcentajes de descuento son indicadores propios para ayudarte a interpretar precios. No garantizan que sea el menor precio disponible ni un ahorro determinado.",
        ],
      },
      {
        title: "6. Proveedores externos",
        body: [
          "Al tocar un link podés ser redirigido a un sitio externo (aerolíneas, buscadores, hoteles, traslados, seguros y otros). La contratación, el pago, la emisión, los cambios, cancelaciones, reembolsos y la atención posventa se gestionan directamente con ese proveedor.",
        ],
      },
      {
        title: "7. Links de afiliado",
        body: [
          "Algunos links son de afiliado (por ejemplo, a través de Travelpayouts). Si contratás por ellos, FindMyTrip puede recibir una comisión, sin costo extra para vos. Eso no cambia el orden ni los precios que mostramos.",
        ],
      },
      {
        title: "8. Antes de contratar",
        body: [
          "Verificá con el proveedor el precio final, moneda, impuestos, fechas, aeropuertos, escalas, equipaje, documentación, requisitos migratorios y condiciones de cambio o cancelación.",
        ],
      },
      {
        title: "9. Disponibilidad del sitio",
        body: ["Procuramos que FindMyTrip funcione y esté actualizado, pero no garantizamos un funcionamiento sin interrupciones ni libre de errores."],
      },
      {
        title: "10. Cambios",
        body: ["Estos términos pueden actualizarse. La versión vigente es la publicada en esta página con su fecha de actualización."],
      },
    ],
  },
  privacidad: {
    title: "Política de privacidad",
    intro: "Qué datos usa FindMyTrip y para qué.",
    sections: [
      {
        title: "1. Datos que guardamos",
        body: [
          [
            "Tu usuario y tu contraseña. La contraseña se guarda cifrada (PBKDF2 con sal); nadie puede leerla.",
            "Tu perfil y preferencias: ciudad de salida, quiénes viajan, equipaje, estilo, intereses, moneda.",
            "Lo que guardás: viajes armados, destinos seguidos y alertas.",
            "Si conectás Telegram: el identificador del chat y tu nombre en Telegram, para mandarte las alertas.",
            "Datos técnicos mínimos: la dirección IP se usa solo para frenar intentos repetidos de ingreso y se descarta a los 15 minutos.",
          ],
        ],
      },
      {
        title: "2. Para qué los usamos",
        body: [
          [
            "Mostrarte precios y sugerencias a tu medida.",
            "Guardar tus viajes y sincronizarlos entre dispositivos.",
            "Enviarte las alertas que activaste (\"Avisarme si baja\" y ofertas del radar).",
            "Proteger el acceso y evitar usos abusivos.",
          ],
          "No usamos tus datos para publicidad, no los vendemos y no enviamos newsletters ni promociones.",
        ],
      },
      {
        title: "3. Proveedores tecnológicos",
        body: [
          [
            "Cloudflare: aloja el sitio y guarda los datos de las cuentas.",
            "Telegram: envía las alertas, solo si lo conectás.",
            "Inteligencia artificial del agente (Workers AI de Cloudflare o Claude de Anthropic): recibe los mensajes que escribís en el chat para poder responder.",
            "OpenStreetMap: dibuja el mapa de vuelos baratos. Tu navegador le pide las imágenes del mapa, sin ningún dato de tu cuenta.",
            "Fuentes de precios (Travelpayouts/Aviasales, Google vía SerpApi, Xotelo, Wikipedia, dolarapi): reciben solo los datos de la búsqueda, como destino y fechas, nunca tu usuario ni tus datos de contacto.",
          ],
        ],
      },
      {
        title: "4. Conservación",
        body: [
          "Los datos se guardan mientras tengas tu cuenta. Las alertas y la conexión con Telegram se pueden desactivar en cualquier momento desde Perfil.",
        ],
      },
      {
        title: "5. Tus derechos",
        body: [
          "De acuerdo con la Ley 25.326 de Protección de Datos Personales, podés pedir acceso, rectificación, actualización o supresión de tus datos a la persona que administra el sitio. La Agencia de Acceso a la Información Pública es el órgano de control de esa ley.",
        ],
      },
      {
        title: "6. Sitios externos",
        body: ["Los sitios a los que te redirigimos tienen sus propias políticas de privacidad y son responsables de sus datos."],
      },
      {
        title: "7. Cambios",
        body: ["Podemos actualizar esta política cuando cambien las funciones del sitio. La fecha vigente figura al comienzo."],
      },
    ],
  },
  cookies: {
    title: "Cookies",
    intro: "Qué guarda FindMyTrip en tu navegador.",
    sections: [
      {
        title: "1. Cookie de sesión",
        body: [
          "Usamos una sola cookie, fmt_session, para mantenerte con la sesión iniciada durante 30 días. Es necesaria para usar el sitio y no se usa para seguimiento ni publicidad.",
        ],
      },
      {
        title: "2. Almacenamiento local",
        body: ["El navegador guarda algunas preferencias y la conversación con el agente para que no se pierdan al recargar. Se borran si limpiás los datos del sitio."],
      },
      {
        title: "3. Sin analítica ni publicidad",
        body: ["FindMyTrip no usa herramientas de analítica ni cookies publicitarias propias."],
      },
      {
        title: "4. Sitios de terceros",
        body: [
          "Al tocar un link de afiliado, el sitio de destino o Travelpayouts pueden guardar sus propias cookies para registrar la comisión. Se rigen por las políticas de esos sitios.",
        ],
      },
    ],
  },
};

export const LEGAL_LINKS = [
  { to: "/como-funciona", label: "Cómo funciona" },
  { to: "/legal/terminos", label: "Términos" },
  { to: "/legal/privacidad", label: "Privacidad" },
  { to: "/legal/cookies", label: "Cookies" },
];

export default function LegalPage() {
  const { doc = "" } = useParams();
  const d = DOCS[doc];
  if (!d) return <Navigate to="/legal/terminos" replace />;
  return (
    <div className="legal">
      <header className="legal-top">
        <Link to="/" className="legal-brand">
          <BrandMark size={32} />
          <span>FindMyTrip</span>
        </Link>
        <Link to="/">Volver al inicio</Link>
      </header>
      <article className="legal-doc">
        <p className="eyebrow">Información legal</p>
        <h1>{d.title}</h1>
        <p className="muted">{d.intro}</p>
        <p className="small muted">Última actualización: {UPDATED}</p>
        {d.sections.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            {s.body.map((b, i) =>
              Array.isArray(b) ? (
                <ul key={i}>
                  {b.map((li) => (
                    <li key={li}>{li}</li>
                  ))}
                </ul>
              ) : (
                <p key={i}>{b}</p>
              ),
            )}
          </section>
        ))}
      </article>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <p>{DISCLAIMER}</p>
      <p>Algunos links son de afiliado: podemos recibir una comisión, sin costo extra para vos.</p>
      <p>
        Fotos de destinos: <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> y Wikipedia, de
        sus respectivos autores, bajo licencias Creative Commons (CC BY-SA y otras).
      </p>
      <nav aria-label="Información legal">
        {LEGAL_LINKS.map((l) => (
          <Link key={l.to} to={l.to}>
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
