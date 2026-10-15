import type { ChecklistItem, DayActivity, TripPackage } from "./types.ts";

// Presupuesto día por día y checklist de un viaje guardado (Mis viajes).
// Se arma solo con los montos del paquete: nada inventado.

export interface PlanDay {
  /** 1 = día de salida. */
  n: number;
  date: string;
  kind: "ida" | "destino" | "vuelta" | "ida-vuelta";
  title: string;
  /** Qué hacer ese día, si se armó con Trippy. */
  activity?: string;
  /** Alojamiento de esa noche (0 el día de la vuelta). */
  lodgingUSD: number;
  /** Comidas, traslados y actividades del día; null si el paquete no los incluye. */
  spendUSD: number | null;
  totalUSD: number;
}

export interface DayPlan {
  days: PlanDay[];
  nights: number;
  lodgingPerNightUSD: number;
  spendPerDayUSD: number | null;
  /** Lo que se paga antes de viajar (vuelos y extras), fuera del día a día. */
  upfrontUSD: number;
}

const DAY = 86_400_000;
const toTime = (iso: string) => Date.parse(`${String(iso ?? "").slice(0, 10)}T12:00:00Z`);
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const sumKind = (p: TripPackage, kind: TripPackage["items"][number]["kind"]) =>
  p.items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amountUSD, 0);

/** Plan de cada día entre la salida y la vuelta. null si las fechas no sirven. */
export function dayPlan(p: TripPackage): DayPlan | null {
  const from = toTime(p.departDate);
  const to = toTime(p.returnDate);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  const nights = Math.min(90, Math.round((to - from) / DAY));
  const count = nights + 1;

  const lodging = sumKind(p, "alojamiento");
  const hasSpend = p.items.some((i) => i.kind === "gastos");
  const lodgingPerNight = nights > 0 ? lodging / nights : 0;
  const spendPerDay = hasSpend ? sumKind(p, "gastos") / count : null;
  const upfront = sumKind(p, "vuelo") + sumKind(p, "extra") + (nights > 0 ? 0 : lodging);

  const days: PlanDay[] = Array.from({ length: count }, (_, i) => {
    const last = i === count - 1;
    const kind: PlanDay["kind"] = count === 1 ? "ida-vuelta" : i === 0 ? "ida" : last ? "vuelta" : "destino";
    const title =
      kind === "ida-vuelta"
        ? "Ida y vuelta en el día"
        : kind === "ida"
          ? `Viaje a ${p.destinationName}`
          : kind === "vuelta"
            ? "Vuelta a casa"
            : `Día en ${p.destinationName}`;
    const lodgingUSD = last ? 0 : Math.round(lodgingPerNight);
    const spendUSD = spendPerDay == null ? null : Math.round(spendPerDay);
    const activity = p.activities?.find((a) => a.day === i + 1)?.title;
    return { n: i + 1, date: isoOf(from + i * DAY), kind, title, ...(activity ? { activity } : {}), lodgingUSD, spendUSD, totalUSD: lodgingUSD + (spendUSD ?? 0) };
  });

  return {
    days,
    nights,
    lodgingPerNightUSD: Math.round(lodgingPerNight),
    spendPerDayUSD: spendPerDay == null ? null : Math.round(spendPerDay),
    upfrontUSD: Math.round(upfront),
  };
}

const DEFAULTS: { id: string; label: string; abroadOnly?: boolean }[] = [
  { id: "doc", label: "Pasaporte o DNI vigente" },
  { id: "vuelo", label: "Reservar vuelo" },
  { id: "alojamiento", label: "Reservar alojamiento" },
  { id: "seguro", label: "Seguro de viaje" },
  { id: "checkin", label: "Check-in online (24–48 h antes)" },
  { id: "banco", label: "Avisar al banco / tarjeta para usar en el exterior", abroadOnly: true },
  { id: "datos", label: "Chip de datos o roaming", abroadOnly: true },
];

/** Tareas sugeridas antes de viajar. Dentro del país se omiten las del exterior. */
export function defaultChecklist(abroad = true): ChecklistItem[] {
  return DEFAULTS.filter((d) => abroad || !d.abroadOnly).map(({ id, label }) => ({ id, label, done: false }));
}

export const checklistProgress = (list: ChecklistItem[]) => ({ done: list.filter((t) => t.done).length, total: list.length });

/**
 * Itinerario escrito por Trippy: una línea por día que empieza con "Día N".
 * Devuelve null si no hay al menos dos días.
 */
const DAY_LINE = /^d[ií]a\s+(\d{1,2})\s*(?:\([^)]*\))?\s*[:.\-–—]\s*(.+)$/i;
const cleanLine = (raw: string) => raw.replace(/^[\s*•\-#>]+/, "").replace(/\*\*/g, "").trim();

export function parseItinerary(text: string): DayActivity[] | null {
  const out = new Map<number, string>();
  for (const raw of text.split("\n")) {
    const line = cleanLine(raw);
    const m = line.match(DAY_LINE);
    if (!m) continue;
    const day = Number(m[1]);
    if (day >= 1 && day <= 60 && !out.has(day)) out.set(day, m[2].trim().slice(0, 200));
  }
  if (out.size < 2) return null;
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([day, title]) => ({ day, title }));
}

/** El texto sin las líneas de días (cuando los días se muestran como lista aparte). */
export const withoutDayLines = (text: string) =>
  text
    .split("\n")
    .filter((l) => !DAY_LINE.test(cleanLine(l)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
