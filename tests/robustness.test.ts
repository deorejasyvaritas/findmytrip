import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../server/index.ts";
import type { Env } from "../server/env.ts";
import { edgeCached, loadJSON, loadJSONStrict, StorageError, useCacheStore, type KVStore } from "../server/cache.ts";
import { forgetSessionSecret } from "../server/auth.ts";
import { MAX_TOOL_CALLS, TOOL_LIMIT_MSG, withBudget } from "../server/agent.ts";
import { monthsToSweep, runRadar } from "../server/radar.ts";
import { z } from "zod";

/** KV simulado al que se le puede cortar la lectura o la escritura. */
function fakeKV() {
  const data = new Map<string, string>();
  const state = { failGet: false, failPut: false };
  const kv: KVStore & { data: Map<string, string>; state: typeof state } = {
    data,
    state,
    get: async (k) => {
      if (state.failGet) throw new Error("KV caído");
      return data.has(k) ? JSON.parse(data.get(k)!) : null;
    },
    put: vi.fn(async (k: string, v: string) => {
      if (state.failPut) throw new Error("KV put() limit exceeded for the day");
      data.set(k, v);
    }),
    delete: async (k) => void data.delete(k),
  };
  return kv;
}

const kv = fakeKV();
const env: Env = { CACHE: kv };
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://findmytrip.test${path}`, init), env as never);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
const cookieOf = (res: Response) => res.headers.get("Set-Cookie")!.split(";")[0];

afterEach(() => {
  kv.state.failGet = false;
  kv.state.failPut = false;
  vi.unstubAllGlobals();
});

describe("lectura estricta de KV", () => {
  it("distingue 'no existe' de 'no se pudo leer'", async () => {
    useCacheStore(kv);
    expect(await loadJSONStrict("nada")).toBeNull();
    kv.state.failGet = true;
    await expect(loadJSONStrict("nada")).rejects.toBeInstanceOf(StorageError);
    expect(await loadJSON("nada")).toBeNull(); // la lectura común sigue siendo tolerante
    useCacheStore(undefined);
  });
});

