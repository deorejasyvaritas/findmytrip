import type { Context, Next } from "hono";
import { loadJSON, saveJSON } from "./cache.ts";

// Cuentas con usuario y contraseña, creadas desde el sitio.
// - La primera cuenta que se registra es la dueña del sitio.
// - Después, el registro queda cerrado salvo que la dueña lo habilite.
// - Contraseñas guardadas con PBKDF2-SHA256 y sal aleatoria (nunca en texto).
// - Sesión en una cookie firmada con HMAC (clave aleatoria guardada en KV).

const COOKIE = "fmt_session";
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
// Iteraciones moderadas: el plan gratuito de Workers limita el CPU por pedido.
const PBKDF2_ITERATIONS = 10_000;

export interface Account {
  user: string;
  hash: string;
  salt: string;
  iterations: number;
  role: "owner" | "member";
  createdAt: string;
}

interface AuthSettings {
  openSignup: boolean;
}

const enc = new TextEncoder();
const toB64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const randomB64 = (n: number) => toB64(crypto.getRandomValues(new Uint8Array(n)));

export const normalizeUser = (u: string) => u.trim().toLowerCase();
export const validUser = (u: string) => /^[a-z0-9._-]{3,30}$/.test(u);

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

export const listUsers = async () => (await loadJSON<string[]>("auth:users")) ?? [];
export const getAccount = (user: string) => loadJSON<Account>(`auth:user:${normalizeUser(user)}`);
export const getAuthSettings = async () => (await loadJSON<AuthSettings>("auth:settings")) ?? { openSignup: false };
export const saveAuthSettings = (s: AuthSettings) => saveJSON("auth:settings", s);

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Puede registrarse alguien nuevo: si no hay cuentas, o si la dueña lo habilitó. */
export async function signupOpen(): Promise<boolean> {
  return (await listUsers()).length === 0 || (await getAuthSettings()).openSignup;
}

export async function createAccount(rawUser: string, password: string): Promise<Account> {
  const user = normalizeUser(rawUser);
  const users = await listUsers();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const account: Account = {
    user,
    salt: toB64(salt),
    hash: toB64(await derive(password, salt, PBKDF2_ITERATIONS)),
    iterations: PBKDF2_ITERATIONS,
    role: users.length === 0 ? "owner" : "member",
    createdAt: new Date().toISOString(),
  };
  await saveJSON(`auth:user:${user}`, account);
  await saveJSON("auth:users", [...users, user]);
  return account;
}

export async function verifyPassword(rawUser: string, password: string): Promise<Account | null> {
  const account = await getAccount(rawUser);
  // Si el usuario no existe, igual calculamos un hash para no revelar cuáles existen.
  const salt = account ? fromB64(account.salt) : new Uint8Array(16);
  const hash = await derive(password, salt, account?.iterations ?? PBKDF2_ITERATIONS);
  return account && sameBytes(hash, fromB64(account.hash)) ? account : null;
}

export async function changePassword(user: string, password: string): Promise<void> {
  const account = await getAccount(user);
  if (!account) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await saveJSON(`auth:user:${account.user}`, {
    ...account,
    salt: toB64(salt),
    hash: toB64(await derive(password, salt, PBKDF2_ITERATIONS)),
    iterations: PBKDF2_ITERATIONS,
  });
}

// ---------------------------------------------------------------------------
// Sesión (cookie firmada)
// ---------------------------------------------------------------------------

async function hmacKey(): Promise<CryptoKey> {
  let secret = await loadJSON<string>("auth:secret");
  if (!secret) {
    secret = randomB64(32);
    await saveJSON("auth:secret", secret);
  }
  return crypto.subtle.importKey("raw", fromB64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSession(account: Account): Promise<string> {
  // La firma incluye un pedazo del hash: si cambiás la contraseña, se cierran las sesiones viejas.
  const payload = toB64(enc.encode(JSON.stringify({ u: account.user, h: account.hash.slice(0, 8), exp: Date.now() + SESSION_DAYS * 86400000 })));
  const sig = toB64(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload))));
  return `${payload}.${sig}`;
}

export async function readSession(token: string | undefined): Promise<Account | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(), fromB64(sig), enc.encode(payload)))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64(payload))) as { u: string; h: string; exp: number };
    if (data.exp < Date.now()) return null;
    const account = await getAccount(data.u);
    return account && account.hash.slice(0, 8) === data.h ? account : null;
  } catch {
    return null;
  }
}

export const sessionCookie = (token: string, secure: boolean) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
export const cookieToken = (header: string | undefined) =>
  header
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

// ---------------------------------------------------------------------------
// Freno contra intentos repetidos: 5 fallos seguidos bloquean 15 min por IP.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Middleware: toda la API pide sesión salvo el ingreso y el registro.
// ---------------------------------------------------------------------------

const PUBLIC = new Set(["/api/login", "/api/logout", "/api/session", "/api/register"]);
// Prefijos públicos solo para leer: los viajes compartidos por link.
// También la vista previa de una invitación a un viaje (sumarse sí pide sesión).
const PUBLIC_GET_PREFIXES = ["/api/share/", "/api/invite/"];

export const isPublic = (method: string, path: string) =>
  PUBLIC.has(path) || (method === "GET" && PUBLIC_GET_PREFIXES.some((p) => path.startsWith(p) && path.length > p.length));

export async function requireAuth(c: Context, next: Next) {
  if (isPublic(c.req.method, new URL(c.req.url).pathname)) return next();
  const account = await readSession(cookieToken(c.req.header("Cookie")));
  if (!account) return c.json({ error: "Iniciá sesión para continuar.", auth: true }, 401);
  c.set("user" as never, account.user as never);
  c.set("role" as never, account.role as never);
  return next();
}
