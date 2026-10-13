import type { Context, Next } from "hono";
import { loadJSON, saveJSON } from "./cache.ts";
import type { Env } from "./env.ts";

// Acceso con usuario y contraseña (una cuenta, definida con secrets de
// Cloudflare: APP_USER y APP_PASSWORD). La sesión es una cookie firmada con
// HMAC; si cambiás la contraseña, se cierran todas las sesiones.

const COOKIE = "fmt_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export const authRequired = (env: Env) => Boolean(env.APP_USER?.trim() && env.APP_PASSWORD);

async function sha256(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** Comparación en tiempo constante (sobre hashes del mismo largo). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function checkCredentials(env: Env, user: string, password: string): Promise<boolean> {
  if (!authRequired(env)) return false;
  const [u1, u2, p1, p2] = await Promise.all([
    sha256(user.trim().toLowerCase()),
    sha256(env.APP_USER!.trim().toLowerCase()),
    sha256(password),
    sha256(env.APP_PASSWORD!),
  ]);
  // Evaluamos ambas comparaciones siempre, para no filtrar cuál falló.
  const okUser = sameBytes(u1, u2);
  const okPass = sameBytes(p1, p2);
  return okUser && okPass;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  const secret = await sha256(`findmytrip-session:${env.APP_USER}:${env.APP_PASSWORD}`);
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(env: Env, user: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ u: user.trim().toLowerCase(), exp: Date.now() + SESSION_DAYS * 86400000 })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function readSession(env: Env, token: string | undefined): Promise<string | null> {
  if (!token || !authRequired(env)) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const sigBytes = Uint8Array.from(fromB64url(sig), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), sigBytes, enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(fromB64url(payload)) as { u: string; exp: number };
    return data.exp > Date.now() ? data.u : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}
export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
export function cookieToken(header: string | undefined): string | undefined {
  return header
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
}

// Freno contra intentos repetidos: 5 fallos seguidos bloquean 15 minutos por IP.
interface Fails {
  n: number;
  until?: number;
}
export async function loginLocked(ip: string): Promise<number> {
  const f = await loadJSON<Fails>(`auth:fails:${ip}`);
  return f?.until && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
export async function registerFail(ip: string): Promise<void> {
  const f = (await loadJSON<Fails>(`auth:fails:${ip}`)) ?? { n: 0 };
  const n = f.until && f.until < Date.now() ? 1 : f.n + 1;
  await saveJSON(`auth:fails:${ip}`, n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MINUTES * 60000 } : { n });
}
export const clearFails = (ip: string) => saveJSON(`auth:fails:${ip}`, { n: 0 });

/** Rutas de la API que no piden sesión. */
const PUBLIC = new Set(["/api/login", "/api/logout", "/api/session"]);

export function requireAuth(getEnv: (c: Context) => Env) {
  return async (c: Context, next: Next) => {
    const env = getEnv(c);
    if (!authRequired(env) || PUBLIC.has(new URL(c.req.url).pathname)) return next();
    const user = await readSession(env, cookieToken(c.req.header("Cookie")));
    if (!user) return c.json({ error: "Iniciá sesión para continuar.", auth: true }, 401);
    c.set("user" as never, user as never);
    return next();
  };
}
