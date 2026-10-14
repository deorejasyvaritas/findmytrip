import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import type { Env } from "../server/env.ts";
import { isPublic } from "../server/auth.ts";
import { sanitizeTrip } from "../server/ctrips.ts";
import { mergeChecklist, othersLabel, tripOp, type CTrip } from "../shared/ctrip.ts";
import type { TripPackage } from "../shared/types.ts";

const pkg: TripPackage = {
  id: "pkg_1",
  destinationId: "bariloche",
  destinationName: "Bariloche",
  origin: "BUE",
  departDate: "2027-01-10",
  returnDate: "2027-01-14",
  travelers: 2,
  style: "mid",
  items: [
    { kind: "vuelo", label: "Vuelo BUE-BRC", amountUSD: 600, link: "https://www.aviasales.com/search/x" },
    { kind: "alojamiento", label: "Hotel 4 noches", amountUSD: 400, link: "javascript:alert(1)" },
  ],
  totalUSD: 1000,
  createdAt: "2026-10-01T00:00:00Z",
  status: "armando",
  checklist: [
    { id: "doc", label: "DNI", done: false },
    { id: "seguro", label: "Seguro", done: false },
  ],
};

const env: Env = {};
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://findmytrip.test${path}`, init), env as never);
const req = (method: string, body?: unknown, cookie?: string): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
});
const cookieOf = (res: Response) => res.headers.get("Set-Cookie")!.split(";")[0];
const body = async <T>(res: Response) => (await res.json()) as T;

afterEach(() => {
  vi.useRealTimers();
});

describe("viajes con otros: lógica compartida", () => {
  it("combina cambios de checklist sin pisar lo que hizo otra persona", () => {
    const before = pkg.checklist!;
    // Yo marqué el DNI; mientras, otra persona marcó el seguro y sumó una tarea.
    const mine = before.map((t) => (t.id === "doc" ? { ...t, done: true } : t));
    const server = [...before.map((t) => (t.id === "seguro" ? { ...t, done: true } : t)), { id: "x", label: "Pasaporte", done: false }];
    expect(mergeChecklist(server, before, mine)).toEqual([
      { id: "doc", label: "DNI", done: true },
      { id: "seguro", label: "Seguro", done: true },
      { id: "x", label: "Pasaporte", done: false },
    ]);
    // Borrar y agregar también se re-aplica.
    const removedAdded = [before[1], { id: "n", label: "Adaptador", done: false }];
    expect(mergeChecklist(server, before, removedAdded).map((t) => t.id)).toEqual(["seguro", "x", "n"]);
    const op = tripOp(pkg, { status: "reservado", checklist: mine });
    const applied = op({ ...pkg, checklist: server });
    expect(applied.status).toBe("reservado");
    expect(applied.checklist!.filter((t) => t.done).map((t) => t.id)).toEqual(["doc", "seguro"]);
  });

  it("valida el viaje: solo campos conocidos y links web", () => {
    const t = sanitizeTrip({ ...pkg, notes: "Llevar abrigo", extra: "x", status: "otro" })!;
    expect(t).not.toHaveProperty("extra");
    expect(t.status).toBe("armando");
    expect(t.notes).toBe("Llevar abrigo");
    expect(t.items[1]).not.toHaveProperty("link");
    expect(t.checklist).toHaveLength(2);
    expect(sanitizeTrip({ ...pkg, id: "../x" })).toBeNull();
    expect(sanitizeTrip({ ...pkg, items: [] })).toBeNull();
  });

  it("nombra a los demás integrantes", () => {
    expect(othersLabel(["ana", "beto", "caro"], "ana")).toBe("beto y caro");
    expect(othersLabel(["ana", "beto", "caro", "dani"], "beto")).toBe("ana, caro y dani");
    expect(othersLabel(["ana"], "ana")).toBe("");
  });

  it("solo la vista previa de la invitación es pública", () => {
    expect(isPublic("GET", "/api/invite/abc")).toBe(true);
    expect(isPublic("POST", "/api/invite/abc/join")).toBe(false);
    expect(isPublic("GET", "/api/me/ctrips")).toBe(false);
    expect(isPublic("PUT", "/api/ctrips/abc")).toBe(false);
  });
});

