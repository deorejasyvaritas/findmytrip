import { describe, expect, it } from "vitest";
import worker from "../server/index.ts";
import type { Env } from "../server/env.ts";

const env: Env = {};
const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://findmytrip.test${path}`, init), env as never);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });
const cookieOf = (res: Response) => res.headers.get("Set-Cookie")!.split(";")[0];

describe("cuentas creadas desde el sitio", () => {
  it("sin sesión la API responde 401 y la primera visita puede registrarse", async () => {
    expect((await call("/api/destinations")).status).toBe(401);
    expect(await (await call("/api/session")).json()).toMatchObject({ authenticated: false, firstAccount: true, canRegister: true });
  });

  it("valida usuario y contraseña al registrarse", async () => {
    expect((await post("/api/register", { user: "a", password: "12345678" })).status).toBe(400);
    expect((await post("/api/register", { user: "javier", password: "corta" })).status).toBe(400);
  });

  it("la primera cuenta es la dueña y queda con sesión iniciada", async () => {
    const res = await post("/api/register", { user: "Javier", password: "viajar-mucho-2027" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: "javier", role: "owner" });
    const cookie = cookieOf(res);
    expect(res.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect((await call("/api/destinations", { headers: { Cookie: cookie } })).status).toBe(200);

    // Sus datos quedan guardados en el servidor.
    await call("/api/me/data/profile", { method: "PUT", body: JSON.stringify({ name: "Javier" }), headers: { Cookie: cookie } });
    const data = (await (await call("/api/me/data", { headers: { Cookie: cookie } })).json()) as { profile: { name: string } };
    expect(data.profile.name).toBe("Javier");
  });

  it("después de la primera cuenta, el registro queda cerrado salvo que la dueña lo abra", async () => {
    expect((await post("/api/register", { user: "otra", password: "12345678" })).status).toBe(403);
    const owner = cookieOf(await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, { "CF-Connecting-IP": "1.1.1.1" }));
    await call("/api/account/settings", { method: "PUT", body: JSON.stringify({ openSignup: true }), headers: { Cookie: owner } });
    const res = await post("/api/register", { user: "maria", password: "12345678" });
    expect(await res.json()).toMatchObject({ user: "maria", role: "member" });
    // Una cuenta común no puede cambiar la configuración del registro.
    const member = cookieOf(res);
    expect((await call("/api/account/settings", { method: "PUT", body: JSON.stringify({ openSignup: false }), headers: { Cookie: member } })).status).toBe(403);
    // Cada cuenta ve solo sus datos.
    const data = (await (await call("/api/me/data", { headers: { Cookie: member } })).json()) as { profile: unknown };
    expect(data.profile).toBeNull();
  });

  it("cambiar la contraseña cierra las sesiones anteriores", async () => {
    const old = cookieOf(await post("/api/login", { user: "maria", password: "12345678" }, { "CF-Connecting-IP": "3.3.3.3" }));
    const res = await call("/api/account/password", {
      method: "POST",
      body: JSON.stringify({ current: "12345678", password: "nueva-clave-99" }),
      headers: { Cookie: old, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect((await call("/api/destinations", { headers: { Cookie: old } })).status).toBe(401);
    expect((await call("/api/destinations", { headers: { Cookie: cookieOf(res) } })).status).toBe(200);
  });

  it("una cookie alterada no sirve", async () => {
    const token = cookieOf(await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, { "CF-Connecting-IP": "2.2.2.2" }));
    expect((await call("/api/destinations", { headers: { Cookie: `${token.slice(0, -3)}abc` } })).status).toBe(401);
  });

  it("bloquea después de 5 intentos fallidos", async () => {
    const ip = { "CF-Connecting-IP": "9.9.9.9" };
    for (let i = 0; i < 5; i++) expect((await post("/api/login", { user: "javier", password: "mal" }, ip)).status).toBe(401);
    expect((await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, ip)).status).toBe(429);
  });
});
