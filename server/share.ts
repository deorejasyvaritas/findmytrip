import type { PackageItem, SharedTrip, TripPackage } from "../shared/types.ts";

// Viajes compartidos por link: una copia de solo lectura del paquete, guardada
// en KV con un id aleatorio imposible de adivinar. No incluye notas ni checklist
// (pueden ser datos personales): solo lo necesario para mostrar el viaje.

const ID_BYTES = 18; // 144 bits: 24 caracteres en base64url

export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const validShareId = (id: string) => /^[A-Za-z0-9_-]{22,64}$/.test(id);

export const shareKey = (id: string) => `share:${id}`;
export const userSharesKey = (user: string) => `user:${user}:shares`;
export const sharePath = (id: string) => `/v/${id}`;

/** Lo que se guarda en KV para cada link compartido. */
export interface ShareRecord {
  id: string;
  user: string;
  packageId: string;
  createdAt: string;
  updatedAt: string;
  trip: SharedTrip;
}

const KINDS = new Set<PackageItem["kind"]>(["vuelo", "alojamiento", "gastos", "extra"]);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
/** Solo links web: nada de javascript: ni otros esquemas en una página pública. */
function safeLink(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 2000) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Arma la copia pública del viaje a partir de lo que manda el cliente.
 * Descarta campos desconocidos y valida cada dato; null si no sirve.
 */
export function shareSnapshot(raw: unknown): SharedTrip | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<TripPackage>;
  const destinationName = text(p.destinationName, 120);
  if (!destinationName || !Array.isArray(p.items)) return null;
  const items: PackageItem[] = [];
  for (const i of p.items.slice(0, 30)) {
    if (!i || typeof i !== "object" || !KINDS.has(i.kind)) continue;
    const amountUSD = money(i.amountUSD);
    const label = text(i.label, 160);
    if (amountUSD == null || !label) continue;
    const link = safeLink(i.link);
    items.push({ kind: i.kind, label, amountUSD, ...(link ? { link } : {}) });
  }
  if (!items.length) return null;
  const travelers = Math.min(12, Math.max(1, Math.round(Number(p.travelers) || 1)));
  const totalUSD = money(p.totalUSD) ?? items.reduce((s, i) => s + i.amountUSD, 0);
  return {
    destinationId: text(p.destinationId, 60),
    destinationName,
    origin: text(p.origin, 3),
    departDate: isoDate(p.departDate),
    returnDate: isoDate(p.returnDate),
    travelers,
    style: p.style === "low" || p.style === "high" ? p.style : "mid",
    items,
    totalUSD,
  };
}
