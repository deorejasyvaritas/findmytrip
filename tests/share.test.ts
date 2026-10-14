import { describe, expect, it } from "vitest";
import worker from "../server/index.ts";
import type { Env } from "../server/env.ts";
import { isPublic } from "../server/auth.ts";
import { newShareId, shareSnapshot, validShareId } from "../server/share.ts";
import { checklistProgress, dayPlan, defaultChecklist } from "../shared/itinerary.ts";
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
    { kind: "vuelo", label: "Vuelo BUE ⇄ BRC", amountUSD: 600, link: "https://www.aviasales.com/search/x" },
    { kind: "alojamiento", label: "Hotel 4 noches", amountUSD: 400, link: "javascript:alert(1)" },
    { kind: "gastos", label: "Comidas y paseos", amountUSD: 500 },
  ],
  totalUSD: 1500,
  notes: "Clave del wifi de casa: 1234",
  createdAt: "2026-10-01T00:00:00Z",
  status: "armando",
  checklist: [{ id: "doc", label: "DNI", done: true }],
};

describe("viajes compartidos: ids y copia pública", () => {
  it("genera ids aleatorios largos en base64url", () => {
    const ids = new Set(Array.from({ length: 50 }, newShareId));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(validShareId(id)).toBe(true);
    }
    expect(validShareId("corto")).toBe(false);
    expect(validShareId("../../auth:secret/aaaaaaaaaaaaaaaa")).toBe(false);
  });

  it("copia solo los datos del viaje, sin notas, checklist ni links peligrosos", () => {
    const s = shareSnapshot({ ...pkg, extra: "x" })!;
    expect(s).not.toHaveProperty("notes");
    expect(s).not.toHaveProperty("checklist");
    expect(s).not.toHaveProperty("id");
    expect(s).not.toHaveProperty("extra");
    expect(s.items[0].link).toBe("https://www.aviasales.com/search/x");
    expect(s.items[1]).not.toHaveProperty("link");
    expect(s).toMatchObject({ destinationName: "Bariloche", travelers: 2, totalUSD: 1500, departDate: "2027-01-10" });
    expect(shareSnapshot({ ...pkg, items: [] })).toBeNull();
    expect(shareSnapshot(null)).toBeNull();
  });

  it("la lectura de /api/share/<id> es pública solo con GET", () => {
    expect(isPublic("GET", "/api/share/abc")).toBe(true);
    expect(isPublic("DELETE", "/api/share/abc")).toBe(false);
    expect(isPublic("POST", "/api/share")).toBe(false);
    expect(isPublic("GET", "/api/share/")).toBe(false);
    expect(isPublic("GET", "/api/me/shares")).toBe(false);
  });
});

const env: Env = {};
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://findmytrip.test${path}`, init), env as never);
const json = (method: string, body: unknown, cookie?: string): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
});
const cookieOf = (res: Response) => res.headers.get("Set-Cookie")!.split(";")[0];

describe("rutas de compartir", () => {
  it("crea el link, se ve sin sesión y solo la dueña lo puede borrar", async () => {
    const owner = cookieOf(await call("/api/register", json("POST", { user: "javier", password: "viajar-mucho-2027" })));
    await call("/api/account/settings", json("PUT", { openSignup: true }, owner));
    const other = cookieOf(await call("/api/register", json("POST", { user: "maria", password: "12345678" })));

    expect((await call("/api/share", json("POST", { package: pkg }))).status).toBe(401);
    const created = (await (await call("/api/share", json("POST", { package: pkg }, owner))).json()) as { id: string; path: string };
    expect(created.path).toBe(`/v/${created.id}`);

    // Volver a compartir el mismo viaje mantiene el link.
    const again = (await (await call("/api/share", json("POST", { package: { ...pkg, totalUSD: 1400 } }, owner))).json()) as { id: string };
    expect(again.id).toBe(created.id);

    const pub = await call(`/api/share/${created.id}`);
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as { trip: { totalUSD: number; notes?: string } };
    expect(body.trip.totalUSD).toBe(1400);
    expect(body.trip.notes).toBeUndefined();

    const mine = (await (await call("/api/me/shares", { headers: { Cookie: owner } })).json()) as { shares: Record<string, string> };
    expect(mine.shares).toEqual({ pkg_1: created.id });

    expect((await call(`/api/share/${created.id}`, { method: "DELETE" })).status).toBe(401);
    expect((await call(`/api/share/${created.id}`, { method: "DELETE", headers: { Cookie: other } })).status).toBe(403);
    expect((await call(`/api/share/${created.id}`, { method: "DELETE", headers: { Cookie: owner } })).status).toBe(200);
    expect((await call(`/api/share/${created.id}`)).status).toBe(404);
    expect((await call("/api/share/no-existe")).status).toBe(404);
  });
});

describe("día por día y checklist", () => {
  it("reparte alojamiento por noche y gastos por día", () => {
    const plan = dayPlan(pkg)!;
    expect(plan.nights).toBe(4);
    expect(plan.days.map((d) => d.kind)).toEqual(["ida", "destino", "destino", "destino", "vuelta"]);
    expect(plan.days[0].date).toBe("2027-01-10");
    expect(plan.days[4].date).toBe("2027-01-14");
    expect(plan.lodgingPerNightUSD).toBe(100);
    expect(plan.spendPerDayUSD).toBe(100);
    expect(plan.days[4]).toMatchObject({ lodgingUSD: 0, spendUSD: 100, totalUSD: 100 });
    expect(plan.upfrontUSD).toBe(600);
  });

  it("sin gastos en el paquete lo dice en vez de inventar", () => {
    const plan = dayPlan({ ...pkg, items: pkg.items.filter((i) => i.kind !== "gastos") })!;
    expect(plan.spendPerDayUSD).toBeNull();
    expect(plan.days[1].spendUSD).toBeNull();
    expect(dayPlan({ ...pkg, departDate: "" })).toBeNull();
  });

  it("checklist sugerida según el destino y progreso", () => {
    expect(defaultChecklist(true)).toHaveLength(7);
    expect(defaultChecklist(false).some((t) => t.id === "banco")).toBe(false);
    const list = defaultChecklist().map((t, i) => ({ ...t, done: i < 3 }));
    expect(checklistProgress(list)).toEqual({ done: 3, total: 7 });
  });
});
