// Requisitos de entrada para viajeros argentinos (pasaporte o DNI argentino), por país.
// Datos curados a mano: cambian poco, pero cambian. Cada país tiene su fuente
// oficial y la fecha de la última revisión; la app siempre pide verificar antes de viajar.

export type EntryDocument = "dni" | "pasaporte";
/** "autorizacion": sin visa, pero con un trámite online previo (tipo ESTA, ETIAS o tarjeta de llegada). */
export type EntryVisa = "no" | "si" | "autorizacion";

export interface EntryRequirements {
  country: string;
  /** Otros nombres con los que puede llegar el país (geocodificador, inglés, sin tildes). */
  aliases?: string[];
  /** Viaje dentro de la Argentina. */
  domestic?: boolean;
  /** "dni": alcanza con el DNI tarjeta (también sirve el pasaporte). */
  document: EntryDocument;
  documentNote: string;
  visa: EntryVisa;
  visaNote: string;
  /** Permanencia máxima como turista. */
  stay: string;
  /** Vacunas exigidas o recomendadas (null si no hay nada particular). */
  vaccines: string | null;
  /** Exigen el certificado internacional de una vacuna para entrar. */
  vaccineRequired?: boolean;
  /** Si piden seguro médico (null si no es requisito). */
  insurance: string | null;
  /** Formularios o trámites previos (tarjeta de llegada, declaración online, tasas). */
  forms?: string[];
  source: { label: string; url: string };
  lastReviewed: string;
}

export const CANCILLERIA_URL = "https://cancilleria.gob.ar/es/servicios/viajar-al-exterior/documentacion";
export const MINORS_URL = "https://www.argentina.gob.ar/servicio/autorizacion-de-viaje-para-menores-de-edad";
export const VERIFY_NOTE = "Verificá antes de viajar en la fuente oficial: los requisitos pueden cambiar.";
export const MINORS_NOTE =
  "Menores de 18: si no viajan con los dos padres, necesitan una autorización de viaje (ante escribano, en Migraciones o en el RENAPER).";

const REVIEWED = "2026-10-13";

// Mercosur y asociados: DNI tarjeta o pasaporte, sin visa, hasta 90 días.
const MERCOSUR_DOC =
  "DNI tarjeta vigente o pasaporte. El DNI digital de Mi Argentina no sirve para cruzar la frontera, y el DNI alcanza solo si no hacés escalas fuera de Sudamérica.";
const SCHENGEN = {
  document: "pasaporte" as const,
  documentNote: "Pasaporte vigente, con al menos 3 meses de validez después de la salida del espacio Schengen.",
  visa: "no" as const,
  visaNote:
    "Sin visa. En la frontera registran huellas y foto (sistema EES). Más adelante se va a pedir la autorización online ETIAS: todavía no tiene fecha confirmada.",
  stay: "Hasta 90 días en cualquier período de 180, sumando todo el espacio Schengen",
  vaccines: null,
  insurance:
    "Pueden pedirte seguro médico de viaje (cobertura mínima de 30.000 euros), además de pasaje de vuelta, alojamiento y fondos. Llevalo impreso.",
  forms: undefined as string[] | undefined,
};
const SCHENGEN_SOURCE = { label: "Unión Europea: viajar a Europa (EES y ETIAS)", url: "https://travel-europe.europa.eu/etias_es" };

