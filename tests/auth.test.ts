import { describe, expect, it } from "vitest";
import worker from "../server/index.ts";
import type { Env } from "../server/env.ts";

const env: Env = { APP_USER: "Javier", APP_PASSWORD: "viajar-mucho-2027" };
const call = (path: string, init?: RequestInit, e: Env = env) =>
  worker.fetch(new Request(`https://findmytrip.test${path}`, init), e as never);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

describe("acceso con usuario y contraseña", () => {
  it("sin sesión la API responde 401, salvo la sesión y el login", async () => {
    expect((await call("/api/destinations")).status).toBe(401);
    expect(await (await call("/api/session")).json()).toEqual({ required: true, authenticated: false, user: null });
  });

  it("login correcto da una cookie que abre la API", async () => {
    const res = await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, { "CF-Connecting-IP": "1.1.1.1" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const token = cookie.split(";")[0];
    expect((await call("/api/destinations", { headers: { Cookie: token } })).status).toBe(200);
    const session = await (await call("/api/session", { headers: { Cookie: token } })).json();
    expect(session).toMatchObject({ authenticated: true, user: "javier" });

    // Los datos del usuario quedan guardados en el servidor.
    await call("/api/me/data/profile", { method: "PUT", body: JSON.stringify({ name: "Javier" }), headers: { Cookie: token } });
    const data = (await (await call("/api/me/data", { headers: { Cookie: token } })).json()) as { profile: { name: string } };
    expect(data.profile.name).toBe("Javier");
  });

  it("una cookie falsificada o de otra contraseña no sirve", async () => {
    const res = await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, { "CF-Connecting-IP": "2.2.2.2" });
    const token = res.headers.get("Set-Cookie")!.split(";")[0];
    const otherEnv = { ...env, APP_PASSWORD: "otra" };
    expect((await call("/api/destinations", { headers: { Cookie: token } }, otherEnv)).status).toBe(401);
    expect((await call("/api/destinations", { headers: { Cookie: `${token.slice(0, -3)}abc` } })).status).toBe(401);
  });

  it("bloquea después de 5 intentos fallidos", async () => {
    const ip = { "CF-Connecting-IP": "9.9.9.9" };
    for (let i = 0; i < 5; i++) expect((await post("/api/login", { user: "javier", password: "mal" }, ip)).status).toBe(401);
    const locked = await post("/api/login", { user: "javier", password: "viajar-mucho-2027" }, ip);
    expect(locked.status).toBe(429);
  });

  it("sin usuario configurado, el sitio queda abierto", async () => {
    expect((await call("/api/destinations", undefined, {})).status).toBe(200);
  });
});
