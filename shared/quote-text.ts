// "Mandar por WhatsApp" / "Pedir cotización a mi agente": un resumen corto, en
// texto plano y en primera persona, para pegar en un chat con una agencia.
// Sin emojis. Cada precio va con su etiqueta (visto hace..., estimado...).

import type { PackageItem, TripPackage } from "./types.ts";
import type { DateWindow } from "./trip-window.ts";
import { describeWindow } from "./trip-window.ts";

export interface QuoteInput {
  origin: string;
  /** Adultos y edad de cada menor (si se sabe); si no, cuántas personas. */
  party: { adults: number; childAges: number[] } | { people: number };
  stops: { name: string; nights: number }[];
  depart: string;
  ret?: string | null;
  window?: DateWindow | null;
  budget?: string | null;
  lodging?: string[];
  /** Precios vistos: etiqueta, monto ya formateado y de qué tipo es el precio. */
  prices?: { label: string; amount: string; note?: string | null }[];
  total?: string | null;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

function partyText(p: QuoteInput["party"]): string {
  if ("people" in p) return `${p.people} ${p.people === 1 ? "persona" : "personas"}`;
  const total = p.adults + p.childAges.length;
  const people = `${total} ${total === 1 ? "persona" : "personas"}`;
  if (!p.childAges.length) return `${people} (${p.adults} ${p.adults === 1 ? "adulto" : "adultos"})`;
  const ages = p.childAges.map((a) => (a < 1 ? "menos de 1 año" : `${a} ${a === 1 ? "año" : "años"}`));
  const kids = p.childAges.length === 1 ? `un menor de ${ages[0]}` : `menores de ${ages.slice(0, -1).join(", ")} y ${ages[ages.length - 1]}`;
  return `${people}: ${p.adults} ${p.adults === 1 ? "adulto" : "adultos"} y ${kids}`;
}

const nights = (n: number) => `${n} ${n === 1 ? "noche" : "noches"}`;

export function quoteText(q: QuoteInput): string {
  const lines: string[] = [];
  lines.push(`Hola, quiero cotizar un viaje para ${partyText(q.party)}.`);
  const route = q.stops.map((s) => `${nights(s.nights)} en ${s.name}`);
  lines.push(`Salgo desde ${q.origin}. ${route.length > 1 ? `${route.slice(0, -1).join(", ")} y ${route[route.length - 1]}` : route[0]}.`);
  if (q.window) {
    lines.push(`Fechas flexibles: ${describeWindow(q.window)}. Lo más barato que vi sale el ${dm(q.depart)}${q.ret ? ` y vuelve el ${dm(q.ret)}` : ""}.`);
  } else {
    lines.push(`Fechas: del ${dm(q.depart)}${q.ret ? ` al ${dm(q.ret)}` : ""}.`);
  }
  if (q.budget) lines.push(`Presupuesto: ${q.budget}.`);
  if (q.lodging?.length) lines.push(`Alojamiento: ${q.lodging.join("; ")}.`);
  if (q.prices?.length) {
    lines.push("", "Precios de referencia que vi:");
    for (const p of q.prices) lines.push(`- ${p.label}: ${p.amount}${p.note ? ` (${p.note.toLowerCase()})` : ""}`);
    if (q.total) lines.push(`Total aproximado: ${q.total}`);
  }
  lines.push("", "¿Me pasás precio final y opciones de pago en cuotas? Gracias.");
  return lines.join("\n");
}

/** Datos para el resumen de un viaje guardado (Mis viajes). */
export function packageQuoteInput(
  pkg: TripPackage,
  money: (usd: number) => string,
  note: (item: PackageItem) => string | null = () => null,
): QuoteInput {
  const nightsTotal = Math.max(1, Math.round((Date.parse(pkg.returnDate) - Date.parse(pkg.departDate)) / 86400000) || 1);
  return {
    origin: pkg.origin,
    party: pkg.party ?? { people: pkg.travelers },
    stops: pkg.stops?.length ? pkg.stops : [{ name: pkg.destinationName, nights: nightsTotal }],
    depart: pkg.departDate,
    ret: pkg.returnDate,
    window: pkg.window ?? null,
    prices: pkg.items.map((i) => ({ label: i.label, amount: money(i.amountUSD), note: note(i) })),
    total: money(pkg.totalUSD),
  };
}

/** Link para abrir WhatsApp con el texto (elegís el chat después). */
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
