import type { ChecklistItem, TripPackage } from "../shared/types.ts";
import type { CTrip, InvitePreview } from "../shared/ctrip.ts";
import { deleteJSON, loadJSON, saveJSON } from "./cache.ts";
import { newShareId, shareSnapshot, validShareId } from "./share.ts";

// Viajes con otros. El viaje vive en un registro compartido `ctrip:<id>` y cada
// integrante guarda solo la lista de ids en `user:<u>:ctrips`. Se entra con una
// invitación de un solo uso que vence a los 7 días.
// Escrituras en KV (plan gratis: 1000 por día): una por cambio agrupado en el
// cliente; las listas por usuario se tocan solo al entrar o salir de un viaje.

export const INVITE_DAYS = 7;
export const MAX_MEMBERS = 12;
const MAX_TRIPS_PER_USER = 50;

export const ctripKey = (id: string) => `ctrip:${id}`;
export const userCtripsKey = (u: string) => `user:${u}:ctrips`;
export const inviteKey = (id: string) => `invite:${id}`;
export const invitePath = (id: string) => `/unirme/${id}`;
export const validId = validShareId;

export interface InviteRecord {
  id: string;
  tripId: string;
  by: string;
  createdAt: string;
  expiresAt: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 403 | 404 | 409 | 410; error: string; trip?: CTrip };

const fail = (status: 400 | 403 | 404 | 409 | 410, error: string, trip?: CTrip): Result<never> => ({ ok: false, status, error, ...(trip ? { trip } : {}) });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const STATUSES = new Set<TripPackage["status"]>(["idea", "armando", "reservado"]);

/**
 * Viaje completo validado campo por campo (como la copia pública de share.ts,
 * más lo que se edita en grupo: estado, notas y checklist). Descarta todo lo demás.
 */
export function sanitizeTrip(raw: unknown): TripPackage | null {
  const base = shareSnapshot(raw);
  if (!base) return null;
  const p = raw as Partial<TripPackage>;
  const id = text(p.id, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  const checklist: ChecklistItem[] | undefined = Array.isArray(p.checklist)
    ? p.checklist
        .slice(0, 60)
        .filter((t) => t && typeof t === "object" && typeof t.id === "string" && typeof t.label === "string")
        .map((t) => ({ id: t.id.slice(0, 40), label: t.label.trim().slice(0, 120), done: Boolean(t.done) }))
        .filter((t) => t.id && t.label)
    : undefined;
  const notes = text(p.notes, 2000);
  const activities = Array.isArray(p.activities)
    ? p.activities
        .slice(0, 60)
        .filter((a) => a && typeof a.day === "number" && typeof a.title === "string")
        .map((a) => ({ day: Math.max(1, Math.min(60, Math.round(a.day))), title: a.title.trim().slice(0, 200) }))
        .filter((a) => a.title)
    : undefined;
  const createdAt = typeof p.createdAt === "string" && !Number.isNaN(Date.parse(p.createdAt)) ? p.createdAt.slice(0, 40) : new Date().toISOString();
  return {
    id,
    ...base,
    status: STATUSES.has(p.status as TripPackage["status"]) ? (p.status as TripPackage["status"]) : "armando",
    createdAt,
    ...(notes ? { notes } : {}),
    ...(checklist ? { checklist } : {}),
    ...(activities?.length ? { activities } : {}),
  };
}

export const getCTrip = async (id: string) => (validId(id) ? await loadJSON<CTrip>(ctripKey(id)) : null);
const userTripIds = async (u: string) => (await loadJSON<string[]>(userCtripsKey(u))) ?? [];

async function addToUser(u: string, id: string): Promise<void> {
  const ids = await userTripIds(u);
  if (!ids.includes(id)) await saveJSON(userCtripsKey(u), [id, ...ids].slice(0, MAX_TRIPS_PER_USER));
}
async function removeFromUser(u: string, id: string): Promise<void> {
  const ids = await userTripIds(u);
  if (ids.includes(id)) await saveJSON(userCtripsKey(u), ids.filter((x) => x !== id));
}

/** Convierte un viaje propio en compartido. Si ya lo era, devuelve el mismo. */
export async function createCTrip(user: string, raw: unknown): Promise<Result<CTrip>> {
  const pkg = sanitizeTrip(raw);
  if (!pkg) return fail(400, "No pudimos compartir este viaje. Revisá que tenga vuelo o alojamiento.");
  const ids = await userTripIds(user);
  for (const id of ids) {
    const t = await loadJSON<CTrip>(ctripKey(id));
    if (t && t.owner === user && t.pkg.id === pkg.id) return ok(t);
  }
  if (ids.length >= MAX_TRIPS_PER_USER) return fail(400, "Llegaste al máximo de viajes compartidos.");
  const now = new Date().toISOString();
  const trip: CTrip = { id: newShareId(), owner: user, members: [user], pkg, version: 1, createdAt: now, updatedAt: now };
  await saveJSON(ctripKey(trip.id), trip);
  await saveJSON(userCtripsKey(user), [trip.id, ...ids]);
  return ok(trip);
}

/** Viajes compartidos de un usuario. Limpia de su lista los que ya no existen o lo sacaron. */
export async function listCTrips(user: string): Promise<CTrip[]> {
  const ids = await userTripIds(user);
  const trips = await Promise.all(ids.map((id) => loadJSON<CTrip>(ctripKey(id))));
  const mine = trips.filter((t): t is CTrip => Boolean(t && t.members.includes(user)));
  if (mine.length !== ids.length) await saveJSON(userCtripsKey(user), mine.map((t) => t.id));
  return mine;
}

/** Guarda una edición si parte de la última versión; si no, 409 con la versión actual. */
export async function updateCTrip(user: string, id: string, version: number, raw: unknown): Promise<Result<CTrip>> {
  const trip = await getCTrip(id);
  if (!trip || !trip.members.includes(user)) return fail(404, "Este viaje ya no está disponible.");
  if (trip.version !== version) return fail(409, "Alguien más cambió el viaje. Traemos lo último.", trip);
  const pkg = sanitizeTrip(raw);
  if (!pkg) return fail(400, "No pudimos guardar el cambio.");
  const next: CTrip = { ...trip, pkg: { ...pkg, id: trip.pkg.id }, version: trip.version + 1, updatedAt: new Date().toISOString() };
  await saveJSON(ctripKey(id), next);
  return ok(next);
}

/** Crea una invitación de un solo uso. Solo quien armó el viaje puede invitar. */
export async function createInvite(user: string, tripId: string): Promise<Result<InviteRecord>> {
  const trip = await getCTrip(tripId);
  if (!trip || !trip.members.includes(user)) return fail(404, "Este viaje ya no está disponible.");
  if (trip.owner !== user) return fail(403, `Solo ${trip.owner} puede invitar a este viaje.`);
  if (trip.members.length >= MAX_MEMBERS) return fail(400, `El viaje ya tiene ${MAX_MEMBERS} integrantes.`);
  const now = Date.now();
  const invite: InviteRecord = {
    id: newShareId(),
    tripId,
    by: user,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_DAYS * 86_400_000).toISOString(),
  };
  await saveJSON(inviteKey(invite.id), invite);
  return ok(invite);
}

