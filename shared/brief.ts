import type { Interest, MealPlan, Profile, Style } from "./types.ts";

// Resumen del viaje que se va armando con lo que el usuario le cuenta a Trippy.
// Se calcula en el navegador (sin IA, siempre igual), se puede editar a mano y se
// manda en cada mensaje para que el agente no se olvide de lo ya dicho.

export interface TripBrief {
  destinationId?: string;
  destinationName?: string;
  /** Presupuesto total del grupo en USD. */
  budgetUSD?: number;
  /** Presupuesto por persona (si lo dijo así); se pasa a total con la cantidad de personas. */
  budgetPerPersonUSD?: number;
  adults?: number;
  childAges?: number[];
  nights?: number;
  /** Mes de viaje (1-12). */
  month?: number;
  interests?: Interest[];
  style?: Style;
}

interface DestLite {
  id: string;
  name: string;
  country: string;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_LABEL = MONTHS.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
const WORD_NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUM = "(\\d{1,2}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)";

const INTEREST_WORDS: [Interest, RegExp][] = [
  ["playa", /\bplayas?\b|\bmar\b|\bcaribe\b/],
  ["montaña", /\bmonta(n|ñ)as?\b|\btrekking\b|\bcordillera\b/],
  ["nieve", /\bnieve\b|\besqui(ar)?\b|\bski\b/],
  ["ciudad", /\bciudad(es)?\b|\burban[oa]\b/],
  ["gastronomía", /\bgastronom|\bcomer bien\b|\bcomida\b/],
  ["aventura", /\baventura\b/],
  ["cultura", /\bcultura\b|\bmuseos?\b|\bhistoria\b/],
  ["naturaleza", /\bnaturaleza\b|\bparques nacionales\b/],
  ["relax", /\brelax\b|\bdescansar\b|\btranquil[oa]\b/],
  ["noche", /\bboliches?\b|\bfiesta\b|\bvida nocturna\b/],
  ["compras", /\bcompras\b|\bshopping\b/],
  ["parques", /\bdisney\b|\bparques? (de diversiones|tem(a|á)ticos?)\b/],
];

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const toNum = (s: string) => WORD_NUM[s] ?? Number(s);

/** Convierte "2.500", "2500", "2,5k" o "3 mil" a número. */
function parseAmount(raw: string, suffix = ""): number {
  let s = raw.replace(/\s/g, "");
  let n: number;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) n = Number(s.replace(/[.,]/g, ""));
  else n = Number(s.replace(",", "."));
  if (/^(k|mil)$/.test(suffix)) n *= 1000;
  return Math.round(n);
}

