import { Hono } from "hono";
import { z } from "zod";
import type { Meta } from "../shared/types.ts";
import { runAgent } from "./agent.ts";
import { DESTINATIONS, ORIGINS, getDestination } from "./data/destinations.ts";
import { baseFlightFrom, explore, monthOverview, resolveWhen, stayOptions } from "./engine.ts";
import { fetchJSON, loadJSON, saveJSON, useCacheStore } from "./cache.ts";
import {
  changePassword,
  clearCookie,
  clearFails,
  cookieToken,
  createAccount,
  createSession,
  getAccount,
  getAuthSettings,
  listUsers,
  loginLocked,
  normalizeUser,
  readSession,
  registerFail,
  requireAuth,
  saveAuthSettings,
  sessionCookie,
  signupOpen,
  validUser,
  verifyPassword,
} from "./auth.ts";
import { config, has, type Env } from "./env.ts";
import { realPrices } from "./providers/explore.ts";
import { getRadar, runRadar } from "./radar.ts";
import {
  connectTelegram,
  evaluateAlerts,
  getSettings,
  listSubs,
  removeSub,
  saveSettings,
  sendTelegram,
  telegramLink,
  upsertSub,
} from "./alerts.ts";
import { destinationPhotos } from "./providers/photos.ts";
import { flightCalendar, googleFlights } from "./providers/flights.ts";
import { usdArsRate } from "./providers/fx.ts";
import { googleHotels } from "./providers/hotels.ts";
import { xoteloHotels } from "./providers/xotelo.ts";
import { escapes } from "./escapes.ts";
import { crossAndFly } from "./cross.ts";
import { partnerLinks } from "./partner-links.ts";
import { extrasFor } from "../shared/extras.ts";
import { buildPackage } from "./packages.ts";

// API de FindMyTrip. Corre como Cloudflare Worker (gratis); el frontend se
// sirve como archivos estáticos desde el mismo Worker.

const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.use(async (c, next) => {
  useCacheStore(c.env.CACHE);
  await next();
});

const userId = (c: { get: (k: never) => unknown }) => c.get("user" as never) as string;

// Todo lo que está en /api pide sesión (salvo ingreso y registro).
app.use(requireAuth);

// ---------------------------------------------------------------------------
// Cuentas y sesión
// ---------------------------------------------------------------------------

const isHttps = (url: string) => new URL(url).protocol === "https:";
const credentials = z.object({ user: z.string().max(80), password: z.string().max(200) });

app.get("/session", async (c) => {
  const account = await readSession(cookieToken(c.req.header("Cookie")));
  const users = await listUsers();
  return c.json({
    authenticated: Boolean(account),
    user: account?.user ?? null,
    role: account?.role ?? null,
    firstAccount: users.length === 0,
    canRegister: await signupOpen(),
  });
});

app.post("/register", async (c) => {
  if (!(await signupOpen())) return c.json({ error: "El registro está cerrado. Pedile acceso a quien administra el sitio." }, 403);
  const body = credentials.parse(await c.req.json());
  const user = normalizeUser(body.user);
  if (!validUser(user)) return c.json({ error: "El usuario tiene que tener de 3 a 30 caracteres: letras, números, punto o guion." }, 400);
  if (body.password.length < 8) return c.json({ error: "La contraseña tiene que tener al menos 8 caracteres." }, 400);
  if (await getAccount(user)) return c.json({ error: "Ese usuario ya existe. Probá con otro o iniciá sesión." }, 409);
  const account = await createAccount(user, body.password);
  c.header("Set-Cookie", sessionCookie(await createSession(account), isHttps(c.req.url)));
  return c.json({ ok: true, user: account.user, role: account.role });
});

app.post("/login", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "local";
  const locked = await loginLocked(ip);
  if (locked) return c.json({ error: `Demasiados intentos. Probá de nuevo en ${locked} min.` }, 429);
  const body = credentials.parse(await c.req.json());
  const account = await verifyPassword(body.user, body.password);
  if (!account) {
    await registerFail(ip);
    return c.json({ error: "Usuario o contraseña incorrectos." }, 401);
  }
  await clearFails(ip);
  c.header("Set-Cookie", sessionCookie(await createSession(account), isHttps(c.req.url)));
  return c.json({ ok: true, user: account.user, role: account.role });
});

app.post("/logout", (c) => {
  c.header("Set-Cookie", clearCookie(isHttps(c.req.url)));
  return c.json({ ok: true });
});

