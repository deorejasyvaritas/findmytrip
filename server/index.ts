import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Destination, Meta, Party, SharedTripResponse } from "../shared/types.ts";
import { runAgent } from "./agent.ts";
import { DESTINATIONS, ORIGINS, getDestination } from "./data/destinations.ts";
import { addDays, baseFlightFrom, explore, lodgingNightly, monthOverview, resolveWhen, stayOptions } from "./engine.ts";
import { deleteJSON, fetchJSON, loadJSON, saveJSON, useCacheStore } from "./cache.ts";
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
import { getRadar, routeHistory, runRadar, withoutPastDepartures } from "./radar.ts";
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
import { usdArsOfficialRate, usdArsRate } from "./providers/fx.ts";
import { googleHotels } from "./providers/hotels.ts";
import { xoteloHotels } from "./providers/xotelo.ts";
import { escapes } from "./escapes.ts";
import { crossAndFly } from "./cross.ts";
import { partnerLinks } from "./partner-links.ts";
import { searchFlights, searchMulti, searchPlaces } from "./search.ts";
import { geocode, nearestCatalog, planTrip, refreshLeg } from "./trip.ts";
import { canUseGoogle } from "./google-budget.ts";
import { BY_CODE } from "./radar.ts";
import { stayLinks } from "../shared/links.ts";
import { headcount, partyFromParams, roomsForParty } from "../shared/pricing.ts";
import { extrasFor } from "../shared/extras.ts";
import { buildPackage } from "./packages.ts";
import { newShareId, shareKey, sharePath, shareSnapshot, userSharesKey, validShareId, type ShareRecord } from "./share.ts";
import { climateFor } from "./providers/climate.ts";
import {
  createCTrip,
  createInvite,
  deleteCTrip,
  invitePath,
  invitePreview,
  joinWithInvite,
  listCTrips,
  removeMember,
  updateCTrip,
  usableInvite,
  type Result,
} from "./ctrips.ts";

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
  const body = credentials.extend({ invite: z.string().max(80).optional() }).parse(await c.req.json());
  // Una invitación vigente a un viaje habilita esa cuenta aunque el registro esté cerrado.
  const invite = body.invite ? await usableInvite(body.invite) : null;
  if (!(await signupOpen()) && !invite?.ok) {
    if (invite && !invite.ok) return c.json({ error: invite.error }, invite.status);
    return c.json({ error: "El registro está cerrado. Pedile acceso a quien administra el sitio." }, 403);
  }
  const user = normalizeUser(body.user);
  if (!validUser(user)) return c.json({ error: "El usuario tiene que tener de 3 a 30 caracteres: letras, números, punto o guion." }, 400);
  if (body.password.length < 8) return c.json({ error: "La contraseña tiene que tener al menos 8 caracteres." }, 400);
  if (await getAccount(user)) return c.json({ error: "Ese usuario ya existe. Probá con otro o iniciá sesión." }, 409);
  const account = await createAccount(user, body.password);
  // Entrar al viaje gasta la invitación: no sirve para crear otra cuenta.
  if (body.invite && invite?.ok) await joinWithInvite(account.user, body.invite);
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
/** Grupo desde la query (?adults=2&kids=5,8&bags=cabin); sin eso, `travelers` adultos (compatibilidad). */
function partyQ(query: Record<string, string>, travelers: number): Party {
  const p = partyFromParams(new URLSearchParams(query), { adults: travelers, childAges: [], bags: "cabin" });
  return { ...p, adults: Math.min(12, Math.max(1, Math.round(p.adults))), childAges: p.childAges.slice(0, 10) };
}

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
  domesticBudgetUSD: z.number().positive().optional(),
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
  maxFlightPP: z.number().positive().nullable().optional(),
  directOnly: z.boolean().optional(),
  longWeekendsOnly: z.boolean().optional(),
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
  const fallback = Number(env(c).USD_ARS_RATE) || 1450;
  const [fx, official] = await Promise.all([usdArsRate(fallback), usdArsOfficialRate(fallback)]);
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
    usdArsOfficialRate: official.rate,
    usdArsOfficialSource: official.source,
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
    months: monthOverview(q.origin, dest, q.nights, partyQ(c.req.query(), q.travelers), q.style),
  });
});

