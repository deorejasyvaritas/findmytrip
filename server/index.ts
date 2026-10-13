import { Hono } from "hono";
import { z } from "zod";
import type { Meta } from "../shared/types.ts";
import { runAgent } from "./agent.ts";
import { DESTINATIONS, ORIGINS, getDestination } from "./data/destinations.ts";
import { baseFlightFrom, explore, monthOverview, stayOptions, upcomingMonths, yearFor } from "./engine.ts";
import { fetchJSON, useCacheStore } from "./cache.ts";
import { config, has, type Env } from "./env.ts";
import { realPrices } from "./providers/explore.ts";
import { flightCalendar, googleFlights } from "./providers/flights.ts";
import { usdArsRate } from "./providers/fx.ts";
import { googleHotels } from "./providers/hotels.ts";
import { buildPackage } from "./packages.ts";

// API de FindMyTrip. Corre como Cloudflare Worker (gratis); el frontend se
// sirve como archivos estáticos desde el mismo Worker.

const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.use(async (c, next) => {
  useCacheStore(c.env.CACHE);
  await next();
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
    agent: has(env(c).ANTHROPIC_API_KEY),
    usdArsRate: fx.rate,
    usdArsSource: fx.source,
    marker: env(c).TRAVELPAYOUTS_MARKER ?? null,
  };
  return c.json(meta);
});

app.get("/destinations", (c) => c.json(DESTINATIONS));

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
  const months = body.month != null ? [{ month: body.month, year: body.year ?? yearFor(body.month) }] : upcomingMonths();
  const keys = env(c);
  const real = await realPrices(
    { serpapi: keys.SERPAPI_KEY, travelpayouts: keys.TRAVELPAYOUTS_TOKEN },
    body.origin,
    months,
    body.month,
  );
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

// Alojamiento: estimado siempre; con `real=1` agrega hoteles reales de Google Hotels.
app.get("/stays", async (c) => {
  const q = z
    .object({ dest: z.string(), checkin: isoDate, nights: nightsQ, travelers: travelersQ, real: z.string().optional() })
    .parse(c.req.query());
  const dest = getDestination(q.dest);
  if (!dest) return c.json(notFound, 404);
  const serpKey = env(c).SERPAPI_KEY;
  if (q.real === "1" && !has(serpKey)) {
    return c.json({ error: "Falta SERPAPI_KEY para ver hoteles reales." }, 503);
  }
  const quote =
    q.real === "1" && has(serpKey)
      ? await googleHotels(serpKey, dest, q.checkin, q.nights, Math.min(q.travelers, 2))
      : null;
  return c.json({
    options: stayOptions(dest, q.checkin, q.nights, q.travelers, quote?.tiers),
    hotels: quote?.hotels ?? [],
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
  if (!has(env(c).ANTHROPIC_API_KEY)) {
    return c.json({ error: "El agente no está configurado. Agregá ANTHROPIC_API_KEY y reiniciá." }, 503);
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
  return c.json(await runAgent(env(c), body.messages, body.profile));
});

app.notFound((c) => c.json({ error: "No encontrado" }, 404));

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: "Parámetros inválidos", details: err.issues }, 400);
  console.error(err);
  return c.json({ error: "Algo salió mal. Probá de nuevo en un momento." }, 500);
});

export default app;