app.post("/account/password", async (c) => {
  const body = z.object({ current: z.string().max(200), password: z.string().min(8).max(200) }).parse(await c.req.json());
  const user = userId(c);
  if (!(await verifyPassword(user, body.current))) return c.json({ error: "La contraseña actual no es correcta." }, 400);
  await changePassword(user, body.password);
  const account = (await getAccount(user))!;
  c.header("Set-Cookie", sessionCookie(await createSession(account), isHttps(c.req.url)));
  return c.json({ ok: true });
});

app.get("/account/settings", async (c) => c.json(await getAuthSettings()));

app.put("/account/settings", async (c) => {
  if (c.get("role" as never) !== "owner") return c.json({ error: "Solo la cuenta dueña puede cambiar esto." }, 403);
  const body = z.object({ openSignup: z.boolean() }).parse(await c.req.json());
  await saveAuthSettings(body);
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Datos del usuario (perfil, viajes, destinos seguidos): guardados en el
// servidor para que estén protegidos y sincronizados entre dispositivos.
// ---------------------------------------------------------------------------

const USER_KEYS = ["profile", "packages", "watchlist"] as const;


app.get("/me/data", async (c) => {
  const u = userId(c);
  const entries = await Promise.all(USER_KEYS.map(async (k) => [k, await loadJSON(`user:${u}:${k}`)] as const));
  return c.json(Object.fromEntries(entries));
});

app.put("/me/data/:key", async (c) => {
  const key = z.enum(USER_KEYS).parse(c.req.param("key"));
  const raw = await c.req.text();
  if (raw.length > 200_000) return c.json({ error: "Demasiados datos." }, 413);
  await saveJSON(`user:${userId(c)}:${key}`, JSON.parse(raw));
  return c.json({ ok: true });
});

const INTERESTS = [
  "playa", "montaña", "ciudad", "gastronomía", "aventura", "nieve",
  "cultura", "naturaleza", "relax", "noche", "compras",
] as const;
const REGIONS = [
  "Argentina", "Sudamérica", "Caribe y Centroamérica", "Norteamérica",
  "Europa", "Asia", "África y Medio Oriente",
] as const;
const style = z.enum(["low", "mid", "high"]);
const originCode = z.string().regex(/^[A-Z]{3}$/).default("BUE");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nightsQ = z.coerce.number().int().min(1).max(60).default(7);
const travelersQ = z.coerce.number().int().min(1).max(12).default(2);

const profileSchema = z.object({
  name: z.string().max(80).default(""),
  origin: originCode,
  travelers: z.coerce.number().int().min(1).max(12).default(2),
  style: style.default("mid"),
  interests: z.array(z.enum(INTERESTS)).default([]),
  currency: z.enum(["USD", "ARS"]).default("USD"),
  visited: z.array(z.string()).default([]),
  maxFlightHours: z.number().nullable().default(null),
  includeDaily: z.boolean().optional(),
});

const exploreSchema = z.object({
  origin: originCode,
  budgetUSD: z.coerce.number().positive(),
  travelers: z.coerce.number().int().min(1).max(12),
  nights: z.coerce.number().int().min(1).max(60),
  month: z.number().int().min(1).max(12).nullable(),
  year: z.number().int().optional(),
  style,
  interests: z.array(z.enum(INTERESTS)).default([]),
  regions: z.array(z.enum(REGIONS)).optional(),
  exclude: z.array(z.string()).optional(),
  known: z.array(z.string()).optional(),
  maxFlightHours: z.number().nullable().optional(),
  includeDaily: z.boolean().optional(),
  party: z
    .object({
      adults: z.number().int().min(1).max(12),
      childAges: z.array(z.number().int().min(0).max(17)).max(10),
      bags: z.enum(["personal", "cabin", "checked1", "checked2"]),
    })
    .optional(),
  when: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("flexible") }),
      z.object({ kind: z.literal("months"), months: z.array(z.object({ month: z.number().int().min(1).max(12), year: z.number().int() })).max(12) }),
      z.object({ kind: z.literal("window"), from: isoDate, to: isoDate }),
      z.object({ kind: z.literal("exact"), depart: isoDate, ret: isoDate }),
    ])
    .optional(),
});

const notFound = { error: "Destino no encontrado" };
const env = (c: { env: Env }) => config(c.env);

