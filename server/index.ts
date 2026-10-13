import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Meta } from "../shared/types.ts";
import { DESTINATIONS, ORIGINS, getDestination } from "./data/destinations.ts";
import { explore, monthOverview, stayOptions, yearFor, baseFlightFrom } from "./engine.ts";
import { cheapestAnywhere, flightCalendar, liveFlightsEnabled } from "./providers/flights.ts";
import { buildPackage } from "./packages.ts";
import { agentEnabled, runAgent } from "./agent.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

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

const monthKey = (month: number, year: number) => `${year}-${String(month).padStart(2, "0")}`;

app.get("/api/meta", (_req, res) => {
  const meta: Meta = {
    origins: ORIGINS,
    interests: [...INTERESTS],
    regions: [...REGIONS],
    liveFlights: liveFlightsEnabled,
    agent: agentEnabled,
    usdArsRate: Number(process.env.USD_ARS_RATE) || 1450,
  };
  res.json(meta);
});

app.get("/api/destinations", (_req, res) => {
  res.json(DESTINATIONS);
});

app.get("/api/destinations/:id", (req, res) => {
  const dest = getDestination(req.params.id);
  if (!dest) return void res.status(404).json({ error: "Destino no encontrado" });
  const q = z
    .object({
      origin: originCode,
      nights: z.coerce.number().int().min(1).max(60).default(7),
      travelers: z.coerce.number().int().min(1).max(12).default(2),
      style: style.default("mid"),
    })
    .parse(req.query);
  res.json({
    destination: dest,
    baseFlightUSD: baseFlightFrom(q.origin, dest),
    months: monthOverview(q.origin, dest, q.nights, q.travelers, q.style),
  });
});

app.post("/api/explore", async (req, res) => {
  const body = exploreSchema.parse(req.body);
  const live =
    body.month != null && liveFlightsEnabled
      ? await cheapestAnywhere(body.origin, monthKey(body.month, body.year ?? yearFor(body.month)))
      : undefined;
  res.json(explore(body, live));
});

app.get("/api/flights/calendar", async (req, res) => {
  const q = z
    .object({
      origin: originCode,
      dest: z.string(),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      nights: z.coerce.number().int().min(1).max(60).default(7),
    })
    .parse(req.query);
  const dest = getDestination(q.dest);
  if (!dest) return void res.status(404).json({ error: "Destino no encontrado" });
  res.json(await flightCalendar(q.origin, dest, q.month, q.nights));
});

app.get("/api/stays", (req, res) => {
  const q = z
    .object({
      dest: z.string(),
      checkin: isoDate,
      nights: z.coerce.number().int().min(1).max(60).default(7),
      travelers: z.coerce.number().int().min(1).max(12).default(2),
    })
    .parse(req.query);
  const dest = getDestination(q.dest);
  if (!dest) return void res.status(404).json({ error: "Destino no encontrado" });
  res.json(stayOptions(dest, q.checkin, q.nights, q.travelers));
});

app.post("/api/packages/build", (req, res) => {
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
    .parse(req.body);
  const dest = getDestination(body.destinationId);
  if (!dest) return void res.status(404).json({ error: "Destino no encontrado" });
  res.json(buildPackage({ ...body, dest }));
});

app.post("/api/agent", async (req, res) => {
  if (!agentEnabled) {
    return void res.status(503).json({
      error: "El agente no está configurado. Agregá ANTHROPIC_API_KEY en el archivo .env y reiniciá el servidor.",
    });
  }
  const body = z
    .object({
      messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
        .min(1)
        .max(40),
      profile: profileSchema,
    })
    .parse(req.body);
  if (body.messages[0].role !== "user" || body.messages.at(-1)!.role !== "user") {
    return void res.status(400).json({ error: "La conversación debe empezar y terminar con un mensaje del usuario." });
  }
  res.json(await runAgent(body.messages, body.profile));
});

// Errores: validación → 400, el resto → 500.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return void res.status(400).json({ error: "Parámetros inválidos", details: err.issues });
  }
  console.error(err);
  res.status(500).json({ error: "Algo salió mal. Probá de nuevo en un momento." });
});

// En producción servimos el build de Vite.
if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`FindMyTrip API en http://localhost:${port}`);
  console.log(`  vuelos en vivo: ${liveFlightsEnabled ? "sí (Travelpayouts)" : "no (estimaciones)"}`);
  console.log(`  agente IA:      ${agentEnabled ? "sí" : "no (falta ANTHROPIC_API_KEY)"}`);
});