/** Invitación vigente y su viaje; si no sirve, el motivo. */
export async function usableInvite(id: string): Promise<Result<{ invite: InviteRecord; trip: CTrip }>> {
  const invite = validId(id) ? await loadJSON<InviteRecord>(inviteKey(id)) : null;
  if (!invite) return fail(404, "Esta invitación ya se usó o no existe. Pedí una nueva.");
  if (Date.parse(invite.expiresAt) < Date.now()) return fail(410, `Esta invitación venció. Pedile a ${invite.by} una nueva.`);
  const trip = await getCTrip(invite.tripId);
  if (!trip) return fail(404, "Este viaje ya no está disponible.");
  return ok({ invite, trip });
}

/** Lo mínimo para mostrar la invitación a alguien sin cuenta. */
export async function invitePreview(id: string): Promise<Result<InvitePreview>> {
  const r = await usableInvite(id);
  if (!r.ok) return r;
  const { invite, trip } = r.value;
  return ok({
    destinationName: trip.pkg.destinationName,
    departDate: trip.pkg.departDate,
    returnDate: trip.pkg.returnDate,
    travelers: trip.pkg.travelers,
    totalUSD: trip.pkg.totalUSD,
    by: invite.by,
    expiresAt: invite.expiresAt,
  });
}

/** Suma al usuario al viaje y gasta la invitación. */
export async function joinWithInvite(user: string, inviteId: string): Promise<Result<CTrip>> {
  const r = await usableInvite(inviteId);
  if (!r.ok) return r;
  const { trip } = r.value;
  if (trip.members.includes(user)) return ok(trip);
  if (trip.members.length >= MAX_MEMBERS) return fail(400, `El viaje ya tiene ${MAX_MEMBERS} integrantes.`);
  // La versión no cambia: cuenta solo las ediciones del viaje (los integrantes se guardan aparte de pkg).
  const next: CTrip = { ...trip, members: [...trip.members, user], updatedAt: new Date().toISOString() };
  await deleteJSON(inviteKey(inviteId));
  await saveJSON(ctripKey(trip.id), next);
  await addToUser(user, trip.id);
  return ok(next);
}

/** Sacar a alguien: cada uno puede irse; solo quien armó el viaje puede sacar a otros. */
export async function removeMember(actor: string, tripId: string, target: string): Promise<Result<CTrip>> {
  const trip = await getCTrip(tripId);
  if (!trip || !trip.members.includes(actor)) return fail(404, "Este viaje ya no está disponible.");
  if (!trip.members.includes(target)) return fail(404, "Esa persona ya no está en el viaje.");
  if (target === trip.owner) return fail(400, "Quien armó el viaje no puede dejarlo: puede borrarlo para todos.");
  if (actor !== target && actor !== trip.owner) return fail(403, `Solo ${trip.owner} puede sacar a alguien del viaje.`);
  const next: CTrip = { ...trip, members: trip.members.filter((m) => m !== target), updatedAt: new Date().toISOString() };
  await saveJSON(ctripKey(tripId), next);
  await removeFromUser(target, tripId);
  return ok(next);
}

/** Borra el viaje para todos. Las listas de los demás se limpian cuando lo abren. */
export async function deleteCTrip(actor: string, tripId: string): Promise<Result<true>> {
  const trip = await getCTrip(tripId);
  if (!trip || !trip.members.includes(actor)) return fail(404, "Este viaje ya no está disponible.");
  if (trip.owner !== actor) return fail(403, `Solo ${trip.owner} puede borrar el viaje.`);
  await deleteJSON(ctripKey(tripId));
  await removeFromUser(actor, tripId);
  return ok(true);
}