app.get("/meta", async (c) => {
  const fx = await usdArsRate(Number(env(c).USD_ARS_RATE) || 1450);
  const meta: Meta = {
    origins: ORIGINS,
    interests: [...INTERESTS],
    regions: [...REGIONS],
    liveFlights: has(env(c).TRAVELPAYOUTS_TOKEN),
    googleQuotes: has(env(c).SERPAPI_KEY),
    agent: has(env(c).ANTHROPIC_API_KEY) || Boolean(c.env.AI),
    agentProvider: has(env(c).ANTHROPIC_API_KEY) ? "claude" : c.env.AI ? "workers-ai" : null,
    usdArsRate: fx.rate,
    usdArsSource: fx.source,
    marker: env(c).TRAVELPAYOUTS_MARKER ?? null,
    telegram: has(env(c).TELEGRAM_BOT_TOKEN),
  };
  return c.json(meta);
});

app.get("/destinations", (c) => c.json(DESTINATIONS));

// Fotos ilustrativas de cada destino (Wikipedia/Wikimedia, gratis, cacheadas 30 días).
app.get("/photos", async (c) => c.json(await destinationPhotos()));

app.get("/destinations/:id", (c) => {
  const dest = getDestination(c.req.param("id"));
  if (!dest) return c.json(notFound, 404);
  const q = z
    .object({ origin: originCode, nights: nightsQ, travelers: travelersQ, style: style.default("mid") })
    .parse(c.req.query());
  return c.json({
    destination: dest,
    baseFlightUSD: baseFlightFrom(q.origin, dest),
    months: monthOverview(q.origin, dest, q.nights, q.travelers, q.style),
  });
});

app.post("/explore", async (c) => {
  const body = exploreSchema.parse(await c.req.json());
  const { months } = resolveWhen(body);
  const keys = env(c);
  // Si fallan las fuentes de precios, igual devolvemos resultados (estimados).
  const real = await realPrices(
    { serpapi: keys.SERPAPI_KEY, travelpayouts: keys.TRAVELPAYOUTS_TOKEN },
    body.origin,
    months,
    months.length === 1 ? months[0].month : null,
  ).catch((err) => {
    console.error("explore: precios reales", err);
    return undefined;
  });
  return c.json(explore(body, real));
});

app.get("/flights/calendar", async (c) => {
  const q = z
    .object({ origin: originCode, dest: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/), nights: nightsQ })
    .parse(c.req.query());
  const dest = getDestination(q.dest);
  if (!dest) return c.json(notFound, 404);
  return c.json(await flightCalendar(env(c).TRAVELPAYOUTS_TOKEN, q.origin, dest, q.month, q.nights));
});

// Precio exacto de Google Flights para una fecha (consume cuota de SerpApi).
app.get("/flights/quote", async (c) => {
  const serpKey = env(c).SERPAPI_KEY;
  if (!has(serpKey)) return c.json({ error: "Falta SERPAPI_KEY para cotizar con Google Flights." }, 503);
  const q = z
    .object({ origin: originCode, dest: z.string(), depart: isoDate, ret: isoDate, cacheOnly: z.string().optional() })
    .parse(c.req.query());
  const dest = getDestination(q.dest);
  if (!dest) return c.json(notFound, 404);
  // cacheOnly=1: devuelve el precio solo si ya se buscó antes (no gasta cuota).
  const quote = await googleFlights(serpKey, q.origin, dest, q.depart, q.ret, q.cacheOnly === "1");
  if (!quote && q.cacheOnly === "1") return c.json({ cached: false }, 404);
  if (!quote) return c.json({ error: "Google Flights no devolvió resultados para esa fecha." }, 502);
  return c.json(quote);
});

// Alojamiento: estimado siempre; con `real=1` agrega hoteles reales.
// Primero Xotelo (compara Booking, Agoda, Expedia...; gratis y sin cuota) y,
// si no hay datos, Google Hotels solo cuando el cliente lo pide (`google=1`, usa cuota).
app.get("/stays", async (c) => {
  const q = z
    .object({
      dest: z.string(),
      checkin: isoDate,
      nights: nightsQ,
      travelers: travelersQ,
      real: z.string().optional(),
      google: z.string().optional(),
    })
    .parse(c.req.query());
  const dest = getDestination(q.dest);
  if (!dest) return c.json(notFound, 404);
  const serpKey = env(c).SERPAPI_KEY;
  let quote = null;
  if (q.real === "1") {
    quote = await xoteloHotels(dest, q.checkin, q.nights).catch((err) => {
      console.error("xotelo", err);
      return null;
    });
    if (!quote && q.google === "1" && has(serpKey)) {
      quote = await googleHotels(serpKey, dest, q.checkin, q.nights, Math.min(q.travelers, 2));
    }
  }
  return c.json({
    options: stayOptions(dest, q.checkin, q.nights, q.travelers, quote?.tiers),
    hotels: quote?.hotels ?? [],
    source: quote?.source ?? null,
    live: Boolean(quote),
  });
});

