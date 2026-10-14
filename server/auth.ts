import type { Context, Next } from "hono";
import { edgeGet, edgePut, loadJSONStrict, saveJSON, trySaveJSON } from "./cache.ts";

// Cuentas con usuario y contraseña, creadas desde el sitio.
// - La primera cuenta que se registra es la dueña del sitio.
// - Después, el registro queda cerrado salvo que la dueña lo habilite.
// - Contraseñas guardadas con PBKDF2-SHA256 y sal aleatoria (nunca en texto).
// - Sesión en una cookie firmada con HMAC (clave aleatoria guardada en KV).
// - Los datos de cuentas (auth:*) se leen en modo estricto: si KV falla, el
//   pedido falla (StorageError) en vez de tomarlo como "no existe", que antes
//   regeneraba la clave de sesión o reabría el registro.

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
  /** Generación de sesiones: al cerrar sesión sube y las cookies anteriores dejan de valer. */
  gen?: number;
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

export const listUsers = async () => (await loadJSONStrict<string[]>("auth:users")) ?? [];
export const getAccount = (user: string) => loadJSONStrict<Account>(`auth:user:${normalizeUser(user)}`);
export const getAuthSettings = async () => (await loadJSONStrict<AuthSettings>("auth:settings")) ?? { openSignup: false };
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
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = toB64(await derive(password, salt, PBKDF2_ITERATIONS));
  // Releemos la lista justo antes de escribir (después del cálculo lento del
  // hash) y la combinamos: así un registro simultáneo no borra a otro usuario.
  const users = await listUsers();
  const account: Account = {
    user,
    salt: toB64(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
    role: users.filter((u) => u !== user).length === 0 ? "owner" : "member",
    createdAt: new Date().toISOString(),
  };
  await saveJSON(`auth:user:${user}`, account);
  const latest = await listUsers();
  await saveJSON("auth:users", [...new Set([...latest, ...users, user])]);
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

let secretMemo: string | null = null;

async function hmacKey(): Promise<CryptoKey> {
  // Lectura estricta: si KV falla, lanza (no inventamos otra clave, que cerraría todas las sesiones).
  let secret = secretMemo ?? (await loadJSONStrict<string>("auth:secret"));
  if (!secret) {
    secret = randomB64(32);
    await saveJSON("auth:secret", secret);
  }
  secretMemo = secret;
  return crypto.subtle.importKey("raw", fromB64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Solo para tests: olvida la clave en memoria (simula otro Worker). */
export const forgetSessionSecret = () => {
  secretMemo = null;
};

export async function createSession(account: Account): Promise<string> {
  // La firma incluye un pedazo del hash: si cambiás la contraseña, se cierran las sesiones viejas.
  // Y la generación de sesiones: cerrar sesión las revoca en el servidor.
  const payload = toB64(
    enc.encode(JSON.stringify({ u: account.user, h: account.hash.slice(0, 8), g: account.gen ?? 0, exp: Date.now() + SESSION_DAYS * 86400000 })),
  );
  const sig = toB64(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload))));
  return `${payload}.${sig}`;
}

export async function readSession(token: string | undefined): Promise<Account | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let data: { u: string; h: string; g?: number; exp: number };
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(), fromB64(sig), enc.encode(payload)))) return null;
    data = JSON.parse(new TextDecoder().decode(fromB64(payload)));
  } catch (err) {
    // Una falla de KV no es "sesión inválida": que el pedido falle y se reintente.
    if ((err as Error)?.name === "StorageError") throw err;
    return null;
  }
  if (typeof data?.exp !== "number" || data.exp < Date.now() || typeof data.u !== "string") return null;
  const account = await getAccount(data.u);
  return account && account.hash.slice(0, 8) === data.h && (account.gen ?? 0) === (data.g ?? 0) ? account : null;
}

/** Cierra todas las sesiones de la cuenta (1 escritura de KV). */
export async function revokeSessions(account: Account): Promise<void> {
  await saveJSON(`auth:user:${account.user}`, { ...account, gen: (account.gen ?? 0) + 1 });
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
// Freno contra intentos repetidos: 5 fallos seguidos para un mismo usuario
// desde una IP (o 20 desde una IP para cualquier usuario) bloquean 15 min.
// Los contadores van en memoria y en la caché de borde (gratis, sin gastar
// escrituras de KV). Solo el bloqueo se guarda en KV (1 escritura cada 5
// fallos), para que valga en todos los servidores.
// ---------------------------------------------------------------------------

interface Fails {
  n: number;
  until?: number;
}

const MAX_FAILS_PER_IP = 20;
const failKeys = (scope: string, ip: string, user: string) => [
  { key: `${scope}:${ip}:${normalizeUser(user).slice(0, 80)}`, max: MAX_FAILS },
  { key: `${scope}:${ip}`, max: MAX_FAILS_PER_IP },
];
const lockKey = (key: string) => `auth:lock:${key}`;

async function readFails(key: string): Promise<Fails> {
  const f = await edgeGet<Fails>(`fails:${key}`);
  return f && typeof f.n === "number" ? f : { n: 0 };
}

/** Minutos de bloqueo que quedan (0 si puede intentar). */
export async function loginLocked(ip: string, user = "", scope = "login"): Promise<number> {
  const now = Date.now();
  let until = 0;
  for (const { key } of failKeys(scope, ip, user)) {
    const f = await readFails(key);
    if (f.until && f.until > now) until = Math.max(until, f.until);
  }
  if (!until) {
    for (const { key } of failKeys(scope, ip, user)) {
      const lock = await loadJSONStrict<{ until: number }>(lockKey(key));
      if (lock?.until && lock.until > now) until = Math.max(until, lock.until);
    }
  }
  return until ? Math.ceil((until - now) / 60000) : 0;
}

export async function registerFail(ip: string, user = "", scope = "login"): Promise<void> {
  const now = Date.now();
  for (const { key, max } of failKeys(scope, ip, user)) {
    const f = await readFails(key);
    const n = f.until && f.until < now ? 1 : f.n + 1;
    if (n >= max) {
      const until = now + LOCK_MINUTES * 60000;
      await edgePut(`fails:${key}`, { n: 0, until }, LOCK_MINUTES * 60);
      // Si KV no deja escribir (cuota del día), el bloqueo queda igual en memoria y en la caché.
      await trySaveJSON(lockKey(key), { until }, { expirationTtl: LOCK_MINUTES * 60 });
    } else {
      await edgePut(`fails:${key}`, { n }, LOCK_MINUTES * 60);
    }
  }
}

/** Reinicia el contador del usuario después de un ingreso correcto (solo si había fallos). */
export async function clearFails(ip: string, user = "", scope = "login"): Promise<void> {
  const [own] = failKeys(scope, ip, user);
  const f = await readFails(own.key);
  if (f.n > 0) await edgePut(`fails:${own.key}`, { n: 0 }, 60);
}

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