describe("viajes con otros: rutas", () => {
  let owner = "";
  let maria = "";
  let pedro = "";
  let trip: CTrip;

  it("convierte un viaje propio en compartido (una sola vez)", async () => {
    owner = cookieOf(await call("/api/register", req("POST", { user: "javier", password: "viajar-mucho-2027" })));
    expect((await call("/api/ctrips", req("POST", { package: pkg }))).status).toBe(401);
    const res = await call("/api/ctrips", req("POST", { package: pkg }, owner));
    expect(res.status).toBe(200);
    trip = (await body<{ trip: CTrip }>(res)).trip;
    expect(trip).toMatchObject({ owner: "javier", members: ["javier"], version: 1 });
    const again = (await body<{ trip: CTrip }>(await call("/api/ctrips", req("POST", { package: pkg }, owner)))).trip;
    expect(again.id).toBe(trip.id);
  });

  it("la invitación habilita una cuenta nueva con el registro cerrado y se gasta", async () => {
    // Registro cerrado sin invitación.
    expect((await call("/api/register", req("POST", { user: "maria", password: "12345678" }))).status).toBe(403);
    const inv = await body<{ id: string; path: string; expiresAt: string }>(await call(`/api/ctrips/${trip.id}/invite`, req("POST", undefined, owner)));
    expect(inv.path).toBe(`/unirme/${inv.id}`);

    // Vista previa sin sesión: datos mínimos.
    const prev = await call(`/api/invite/${inv.id}`);
    expect(prev.status).toBe(200);
    const { invite } = await body<{ invite: Record<string, unknown> }>(prev);
    expect(invite).toMatchObject({ destinationName: "Bariloche", by: "javier", totalUSD: 1000 });
    expect(invite).not.toHaveProperty("checklist");
    expect(invite).not.toHaveProperty("items");

    const reg = await call("/api/register", req("POST", { user: "maria", password: "12345678", invite: inv.id }));
    expect(reg.status).toBe(200);
    maria = cookieOf(reg);
    const list = await body<{ trips: CTrip[] }>(await call("/api/me/ctrips", { headers: { Cookie: maria } }));
    expect(list.trips.map((t) => t.id)).toEqual([trip.id]);
    expect(list.trips[0].members).toEqual(["javier", "maria"]);

    // Ya usada: no sirve para otra cuenta ni para sumarse.
    expect((await call(`/api/invite/${inv.id}`)).status).toBe(404);
    expect((await call("/api/register", req("POST", { user: "pedro", password: "12345678", invite: inv.id }))).status).toBe(404);
  });

  it("las invitaciones vencen a los 7 días", async () => {
    const inv = await body<{ id: string }>(await call(`/api/ctrips/${trip.id}/invite`, req("POST", undefined, owner)));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 8 * 86_400_000);
    expect((await call(`/api/invite/${inv.id}`)).status).toBe(410);
    expect((await call("/api/register", req("POST", { user: "pedro", password: "12345678", invite: inv.id }))).status).toBe(410);
  });

  it("solo quien armó el viaje invita; quien no es integrante no ve ni edita", async () => {
    expect((await call(`/api/ctrips/${trip.id}/invite`, req("POST", undefined, maria))).status).toBe(403);
    // Pedro entra con una cuenta común (registro abierto) y se suma con una invitación.
    await call("/api/account/settings", req("PUT", { openSignup: true }, owner));
    pedro = cookieOf(await call("/api/register", req("POST", { user: "pedro", password: "12345678" })));
    expect((await call(`/api/ctrips/${trip.id}`, req("PUT", { version: 1, package: pkg }, pedro))).status).toBe(404);
    expect((await call(`/api/ctrips/${trip.id}`, req("DELETE", undefined, pedro))).status).toBe(404);
    const inv = await body<{ id: string }>(await call(`/api/ctrips/${trip.id}/invite`, req("POST", undefined, owner)));
    const joined = await call(`/api/invite/${inv.id}/join`, req("POST", undefined, pedro));
    expect(joined.status).toBe(200);
    expect((await body<{ trip: CTrip }>(joined)).trip.members).toEqual(["javier", "maria", "pedro"]);
  });

  it("detecta ediciones simultáneas por versión", async () => {
    const edited = { ...pkg, checklist: [{ id: "doc", label: "DNI", done: true }, pkg.checklist![1]] };
    const ok = await call(`/api/ctrips/${trip.id}`, req("PUT", { version: 1, package: edited }, maria));
    expect(ok.status).toBe(200);
    expect((await body<{ trip: CTrip }>(ok)).trip.version).toBe(2);
    // Javier edita sobre la versión 1: recibe 409 con lo último.
    const conflict = await call(`/api/ctrips/${trip.id}`, req("PUT", { version: 1, package: { ...pkg, status: "reservado" } }, owner));
    expect(conflict.status).toBe(409);
    const latest = (await body<{ trip: CTrip }>(conflict)).trip;
    expect(latest.version).toBe(2);
    expect(latest.pkg.checklist![0].done).toBe(true);
    // Re-aplica su cambio sobre lo último y vuelve a intentar.
    const retry = await call(`/api/ctrips/${trip.id}`, req("PUT", { version: 2, package: { ...latest.pkg, status: "reservado" } }, owner));
    expect(retry.status).toBe(200);
    expect((await body<{ trip: CTrip }>(retry)).trip).toMatchObject({ version: 3, pkg: { status: "reservado", id: "pkg_1" } });
  });

  it("cada uno puede irse; solo quien lo armó saca a otros o lo borra", async () => {
    expect((await call(`/api/ctrips/${trip.id}/members/pedro`, req("DELETE", undefined, maria))).status).toBe(403);
    expect((await call(`/api/ctrips/${trip.id}/members/javier`, req("DELETE", undefined, maria))).status).toBe(400);
    expect((await call(`/api/ctrips/${trip.id}/members/maria`, req("DELETE", undefined, maria))).status).toBe(200);
    expect((await body<{ trips: CTrip[] }>(await call("/api/me/ctrips", { headers: { Cookie: maria } }))).trips).toEqual([]);
    expect((await call(`/api/ctrips/${trip.id}`, req("PUT", { version: 3, package: pkg }, maria))).status).toBe(404);

    expect((await call(`/api/ctrips/${trip.id}`, req("DELETE", undefined, pedro))).status).toBe(403);
    expect((await call(`/api/ctrips/${trip.id}/members/pedro`, req("DELETE", undefined, owner))).status).toBe(200);
    expect((await call(`/api/ctrips/${trip.id}`, req("DELETE", undefined, owner))).status).toBe(200);
    expect((await body<{ trips: CTrip[] }>(await call("/api/me/ctrips", { headers: { Cookie: owner } }))).trips).toEqual([]);
  });
});