// Búsquedas de Google que quedan este mes (consultar la cuenta no consume cuota).
app.get("/quota", async (c) => {
  const key = env(c).SERPAPI_KEY;
  if (!has(key)) return c.json({ left: null, total: null });
  const r = await fetchJSON<{ plan_searches_left?: number; searches_per_month?: number; total_searches_left?: number }>(
    `https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`,
    "serpapi-account",
  );
  return c.json({ left: r?.total_searches_left ?? r?.plan_searches_left ?? null, total: r?.searches_per_month ?? null });
});

app.post("/packages/build", async (c) => {
  const body = z
    .object({
      destinationId: z.string(),
      origin: originCode,
      departDate: isoDate,
      nights: z.number().int().min(1).max(60),
      travelers: z.number().int().min(1).max(12),
      style,
      flightPP: z.number().positive().optional(),
      notes: z.string().max(500).optional(),
    })
    .parse(await c.req.json());
  const dest = getDestination(body.destinationId);
  if (!dest) return c.json(notFound, 404);
  return c.json(buildPackage({ ...body, dest }));
});

app.post("/agent", async (c) => {
  if (!has(env(c).ANTHROPIC_API_KEY) && !c.env.AI) {
    return c.json({ error: "El agente no está configurado." }, 503);
  }
  const body = z
    .object({
      messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
        .min(1)
        .max(40),
      profile: profileSchema,
    })
    .parse(await c.req.json());
  if (body.messages[0].role !== "user" || body.messages.at(-1)!.role !== "user") {
    return c.json({ error: "La conversación debe empezar y terminar con un mensaje del usuario." }, 400);
  }
  try {
    return c.json(await runAgent(env(c), body.messages, body.profile));
  } catch (err) {
    console.error("[agente]", err);
    const free = !has(env(c).ANTHROPIC_API_KEY);
    return c.json(
      {
        error: free
          ? "La IA gratuita no respondió. Puede que se haya agotado la cuota del día: probá de nuevo más tarde."
          : "El agente no pudo responder. Probá de nuevo en un momento.",
      },
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// Radar de ofertas
// ---------------------------------------------------------------------------

app.get("/radar", async (c) => {
  const { origin } = z.object({ origin: originCode }).parse(c.req.query());
  const snap = await getRadar(env(c).TRAVELPAYOUTS_TOKEN, origin);
  if (!snap) return c.json({ error: "El radar necesita TRAVELPAYOUTS_TOKEN para funcionar." }, 503);
  return c.json(snap);
});

// Extras opcionales del viaje (traslado, eSIM, excursiones, seguro) con links de afiliado.
app.get("/extras", async (c) => {
  const { dest: id } = z.object({ dest: z.string() }).parse(c.req.query());
  const dest = getDestination(id);
  if (!dest) return c.json(notFound, 404);
  const e = env(c);
  const extras = extrasFor(dest);
  const links = await partnerLinks(
    { token: e.TRAVELPAYOUTS_TOKEN, marker: e.TRAVELPAYOUTS_MARKER, trs: e.TRAVELPAYOUTS_TRS },
    extras.map((x) => x.url),
  );
  return c.json({ extras: extras.map((x) => ({ ...x, url: links[x.url] ?? x.url })), partner: has(e.TRAVELPAYOUTS_TRS) });
});

// Cruzá y volá: comparar con salir desde Montevideo, Santiago o San Pablo.
app.get("/cross", async (c) => {
  const q = z.object({ origin: originCode, dest: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(c.req.query());
  const dest = getDestination(q.dest);
  if (!dest) return c.json(notFound, 404);
  return c.json(await crossAndFly(env(c).TRAVELPAYOUTS_TOKEN, q.origin, dest, q.month));
});

// Escapadas para los próximos fines de semana largos.
app.get("/escapes", async (c) => {
  const { origin } = z.object({ origin: originCode }).parse(c.req.query());
  return c.json(await escapes(env(c).TRAVELPAYOUTS_TOKEN, origin));
});

// Barrido manual (además de los automáticos). Limitado para no abusar de la API.
app.post("/radar/run", async (c) => {
  const { origin } = z.object({ origin: originCode }).parse(c.req.query());
  const token = env(c).TRAVELPAYOUTS_TOKEN;
  if (!token) return c.json({ error: "Falta TRAVELPAYOUTS_TOKEN." }, 503);
  const prev = await getRadar(undefined, origin);
  if (prev && Date.now() - Date.parse(prev.updatedAt) < 20 * 60000) return c.json(prev);
  const snap = await runRadar(token, origin);
  const e = env(c);
  await evaluateAlerts(userId(c), snap, { token: e.TELEGRAM_BOT_TOKEN, siteUrl: e.SITE_URL ?? new URL(c.req.url).origin });
  return c.json(snap);
});

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

const partySchema = z.object({
  adults: z.number().int().min(1).max(12),
  childAges: z.array(z.number().int().min(0).max(17)).max(10),
  bags: z.enum(["personal", "cabin", "checked1", "checked2"]),
});

app.get("/alerts", async (c) => {
  const user = userId(c);
  const [subs, settings] = await Promise.all([listSubs(user), getSettings(user)]);
  const { pendingCode: _code, ...visible } = settings;
  return c.json({ subs, settings: visible, telegram: has(env(c).TELEGRAM_BOT_TOKEN) });
});

app.post("/alerts/subs", async (c) => {
  const body = z
    .object({
      destinationId: z.string(),
      origin: originCode,
      targetUSD: z.number().positive(),
      nights: z.number().int().min(1).max(60),
      month: z.number().int().min(1).max(12).nullable(),
      party: partySchema,
      style,
    })
    .parse(await c.req.json());
  if (!getDestination(body.destinationId)) return c.json(notFound, 404);
  const subs = await upsertSub(userId(c), { ...body, id: body.destinationId, createdAt: new Date().toISOString() });
  return c.json({ subs });
});

app.delete("/alerts/subs/:id", async (c) => c.json({ subs: await removeSub(userId(c), c.req.param("id")) }));

app.put("/alerts/settings", async (c) => {
  const body = z
    .object({ radarDeals: z.boolean(), minDiscount: z.number().int().min(5).max(80), origin: originCode.optional() })
    .parse(await c.req.json());
  const user = userId(c);
  const settings = { ...(await getSettings(user)), ...body };
  await saveSettings(user, settings);
  return c.json({ settings });
});

app.post("/alerts/telegram/link", async (c) => {
  const token = env(c).TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ ok: false, error: "Falta cargar TELEGRAM_BOT_TOKEN en Cloudflare." }, 503);
  const res = await telegramLink(token, userId(c));
  return c.json(res, res.ok ? 200 : 400);
});

app.post("/alerts/telegram/connect", async (c) => {
  const token = env(c).TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ ok: false, error: "Falta cargar TELEGRAM_BOT_TOKEN en Cloudflare." }, 503);
  const res = await connectTelegram(token, userId(c));
  return c.json(res, res.ok ? 200 : 400);
});

app.post("/alerts/telegram/test", async (c) => {
  const token = env(c).TELEGRAM_BOT_TOKEN;
  const settings = await getSettings(userId(c));
  if (!token || !settings.telegramChatId) return c.json({ ok: false, error: "Primero conectá Telegram." }, 400);
  const ok = await sendTelegram(token, settings.telegramChatId, "Prueba de FindMyTrip: las alertas llegan bien.");
  return c.json({ ok });
});

app.notFound((c) => c.json({ error: "No encontrado" }, 404));

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    const field = err.issues[0]?.path.join(".");
    const msg = field === "budgetUSD" ? "Poné un presupuesto mayor a cero." : `Revisá los datos de la búsqueda${field ? ` (${field})` : ""}.`;
    return c.json({ error: msg, details: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: "Algo salió mal. Probá de nuevo en un momento." }, 500);
});

/** Barrido programado: radar de cada ciudad configurada y aviso de alertas. */
async function scheduledRadar(raw: Env): Promise<void> {
  useCacheStore(raw.CACHE);
  const e = config(raw);
  if (!e.TRAVELPAYOUTS_TOKEN) return;
  const origins = (e.RADAR_ORIGINS ?? "BUE").split(",").map((o) => o.trim().toUpperCase()).filter(Boolean);
  const users = await listUsers();
  for (const origin of origins.slice(0, 3)) {
    const snap = await runRadar(e.TRAVELPAYOUTS_TOKEN, origin);
    for (const user of users) await evaluateAlerts(user, snap, { token: e.TELEGRAM_BOT_TOKEN, siteUrl: e.SITE_URL });
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(scheduledRadar(env));
  },
};