describe("cuentas con KV inestable", () => {
  let owner = "";

  it("registra la dueña", async () => {
    const res = await post("/api/register", { user: "javier", password: "viajar-mucho-2027" });
    expect(res.status).toBe(200);
    owner = cookieOf(res);
    expect(kv.data.has("auth:secret")).toBe(true);
  });

  it("si KV no responde, no reabre el registro ni inventa otra clave de sesión", async () => {
    const secret = kv.data.get("auth:secret");
    forgetSessionSecret();
    kv.state.failGet = true;
    expect((await call("/api/session")).status).toBe(503);
    expect((await call("/api/destinations", { headers: { Cookie: owner } })).status).toBe(503);
    expect((await post("/api/register", { user: "intrusa", password: "12345678" })).status).toBe(503);
    kv.state.failGet = false;
    expect(kv.data.get("auth:secret")).toBe(secret);
    expect(JSON.parse(kv.data.get("auth:users")!)).toEqual(["javier"]);
    // Vuelve KV: la sesión de antes sigue sirviendo.
    expect((await call("/api/destinations", { headers: { Cookie: owner } })).status).toBe(200);
    expect(await (await call("/api/session")).json()).toMatchObject({ canRegister: false });
  });

  it("sin cuota de escritura: los fallos de ingreso no rompen y guardar datos da un error claro", async () => {
    kv.state.failPut = true;
    const bad = await post("/api/login", { user: "javier", password: "mal" }, { "CF-Connecting-IP": "5.5.5.5" });
    expect(bad.status).toBe(401);
    const res = await call("/api/me/data/profile", { method: "PUT", body: JSON.stringify({ name: "x" }), headers: { Cookie: owner } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("Probá de nuevo");
  });

  it("los fallos de ingreso no escriben en KV hasta el bloqueo", async () => {
    const ip = { "CF-Connecting-IP": "6.6.6.6" };
    const before = vi.mocked(kv.put).mock.calls.length;
    for (let i = 0; i < 4; i++) await post("/api/login", { user: "javier", password: "mal" }, ip);
    expect(vi.mocked(kv.put).mock.calls.length).toBe(before);
    await post("/api/login", { user: "javier", password: "mal" }, ip);
    expect(vi.mocked(kv.put).mock.calls.slice(before).map((c) => c[0])).toEqual(["auth:lock:login:6.6.6.6:javier"]);
    expect((await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, ip)).status).toBe(429);
    // Otro usuario desde la misma IP todavía puede intentar.
    expect((await post("/api/login", { user: "otro", password: "mal" }, ip)).status).toBe(401);
  });

  it("un cuerpo que no es JSON da 400, no 500", async () => {
    expect((await post("/api/login", "{no es json", { "CF-Connecting-IP": "7.7.7.7" })).status).toBe(400);
  });

  it("limita los intentos de cambio de contraseña", async () => {
    const ip = { "CF-Connecting-IP": "8.8.8.8" };
    const change = () =>
      call("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ current: "mal-mal-mal", password: "otra-clave-123" }),
        headers: { Cookie: owner, "Content-Type": "application/json", ...ip },
      });
    for (let i = 0; i < 5; i++) expect((await change()).status).toBe(400);
    expect((await change()).status).toBe(429);
  });

  it("cerrar sesión revoca la cookie en el servidor", async () => {
    const cookie = cookieOf(await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, { "CF-Connecting-IP": "4.4.4.4" }));
    expect((await call("/api/destinations", { headers: { Cookie: cookie } })).status).toBe(200);
    await call("/api/logout", { method: "POST", headers: { Cookie: cookie } });
    expect((await call("/api/destinations", { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await call("/api/destinations", { headers: { Cookie: owner } })).status).toBe(401);
  });
});

describe("caché de borde", () => {
  it("sin Cache API (local) usa la memoria y no escribe en KV", async () => {
    useCacheStore(kv);
    const before = vi.mocked(kv.put).mock.calls.length;
    const load = vi.fn(async () => ["Río"]);
    expect(await edgeCached("places:rio", 60, load)).toEqual(["Río"]);
    expect(await edgeCached("places:rio", 60, load)).toEqual(["Río"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.mocked(kv.put).mock.calls.length).toBe(before);
    useCacheStore(undefined);
  });

  it("usa caches.default cuando existe", async () => {
    const stored = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        match: async (r: Request) => stored.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void stored.set(r.url, res),
      },
    });
    await edgeCached("xr:hotel-1", 60, async () => ({ nightly: 90 }));
    expect([...stored.keys()][0]).toContain("xr%3Ahotel-1");
    expect(stored.values().next().value!.headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});

describe("radar por partes", () => {
  it("revisa primero los meses nunca vistos y después los más viejos", () => {
    const window = ["2026-11", "2026-12", "2027-01"];
    expect(monthsToSweep(window, {}, 1)).toEqual(["2026-11"]);
    const store = { "2026-11": { at: "2026-10-13T10:00:00Z", d: {} }, "2026-12": { at: "2026-10-13T09:00:00Z", d: {} } };
    expect(monthsToSweep(window, store, 1)).toEqual(["2027-01"]);
    expect(monthsToSweep(window, { ...store, "2027-01": { at: "2026-10-13T11:00:00Z", d: {} } }, 2)).toEqual(["2026-12", "2026-11"]);
  });

  it("un mes por barrido, combinando con lo guardado", async () => {
    useCacheStore(undefined);
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const month = url.searchParams.get("depart_date")!;
        asked.push(month);
        const price = month === "2026-11" ? 300 : 280;
        return Response.json({ success: true, data: { MCZ: { "0": { price, departure_at: `${month}-14T08:00:00-03:00` } } } });
      }),
    );
    const now = new Date("2026-10-13T12:00:00Z");
    const a = await runRadar("tok", "COR", now);
    expect(asked).toEqual(["2026-10"]);
    const b = await runRadar("tok", "COR", new Date(now.getTime() + 3600000));
    expect(asked).toEqual(["2026-10", "2026-11"]);
    expect(Object.keys(b.byMonth.maceio)).toEqual(["2026-10", "2026-11"]);
    expect(a.items.find((i) => i.destinationId === "maceio")?.priceUSD).toBe(280);
    expect(b.items.find((i) => i.destinationId === "maceio")?.priceUSD).toBe(280);
  });

  it("solo las ciudades de RADAR_ORIGINS pueden disparar un barrido", async () => {
    const fn = vi.fn(async () => Response.json({ success: true, data: {} }));
    vi.stubGlobal("fetch", fn);
    kv.data.delete("auth:lock:login:3.3.3.3:javier");
    const cookie = cookieOf(await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, { "CF-Connecting-IP": "3.3.3.3" }));
    const radarEnv: Env = { ...env, TRAVELPAYOUTS_TOKEN: "tok", RADAR_ORIGINS: "BUE" };
    const res = await worker.fetch(new Request("https://findmytrip.test/api/radar?origin=XYZ", { headers: { Cookie: cookie } }), radarEnv as never);
    expect(res.status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("agente", () => {
  it("corta las herramientas al pasar el tope de consultas", async () => {
    const run = vi.fn(async () => "ok");
    const [explorar, otra] = withBudget([
      { name: "explorar_destinos", description: "", inputSchema: z.object({}), run },
      { name: "alojamiento", description: "", inputSchema: z.object({}), run },
    ]);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await explorar.run({}));
    expect(results.filter((r) => r === "ok")).toHaveLength(2); // 2 × 10 subpedidos entran en el presupuesto
    expect(results[3]).toBe(TOOL_LIMIT_MSG);
    for (let i = 0; i < MAX_TOOL_CALLS; i++) await otra.run({});
    expect(run).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
  });
});