/** Actualiza el resumen con un mensaje nuevo del usuario. Lo nuevo pisa a lo anterior. */
export function updateBrief(prev: TripBrief, text: string, destinations: DestLite[]): TripBrief {
  const t = normalize(text);
  const b: TripBrief = { ...prev };

  // Presupuesto: "USD 2.500", "2500 dólares", "u$s 3 mil", "1.500 por persona".
  const money = t.match(/(?:usd|u\$s|us\$|\$)\s*(\d[\d.,]*)\s*(k|mil)?|(\d[\d.,]*)\s*(k|mil)?\s*(?:usd|u\$s|dolares|verdes)/);
  if (money) {
    const amount = parseAmount(money[1] ?? money[3], money[2] ?? money[4] ?? "");
    if (amount >= 100) {
      const after = t.slice((money.index ?? 0) + money[0].length, (money.index ?? 0) + money[0].length + 20);
      if (/por (persona|cabeza)|c\/u|cada uno/.test(after)) {
        b.budgetPerPersonUSD = amount;
        b.budgetUSD = undefined;
      } else {
        b.budgetUSD = amount;
        b.budgetPerPersonUSD = undefined;
      }
    }
  }

  // Quiénes viajan.
  const adults = t.match(new RegExp(`${NUM}\\s+adult[oa]s?`));
  const para = t.match(new RegExp(`\\b(?:para|somos)\\s+${NUM}\\b(?!\\s*(?:dias|noches|semanas|meses|personas? m))`));
  if (adults) b.adults = toNum(adults[1]);
  else if (para) b.adults = toNum(para[1]);
  else if (/\bcon mi (pareja|novi[oa]|espos[oa]|marido|mujer)\b|\b(en|de) pareja\b/.test(t)) b.adults = 2;
  else if (/\b(viajo|voy|me voy) sol[oa]\b|\bsol[oa] yo\b/.test(t)) b.adults = 1;

  // Menores: "con un nene de 5", "hijos de 4 y 9 años", "chicos de 3, 6 y 10".
  const kids = t.match(/(?:nen[ea]s?|hij[oa]s?|chic[oa]s?|menor(?:es)?|bebes?)[^.]*?\bde\s+((?:\d{1,2}\s*(?:,|y)\s*)*\d{1,2})\s*(?:anos?|meses)?/);
  if (kids) {
    const ages = kids[1].match(/\d{1,2}/g)?.map(Number).filter((a) => a <= 17) ?? [];
    if (ages.length) b.childAges = ages;
  } else if (/\bsin (chicos|nenes|hijos)\b|\bsolo adultos\b/.test(t)) b.childAges = [];

  // Duración: "7 noches", "10 días" (9 noches), "una semana", "finde largo".
  const nights = t.match(new RegExp(`${NUM}\\s+noches?`));
  const days = t.match(new RegExp(`${NUM}\\s+dias`));
  const weeks = t.match(new RegExp(`${NUM}\\s+semanas?`));
  if (nights) b.nights = toNum(nights[1]);
  else if (days) b.nights = Math.max(1, toNum(days[1]) - 1);
  else if (weeks) b.nights = toNum(weeks[1]) * 7;
  else if (/\buna semana\b/.test(t)) b.nights = 7;
  else if (/\bfinde( largo)?\b|\bfin de semana\b/.test(t)) b.nights = /largo/.test(t) ? 3 : 2;

  // Cuándo.
  const monthIdx = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`).test(t));
  if (monthIdx >= 0) b.month = monthIdx + 1;
  else if (/vacaciones de invierno/.test(t)) b.month = 7;
  else if (/fin de ano|fiestas/.test(t)) b.month = 12;

  // Destino: el último que nombró del catálogo (por nombre, sin la parte "y ...").
  let found: { d: DestLite; at: number } | null = null;
  for (const d of destinations) {
    const names = [d.name, d.name.split(" y ")[0], d.id.replace(/-/g, " ")].map(normalize).filter((n) => n.length >= 4);
    for (const n of names) {
      const at = t.lastIndexOf(n);
      if (at >= 0 && (!found || at > found.at)) found = { d, at };
    }
  }
  if (found) {
    b.destinationId = found.d.id;
    b.destinationName = found.d.name;
  }

  // Intereses: se suman.
  const ints = new Set(b.interests ?? []);
  for (const [interest, re] of INTEREST_WORDS) if (re.test(t)) ints.add(interest);
  if (ints.size) b.interests = [...ints];

  // Estilo.
  if (/\b(barat[oa]|economic[oa]|gasoler[oa]|low ?cost|ajustad[oa])\b/.test(t)) b.style = "low";
  else if (/\b(lujo|premium|5 estrellas|cinco estrellas)\b/.test(t)) b.style = "high";
  else if (/\bconfort\b|\b4 estrellas\b/.test(t)) b.style = "mid";

  return b;
}

/** Personas que viajan (para pasar un presupuesto por persona a total). */
export const briefPeople = (b: TripBrief, fallbackAdults: number) => (b.adults ?? fallbackAdults) + (b.childAges?.length ?? 0);

/** Presupuesto total, si se puede calcular. */
export function briefBudget(b: TripBrief, fallbackAdults: number): number | undefined {
  if (b.budgetUSD) return b.budgetUSD;
  if (b.budgetPerPersonUSD) return b.budgetPerPersonUSD * briefPeople(b, fallbackAdults);
  return undefined;
}

export type BriefField = "destination" | "budget" | "people" | "nights" | "month" | "interests" | "style";

/** Etiquetas para mostrar el resumen como chips. */
export function briefChips(b: TripBrief): { field: BriefField; label: string }[] {
  const out: { field: BriefField; label: string }[] = [];
  if (b.destinationName) out.push({ field: "destination", label: b.destinationName });
  if (b.budgetUSD) out.push({ field: "budget", label: `USD ${b.budgetUSD.toLocaleString("es-AR")} en total` });
  else if (b.budgetPerPersonUSD) out.push({ field: "budget", label: `USD ${b.budgetPerPersonUSD.toLocaleString("es-AR")} por persona` });
  if (b.adults || b.childAges?.length) {
    const a = b.adults ? `${b.adults} ${b.adults === 1 ? "adulto" : "adultos"}` : "";
    const k = b.childAges?.length ? `${b.childAges.length} ${b.childAges.length === 1 ? "menor" : "menores"} (${b.childAges.join(", ")})` : "";
    out.push({ field: "people", label: [a, k].filter(Boolean).join(" y ") });
  }
  if (b.nights) out.push({ field: "nights", label: `${b.nights} ${b.nights === 1 ? "noche" : "noches"}` });
  if (b.month) out.push({ field: "month", label: MONTH_LABEL[b.month - 1] });
  if (b.style) out.push({ field: "style", label: b.style === "low" ? "Económico" : b.style === "mid" ? "Confort" : "Premium" });
  if (b.interests?.length) out.push({ field: "interests", label: b.interests.map((i) => i.charAt(0).toUpperCase() + i.slice(1)).join(", ") });
  return out;
}

/** Saca un dato del resumen. */
export function clearBriefField(b: TripBrief, field: BriefField): TripBrief {
  const n = { ...b };
  if (field === "destination") delete n.destinationId, delete n.destinationName;
  if (field === "budget") delete n.budgetUSD, delete n.budgetPerPersonUSD;
  if (field === "people") delete n.adults, delete n.childAges;
  if (field === "nights") delete n.nights;
  if (field === "month") delete n.month;
  if (field === "interests") delete n.interests;
  if (field === "style") delete n.style;
  return n;
}

/** Texto para el agente: lo que el usuario ya definió. */
export function briefForAgent(b: TripBrief): string {
  const parts = briefChips(b).map((c) => `- ${c.field === "destination" ? `Destino: ${c.label} (id ${b.destinationId})` : c.label}`);
  return parts.length ? parts.join("\n") : "";
}

export const MONTH_NAMES = MONTH_LABEL;

// ---------------------------------------------------------------------------
// Aprender gustos: cosas que el usuario dijo y conviene guardar en su perfil.
// ---------------------------------------------------------------------------


export interface PrefSuggestion {
  key: string;
  label: string;
  patch: Partial<Profile>;
}

/** Preferencias que aparecen en el mensaje y todavía no están en el perfil. */
export function prefSuggestions(text: string, profile: Profile): PrefSuggestion[] {
  const t = normalize(text);
  const out: PrefSuggestion[] = [];

  const hours = t.match(/(?:no mas de|maximo|hasta)\s+(\d{1,2})\s*(?:h|hs|horas)\s*(?:de vuelo)?/);
  if (hours && /vuelo|volar/.test(t)) {
    const h = Number(hours[1]);
    if (h >= 1 && profile.maxFlightHours !== h) out.push({ key: `hours:${h}`, label: `Vuelos de hasta ${h} horas`, patch: { maxFlightHours: h } });
  }

  const meal: [RegExp, MealPlan, string][] = [
    [/all ?inclusive|todo incluido/, "all", "All inclusive"],
    [/media pension/, "half", "Media pensión"],
    [/con desayuno/, "breakfast", "Con desayuno"],
  ];
  for (const [re, plan, label] of meal) {
    if (re.test(t) && profile.mealPlan !== plan) {
      out.push({ key: `meal:${plan}`, label: `Régimen: ${label}`, patch: { mealPlan: plan } });
      break;
    }
  }

  if (/frente al mar|sobre la playa|vista al mar/.test(t) && !profile.beachfront) {
    out.push({ key: "beachfront", label: "Alojamiento frente al mar", patch: { beachfront: true } });
  }

  const said = updateBrief({}, text, []);
  const newInterests = (said.interests ?? []).filter((i) => !profile.interests.includes(i));
  if (newInterests.length) {
    out.push({
      key: `interests:${newInterests.join(",")}`,
      label: `Te gusta: ${newInterests.map((i) => i.charAt(0).toUpperCase() + i.slice(1)).join(", ")}`,
      patch: { interests: [...profile.interests, ...newInterests] },
    });
  }
  if (said.style && said.style !== profile.style) {
    out.push({ key: `style:${said.style}`, label: `Estilo ${said.style === "low" ? "económico" : said.style === "mid" ? "confort" : "premium"}`, patch: { style: said.style } });
  }
  if (said.adults && said.adults !== profile.travelers) {
    out.push({ key: `adults:${said.adults}`, label: `Viajan ${said.adults} ${said.adults === 1 ? "adulto" : "adultos"}`, patch: { travelers: said.adults } });
  }
  if (said.childAges?.length && said.childAges.join() !== (profile.childAges ?? []).join()) {
    out.push({ key: `kids:${said.childAges.join(",")}`, label: `Menores de ${said.childAges.join(", ")} años`, patch: { childAges: said.childAges } });
  }
  return out;
}