app.post("/explore", async (c) => {
  const body = exploreSchema.parse(await c.req.json());
  // Fechas pasadas: se corre la salida a hoy (no hay precios para el pasado).
  const todayISO = new Date().toISOString().slice(0, 10);
  if (body.when?.kind === "window" && body.when.from < todayISO) body.when = { ...body.when, from: todayISO, to: body.when.to < todayISO ? todayISO : body.when.to };
  if (body.when?.kind === "exact" && body.when.depart < todayISO) return c.json({ error: "La fecha de ida ya pasó." }, 400);
  const { months, weekends } = resolveWhen(body);
  const keys = env(c);
  // Si fallan las fuentes de precios, igual devolvemos resultados (estimados).
  const real = await realPrices(
    { serpapi: keys.SERPAPI_KEY, travelpayouts: keys.TRAVELPAYOUTS_TOKEN },
    body.origin,
    months,
    months.length === 1 ? months[0].month : null,
    weekends,
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
  // cacheOnly=1 (o pocas búsquedas en el mes): devuelve el precio solo si ya se buscó antes.
  const cacheOnly = q.cacheOnly === "1" || !(await canUseGoogle(serpKey));
  const quote = await googleFlights(serpKey, q.origin, dest, q.depart, q.ret, cacheOnly);
  if (!quote && cacheOnly) return c.json({ cached: false }, 404);
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
    // Si el comparador gratis no trae datos, Google Hotels automático (con freno para no agotar el mes).
    if (!quote && has(serpKey) && (await canUseGoogle(serpKey))) {
      quote = await googleHotels(serpKey, dest, q.checkin, q.nights, Math.min(q.travelers, 2));
    }
  }
  return c.json({
    options: stayOptions(dest, q.checkin, q.nights, partyQ(c.req.query(), q.travelers), quote?.tiers),
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
      party: exploreSchema.shape.party,
      includeDaily: z.boolean().optional(),
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

// ---------------------------------------------------------------------------
// Buscador completo: lugares, vuelos, hoteles y multidestino.
// ---------------------------------------------------------------------------

const iata = z.string().regex(/^[A-Z]{3}$/);

app.get("/places", async (c) => {
  const { q } = z.object({ q: z.string().max(60) }).parse(c.req.query());
  return c.json(await searchPlaces(q));
});

app.get("/search/flights", async (c) => {
  const q = z
    .object({ origin: iata, dest: iata, depart: isoDate, ret: isoDate.optional(), direct: z.string().optional() })
    .parse(c.req.query());
  const e = env(c);
  const r = await searchFlights(
    e.TRAVELPAYOUTS_TOKEN,
    { origin: q.origin, destination: q.dest, depart: q.depart, ret: q.ret ?? null, direct: q.direct === "1" },
    e.TRAVELPAYOUTS_MARKER,
  );
  // Si el destino está en el catálogo, la ficha suma hoteles, clima y paquete.
  const dest = BY_CODE.get(q.dest);
  return c.json({ ...r, destinationId: dest?.id ?? null });
});

app.post("/search/multi", async (c) => {
  const body = z
    .object({ legs: z.array(z.object({ origin: iata, destination: iata, date: isoDate })).min(2).max(5) })
    .parse(await c.req.json());
  const e = env(c);
  return c.json(await searchMulti(e.TRAVELPAYOUTS_TOKEN, body, e.TRAVELPAYOUTS_MARKER));
});

// Hoteles por ciudad (código IATA): precios reales si es un destino del catálogo; si no, links con las fechas.
app.get("/search/hotels", async (c) => {
  const q = z
    .object({ place: iata, name: z.string().max(80).optional(), checkin: isoDate, checkout: isoDate, travelers: travelersQ })
    .parse(c.req.query());
  const nights = Math.max(1, Math.round((Date.parse(q.checkout) - Date.parse(q.checkin)) / 86400000));
  const party = partyQ(c.req.query(), q.travelers);
  const travelers = headcount(party);
  const rooms = roomsForParty(party);
  const dest = BY_CODE.get(q.place);
  const quote = dest ? await xoteloHotels(dest, q.checkin, nights).catch(() => null) : null;
  return c.json({
    destinationId: dest?.id ?? null,
    name: dest?.name ?? q.name ?? q.place,
    nights,
    rooms,
    hotels: quote?.hotels ?? [],
    options: dest ? stayOptions(dest, q.checkin, nights, party, quote?.tiers) : [],
    links: stayLinks(dest?.name ?? q.name ?? q.place, q.checkin, q.checkout, travelers, rooms),
  });
});

// "Ya sé a dónde": cualquier lugar del mundo, con una o varias paradas.
app.get("/geo", async (c) => {
  const { q } = z.object({ q: z.string().max(60) }).parse(c.req.query());
  return c.json(await geocode(q));
});

const stopSchema = z.object({
  name: z.string().min(1).max(80),
  region: z.string().max(80).nullable().optional(),
  country: z.string().max(60),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  nights: z.number().int().min(1).max(30),
});

app.post("/trip/plan", async (c) => {
  const body = z.object({ origin: iata, depart: isoDate, stops: z.array(stopSchema).min(1).max(5) }).parse(await c.req.json());
  const e = env(c);
  const google = has(e.SERPAPI_KEY) && (await canUseGoogle(e.SERPAPI_KEY)) ? e.SERPAPI_KEY : undefined;
  return c.json(await planTrip(e.TRAVELPAYOUTS_TOKEN, body, e.TRAVELPAYOUTS_MARKER, google));
});

// Vuelve a mirar un tramo (solo el día exacto, sin la caché de 3 h) después de
// que el usuario lo buscó en Aviasales. No usa Google ni escribe en KV.
app.post("/trip/leg", async (c) => {
  const body = z
    .object({ from: iata, to: iata, date: isoDate, returnDate: isoDate.nullable().optional() })
    .parse(await c.req.json());
  const e = env(c);
  return c.json(await refreshLeg(e.TRAVELPAYOUTS_TOKEN, e.TRAVELPAYOUTS_MARKER, body.from, body.to, body.date, body.returnDate ?? null));
});

// Alojamiento de una parada: precios reales si está en el catálogo (o con Google, a pedido); si no, estimado y links.
app.get("/trip/hotels", async (c) => {
  const q = z
    .object({
      name: z.string().max(80),
      country: z.string().max(60),
      lat: z.coerce.number(),
      lon: z.coerce.number(),
      checkin: isoDate,
      nights: nightsQ,
      travelers: travelersQ,
      style: z.enum(["low", "mid", "high"]).default("mid"),
      google: z.string().optional(),
      // Habitaciones según el grupo (roomsForParty: los chicos comparten).
      rooms: z.coerce.number().int().min(1).max(12).optional(),
    })
    .parse(c.req.query());
  const party = partyQ(c.req.query(), q.travelers);
  const travelers = headcount(party);
  const rooms = q.rooms ?? roomsForParty(party);
  const near = nearestCatalog(q.lat, q.lon);
  const inCatalog = near.km < 40 ? near.dest : null;
  let quote = inCatalog ? await xoteloHotels(inCatalog, q.checkin, q.nights).catch(() => null) : null;
  const serpKey = env(c).SERPAPI_KEY;
  // Fuera del catálogo: Google Hotels automático (con freno para no agotar el mes).
  if (!quote && has(serpKey) && (await canUseGoogle(serpKey))) {
    // Destino "de paso" armado con el lugar elegido: Google filtra los hoteles cerca de esas coordenadas.
    const place: Destination = { ...near.dest, id: `geo-${q.lat.toFixed(2)},${q.lon.toFixed(2)}`, name: q.name, country: q.country, lat: q.lat, lon: q.lon };
    quote = await googleHotels(serpKey, place, q.checkin, q.nights, Math.min(q.travelers, 2)).catch(() => null);
  }
  const estimateNight = lodgingNightly(near.dest, q.style, Number(q.checkin.slice(5, 7)));
  return c.json({
    destinationId: inCatalog?.id ?? null,
    hotels: quote?.hotels ?? [],
    source: quote?.source ?? null,
    rooms,
    estimateNight,
    estimateFrom: near.km < 40 ? null : near.dest.name,
    links: stayLinks(`${q.name}, ${q.country}`, q.checkin, addDays(q.checkin, q.nights), travelers, rooms),
  });
});

// ---------------------------------------------------------------------------
// Compartir un viaje por link (solo lectura). Crear y borrar pide sesión; ver
// el link es público (ver requireAuth en auth.ts).
// ---------------------------------------------------------------------------

/** Viajes que compartió el usuario: id del paquete -> id del link. */
const userShares = async (u: string) => (await loadJSON<Record<string, string>>(userSharesKey(u))) ?? {};

app.get("/me/shares", async (c) => c.json({ shares: await userShares(userId(c)) }));

app.post("/share", async (c) => {
  const raw = await c.req.text();
  if (raw.length > 50_000) return c.json({ error: "El viaje tiene demasiados datos para compartir." }, 413);
  let body: { package?: { id?: unknown } } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // Cuerpo inválido: cae en el error de abajo.
  }
  const packageId = typeof body?.package?.id === "string" ? body.package.id.slice(0, 80) : "";
  const trip = shareSnapshot(body?.package);
  if (!packageId || !trip) return c.json({ error: "No pudimos compartir este viaje. Revisá que tenga vuelo o alojamiento." }, 400);
  const u = userId(c);
  const shares = await userShares(u);
  const now = new Date().toISOString();
  // Si ya estaba compartido se actualiza la copia y el link sigue siendo el mismo.
  const prevId = shares[packageId];
  const prev = prevId ? await loadJSON<ShareRecord>(shareKey(prevId)) : null;
  const id = prev && prev.user === u ? prev.id : newShareId();
  const record: ShareRecord = { id, user: u, packageId, createdAt: prev?.createdAt ?? now, updatedAt: now, trip };
  await saveJSON(shareKey(id), record);
  if (shares[packageId] !== id) await saveJSON(userSharesKey(u), { ...shares, [packageId]: id });
  return c.json({ id, path: sharePath(id) });
});

app.get("/share/:id", async (c) => {
  const id = c.req.param("id");
  const record = validShareId(id) ? await loadJSON<ShareRecord>(shareKey(id)) : null;
  c.header("X-Robots-Tag", "noindex");
  if (!record) return c.json({ error: "Este link ya no está disponible." }, 404);
  const out: SharedTripResponse = { trip: record.trip, createdAt: record.createdAt, updatedAt: record.updatedAt };
  return c.json(out);
});

app.delete("/share/:id", async (c) => {
  const id = c.req.param("id");
  const u = userId(c);
  const record = validShareId(id) ? await loadJSON<ShareRecord>(shareKey(id)) : null;
  if (!record) return c.json({ error: "Este link ya no está disponible." }, 404);
  if (record.user !== u) return c.json({ error: "Solo quien compartió el viaje puede dejar de compartirlo." }, 403);
  await deleteJSON(shareKey(id));
  const shares = await userShares(u);
  const rest = Object.fromEntries(Object.entries(shares).filter(([, v]) => v !== id));
  await saveJSON(userSharesKey(u), rest);
  return c.json({ ok: true, shares: rest });
});

// ---------------------------------------------------------------------------
// Viajes con otros: un viaje que varias cuentas ven y editan. Se entra con una
// invitación (ver la vista previa es público; sumarse pide sesión).
// ---------------------------------------------------------------------------

const reply = <T>(c: Context, r: Result<T>, map: (v: T) => unknown) =>
  r.ok ? c.json(map(r.value)) : c.json({ error: r.error, ...(r.trip ? { trip: r.trip } : {}) }, r.status);

/** Cuerpo JSON acotado: un viaje no debería pesar más que esto. */
async function tripBody(c: Context): Promise<Record<string, unknown> | null> {
  const raw = await c.req.text();
  if (raw.length > 60_000) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

app.get("/me/ctrips", async (c) => c.json({ trips: await listCTrips(userId(c)) }));

app.post("/ctrips", async (c) => {
  const body = await tripBody(c);
  if (!body) return c.json({ error: "No pudimos compartir este viaje." }, 400);
  return reply(c, await createCTrip(userId(c), body.package), (trip) => ({ trip }));
});

app.put("/ctrips/:id", async (c) => {
  const body = await tripBody(c);
  const version = z.number().int().min(1).safeParse(body?.version);
  if (!body || !version.success) return c.json({ error: "No pudimos guardar el cambio." }, 400);
  return reply(c, await updateCTrip(userId(c), c.req.param("id"), version.data, body.package), (trip) => ({ trip }));
});

app.delete("/ctrips/:id", async (c) => reply(c, await deleteCTrip(userId(c), c.req.param("id")), () => ({ ok: true })));

app.delete("/ctrips/:id/members/:user", async (c) =>
  reply(c, await removeMember(userId(c), c.req.param("id"), normalizeUser(c.req.param("user"))), (trip) => ({ trip })),
);

app.post("/ctrips/:id/invite", async (c) =>
  reply(c, await createInvite(userId(c), c.req.param("id")), (inv) => ({ id: inv.id, path: invitePath(inv.id), expiresAt: inv.expiresAt })),
);

app.get("/invite/:id", async (c) => {
  c.header("X-Robots-Tag", "noindex");
  return reply(c, await invitePreview(c.req.param("id")), (invite) => ({ invite }));
});

app.post("/invite/:id/join", async (c) => reply(c, await joinWithInvite(userId(c), c.req.param("id")), (trip) => ({ trip })));

// ---------------------------------------------------------------------------
// Historial de precios por ruta (gráfico de la página del destino)
// ---------------------------------------------------------------------------

app.get("/radar/history", async (c) => {
  const q = z.object({ origin: originCode, dest: z.string().regex(/^[a-z0-9-]{1,60}$/) }).parse(c.req.query());
  const points = await routeHistory(q.origin, q.dest);
  // Igual para todos y cambia con los barridos: se puede guardar un rato en el navegador.
  c.header("Cache-Control", "private, max-age=600");
  return c.json({ origin: q.origin, dest: q.dest, points });
});

// Clima esperado por mes (Open-Meteo, historial de 4 años resumido en KV).
app.get("/climate", async (c) => {
  const q = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) }).parse(c.req.query());
  const months = await climateFor(q.lat, q.lon);
  if (!months) return c.json({ error: "No pudimos traer el clima de ese lugar" }, 502);
  c.header("Cache-Control", "private, max-age=86400");
  return c.json({ months });
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
  const { origin, travelers } = z.object({ origin: originCode, travelers: travelersQ }).parse(c.req.query());
  return c.json(await escapes(env(c).TRAVELPAYOUTS_TOKEN, origin, new Date(), partyQ(c.req.query(), travelers)));
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
  return c.json(withoutPastDepartures(snap));
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
