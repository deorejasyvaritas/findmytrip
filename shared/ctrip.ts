import type { ChecklistItem, TripPackage } from "./types.ts";

// Viajes con otros: un viaje guardado que varias cuentas ven y editan.

/** Registro compartido en KV (`ctrip:<id>`). */
export interface CTrip {
  id: string;
  owner: string;
  /** Usuarios que forman parte del viaje (incluye a quien lo armó). */
  members: string[];
  pkg: TripPackage;
  /** Sube con cada cambio: sirve para no pisar lo que editó otra persona. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Lo que ve quien abre una invitación antes de sumarse (sin datos personales). */
export interface InvitePreview {
  destinationName: string;
  departDate: string;
  returnDate: string;
  travelers: number;
  totalUSD: number;
  by: string;
  expiresAt: string;
}

/** Un cambio que se puede volver a aplicar sobre una versión más nueva del viaje. */
export type TripOp = (pkg: TripPackage) => TripPackage;

/**
 * Combina un cambio de checklist hecho sobre `before` (que terminó en `after`)
 * con la lista más nueva `base` del servidor: suma lo agregado, quita lo
 * borrado y marca o desmarca solo lo que se tocó. Así no se pisa lo que
 * cambió otra persona mientras tanto.
 */
export function mergeChecklist(base: ChecklistItem[], before: ChecklistItem[], after: ChecklistItem[]): ChecklistItem[] {
  const beforeById = new Map(before.map((t) => [t.id, t]));
  const afterById = new Map(after.map((t) => [t.id, t]));
  const removed = new Set(before.filter((t) => !afterById.has(t.id)).map((t) => t.id));
  const out = base
    .filter((t) => !removed.has(t.id))
    .map((t) => {
      const prev = beforeById.get(t.id);
      const next = afterById.get(t.id);
      if (!prev || !next) return t;
      return {
        ...t,
        ...(prev.done !== next.done ? { done: next.done } : {}),
        ...(prev.label !== next.label ? { label: next.label } : {}),
      };
    });
  const known = new Set(out.map((t) => t.id));
  for (const t of after) if (!beforeById.has(t.id) && !known.has(t.id)) out.push(t);
  return out;
}

/** Arma la operación re-aplicable para un cambio parcial de un viaje. */
export function tripOp(before: TripPackage, patch: Partial<TripPackage>, fallbackChecklist: ChecklistItem[] = []): TripOp {
  return (pkg) => {
    const next = { ...pkg, ...patch, id: pkg.id };
    if (patch.checklist) {
      const prev = before.checklist ?? fallbackChecklist;
      next.checklist = mergeChecklist(pkg.checklist ?? fallbackChecklist, prev, patch.checklist);
    }
    return next;
  };
}

/** Nombres de los otros integrantes, para "Compartido con …". */
export function othersLabel(members: string[], me: string): string {
  const others = members.filter((m) => m !== me);
  if (!others.length) return "";
  if (others.length === 1) return others[0];
  return `${others.slice(0, -1).join(", ")} y ${others[others.length - 1]}`;
}