export const ENTRY_REQUIREMENTS: EntryRequirements[] = [
  {
    country: "Argentina",
    domestic: true,
    document: "dni",
    documentNote: "DNI. En vuelos de cabotaje también vale el DNI digital de Mi Argentina.",
    visa: "no",
    visaNote: "Es un viaje dentro del país.",
    stay: "Sin límite",
    vaccines: "Fiebre amarilla recomendada para zonas de selva del noreste (Misiones, Corrientes).",
    insurance: null,
    source: { label: "Migraciones: documentación para viajar", url: "https://www.argentina.gob.ar/interior/migraciones" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Brasil",
    aliases: ["Brazil"],
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur).",
    stay: "Hasta 90 días, prorrogables por otros 90",
    vaccines: "Fiebre amarilla recomendada si vas a zonas de selva o rurales (no a las playas habituales).",
    insurance: null,
    source: { label: "Cancillería argentina: documentación para viajar", url: CANCILLERIA_URL },
    lastReviewed: REVIEWED,
  },
  {
    country: "Uruguay",
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur).",
    stay: "Hasta 90 días",
    vaccines: null,
    insurance: null,
    source: { label: "Cancillería argentina: documentación para viajar", url: CANCILLERIA_URL },
    lastReviewed: REVIEWED,
  },
  {
    country: "Chile",
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur). Guardá el comprobante de ingreso que te dan en la frontera: lo piden al salir.",
    stay: "Hasta 90 días",
    vaccines: null,
    insurance: null,
    source: { label: "Cancillería argentina: documentación para viajar", url: CANCILLERIA_URL },
    lastReviewed: REVIEWED,
  },
  {
    country: "Perú",
    aliases: ["Peru"],
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur).",
    stay: "Hasta 90 días (Migraciones decide al entrar)",
    vaccines: "Fiebre amarilla recomendada si vas a la selva amazónica (no hace falta para Lima, Cusco ni Machu Picchu).",
    insurance: null,
    source: { label: "Migraciones Perú", url: "https://www.gob.pe/migraciones" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Colombia",
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur).",
    stay: "Hasta 90 días, prorrogables hasta 180 por año",
    vaccines:
      "Fiebre amarilla recomendada, y exigida para entrar a algunos parques nacionales (por ejemplo Tayrona). Aplicátela al menos 10 días antes.",
    insurance: null,
    forms: ["Formulario Check-MIG online, dentro de las 72 horas previas al vuelo"],
    source: { label: "Migración Colombia", url: "https://www.migracioncolombia.gov.co" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Bolivia",
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur).",
    stay: "Hasta 30 días, prorrogables hasta 90 por año",
    vaccines: "Fiebre amarilla recomendada, y pueden pedirte el certificado si vas a zonas tropicales (Santa Cruz, Beni, Pando, Yungas).",
    insurance: null,
    source: { label: "Cancillería argentina: documentación para viajar", url: CANCILLERIA_URL },
    lastReviewed: REVIEWED,
  },
  {
    country: "Ecuador",
    document: "dni",
    documentNote: MERCOSUR_DOC,
    visa: "no",
    visaNote: "Sin visa (Mercosur). Para Galápagos hay controles y tasas aparte.",
    stay: "Hasta 90 días por año",
    vaccines: "Fiebre amarilla recomendada si vas a la Amazonía.",
    insurance: "Para Galápagos piden seguro médico y la tarjeta de control de tránsito. Para el resto del país, muy recomendado.",
    source: { label: "Cancillería de Ecuador", url: "https://www.cancilleria.gob.ec" },
    lastReviewed: REVIEWED,
  },
  {
    country: "República Dominicana",
    aliases: ["Republica Dominicana", "Dominicana", "Dominican Republic"],
    document: "pasaporte",
    documentNote: "Pasaporte vigente durante toda la estadía (hasta fin de 2026 no exigen los 6 meses de validez a turistas argentinos).",
    visa: "no",
    visaNote: "Sin visa. La tarjeta de turista suele venir incluida en el pasaje.",
    stay: "Hasta 30 días, prorrogables en Migración",
    vaccines: null,
    insurance: null,
    forms: ["E-Ticket de migración y aduana, gratis, online antes de cada vuelo (entrada y salida)"],
    source: { label: "Dirección General de Migración", url: "https://migracion.gob.do" },
    lastReviewed: REVIEWED,
  },
  {
    country: "México",
    aliases: ["Mexico"],
    document: "pasaporte",
    documentNote: "Pasaporte vigente (conviene que tenga al menos 6 meses de validez).",
    visa: "no",
    visaNote:
      "Sin visa, pero el ingreso no es automático: llevá pasaje de vuelta, reservas de alojamiento y cómo demostrar fondos. Los días los decide Migración al entrar.",
    stay: "Hasta 180 días",
    vaccines: null,
    insurance: null,
    forms: ["Forma Migratoria Múltiple (FMM) digital, se completa al llegar"],
    source: { label: "Instituto Nacional de Migración", url: "https://www.gob.mx/inm" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Costa Rica",
    document: "pasaporte",
    documentNote: "Pasaporte vigente (conviene que tenga al menos 6 meses de validez).",
    visa: "no",
    visaNote: "Sin visa. Piden pasaje de salida y pueden pedirte fondos (unos USD 100 por mes de estadía).",
    stay: "Hasta 90 días",
    vaccines: null,
    insurance: "No es obligatorio, pero muy recomendado: la atención privada es cara.",
    source: { label: "Dirección General de Migración de Costa Rica", url: "https://www.migracion.go.cr" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Aruba",
    document: "pasaporte",
    documentNote: "Pasaporte vigente durante toda la estadía.",
    visa: "autorizacion",
    visaNote: "Sin visa, pero hay que completar la ED Card online antes de viajar. Piden pasaje de vuelta y alojamiento.",
    stay: "Hasta 30 días, prorrogables en Aruba",
    vaccines: null,
    insurance: "En la ED Card te preguntan por tu seguro médico de viaje: llevalo contratado.",
    forms: ["ED Card online (dentro de los 7 días previos), con la tasa de sostenibilidad de USD 20"],
    source: { label: "ED Card oficial de Aruba", url: "https://www.edcardaruba.aw" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Estados Unidos",
    aliases: ["EEUU", "EE. UU.", "EE.UU.", "Estados Unidos de America", "United States", "USA"],
    document: "pasaporte",
    documentNote: "Pasaporte vigente.",
    visa: "si",
    visaNote:
      "Necesitás visa de turista B1/B2, con entrevista en la Embajada en Buenos Aires: sacá turno con tiempo. Argentina está en proceso de volver al programa sin visa (ESTA), pero todavía no rige.",
    stay: "Hasta 6 meses (lo define el oficial al entrar)",
    vaccines: null,
    insurance: "No es obligatorio, pero imprescindible: la atención médica es carísima.",
    source: { label: "Embajada de EE. UU. en Argentina: visas", url: "https://ar.usembassy.gov/es/visas/" },
    lastReviewed: REVIEWED,
  },
  { country: "España", aliases: ["Espana", "Spain"], ...SCHENGEN, source: { label: "Consulado de España en Buenos Aires", url: "https://www.exteriores.gob.es/Consulados/buenosaires/es/Paginas/index.aspx" }, lastReviewed: REVIEWED },
  { country: "Italia", aliases: ["Italy"], ...SCHENGEN, source: SCHENGEN_SOURCE, lastReviewed: REVIEWED },
  { country: "Portugal", ...SCHENGEN, source: SCHENGEN_SOURCE, lastReviewed: REVIEWED },
  { country: "Francia", aliases: ["France"], ...SCHENGEN, source: SCHENGEN_SOURCE, lastReviewed: REVIEWED },
  { country: "Grecia", aliases: ["Greece"], ...SCHENGEN, source: SCHENGEN_SOURCE, lastReviewed: REVIEWED },
  { country: "Croacia", aliases: ["Croatia"], ...SCHENGEN, source: SCHENGEN_SOURCE, lastReviewed: REVIEWED },
  {
    country: "Tailandia",
    aliases: ["Thailand"],
    document: "pasaporte",
    documentNote: "Pasaporte con al menos 6 meses de validez.",
    visa: "autorizacion",
    visaNote:
      "Sin visa por acuerdo bilateral, pero hay que completar la tarjeta digital de llegada (TDAC) antes del viaje. En 2026 Tailandia cambió su régimen general: confirmá los días en la fuente oficial.",
    stay: "Hasta 90 días (acuerdo bilateral con la Argentina)",
    vaccines: "Fiebre amarilla: piden el certificado internacional a quienes llegan desde la Argentina (aplicada al menos 10 días antes).",
    vaccineRequired: true,
    insurance: null,
    forms: ["TDAC (Thailand Digital Arrival Card) online, gratis, dentro de las 72 horas previas"],
    source: { label: "Inmigración de Tailandia (TDAC)", url: "https://tdac.immigration.go.th" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Japón",
    aliases: ["Japon", "Japan"],
    document: "pasaporte",
    documentNote: "Pasaporte vigente durante toda la estadía.",
    visa: "no",
    visaNote: "Sin visa para turismo. Conviene registrarte en Visit Japan Web para agilizar migraciones y aduana.",
    stay: "Hasta 90 días",
    vaccines: null,
    insurance: null,
    forms: ["Visit Japan Web (opcional, recomendado)"],
    source: { label: "Ministerio de Relaciones Exteriores de Japón", url: "https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html" },
    lastReviewed: REVIEWED,
  },
  {
    country: "Marruecos",
    aliases: ["Morocco"],
    document: "pasaporte",
    documentNote: "Pasaporte con al menos 6 meses de validez.",
    visa: "no",
    visaNote: "Sin visa para turismo.",
    stay: "Hasta 90 días",
    vaccines: null,
    insurance: null,
    source: { label: "Portal consular de Marruecos", url: "https://www.consulat.ma" },
    lastReviewed: REVIEWED,
  },
];

/** "República Dominicana" → "republica dominicana". Sin tildes, puntos ni mayúsculas. */
export function normalizeCountry(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX = new Map<string, EntryRequirements>();
for (const r of ENTRY_REQUIREMENTS) {
  for (const name of [r.country, ...(r.aliases ?? [])]) INDEX.set(normalizeCountry(name), r);
}

/** Requisitos para un país (por nombre, en español o inglés, con o sin tildes). null si no está curado. */
export function entryRequirements(country: string | null | undefined): EntryRequirements | null {
  if (!country) return null;
  return INDEX.get(normalizeCountry(country)) ?? null;
}

export const VISA_LABEL: Record<EntryVisa, string> = {
  no: "Sin visa",
  si: "Con visa",
  autorizacion: "Sin visa, con trámite online",
};

/** Una línea para las paradas del viaje: "DNI · sin visa · hasta 90 días". */
export function entrySummary(r: EntryRequirements): string {
  if (r.domestic) return "Viaje dentro del país: alcanza con el DNI";
  const doc = r.document === "dni" ? "DNI o pasaporte" : "Pasaporte";
  const visa = r.visa === "si" ? "con visa" : r.visa === "autorizacion" ? "sin visa, con trámite online" : "sin visa";
  return [doc, visa, r.vaccineRequired ? "certificado de vacuna" : null].filter(Boolean).join(" · ");
}
