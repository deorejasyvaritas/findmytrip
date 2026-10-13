import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Interest, Profile, Region, Style, TripPackage } from "../shared/types.ts";
import { DESTINATIONS, getDestination } from "./data/destinations.ts";
import { explore, monthOverview, monthName, stayOptions } from "./engine.ts";
import { cheapestAnywhere, flightCalendar } from "./providers/flights.ts";
import { buildPackage } from "./packages.ts";

export const agentEnabled = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const client = agentEnabled ? new Anthropic() : null;
const MODEL = "claude-opus-5-5";

const INTERESTS = [
  "playa", "montaña", "ciudad", "gastronomía", "aventura", "nieve",
  "cultura", "naturaleza", "relax", "noche", "compras",
] as const satisfies readonly Interest[];
const REGIONS = [
  "Argentina", "Sudamérica", "Caribe y Centroamérica", "Norteamérica",
  "Europa", "Asia", "África y Medio Oriente",
] as const satisfies readonly Region[];
const STYLES = ["low", "mid", "high"] as const satisfies readonly Style[];

const catalog = DESTINATIONS.map(
  (d) => `- ${d.id}: ${d.name} (${d.country}) · ${d.tags.join(", ")}${d.hiddenGem ? " · joya poco conocida" : ""}`,
).join("\n");

// Prompt estático (se cachea). Lo que cambia por usuario va en un bloque aparte.
const SYSTEM = `Sos FindMyTrip, el agente de viajes personal del usuario. Hablás en español rioplatense, con calidez y sin vueltas.

Tu trabajo es ayudarlo a viajar lo mejor posible con su presupuesto:
- Buscar destinos que entren en su presupuesto, por fecha o por destino.
- Sugerir activamente lugares que quizás no está considerando y que le pueden gustar (usá los destinos marcados como "joya poco conocida" cuando encajen).
- Encontrar los meses y días más baratos para volar.
- Armar paquetes (vuelo + alojamiento + gastos diarios) que el usuario pueda guardar.

Cómo trabajar:
- Usá las herramientas para obtener precios; no inventes números. Los precios son estimaciones en USD salvo que la herramienta diga "en vivo"; aclaralo brevemente.
- Si falta un dato clave (presupuesto, cantidad de noches), asumí algo razonable a partir del perfil y decilo, en vez de frenar la conversación con preguntas.
- Cuando el usuario muestre interés concreto en un destino y fechas, proponé un paquete con la herramienta proponer_paquete para que pueda guardarlo.
- Respondé breve y escaneable: listas cortas, montos redondeados, y siempre una recomendación clara. Nada de relleno.
- Mencioná documentación necesaria (DNI/pasaporte/visa) cuando sea relevante, recordando que es orientativo.

Catálogo de destinos disponibles (id: nombre · intereses):
${catalog}`;

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentReply {
  text: string;
  packages: TripPackage[];
}

export async function runAgent(messages: AgentMessage[], profile: Profile, today = new Date()): Promise<AgentReply> {
  if (!client) throw new Error("El agente no está configurado (falta ANTHROPIC_API_KEY).");

  const proposals: TripPackage[] = [];
  const origin = profile.origin || "BUE";
  const json = (v: unknown) => JSON.stringify(v);

  const tools = [
    betaZodTool({
      name: "explorar_destinos",
      description:
        "Busca destinos que entran en un presupuesto total (todo el grupo, en USD) y los rankea según intereses, época y presupuesto. Si no se indica mes, busca el mejor mes de los próximos 12. Devuelve sugerencias principales y alternativas que el usuario quizás no consideró.",
      inputSchema: z.object({
        budgetUSD: z.number().describe("Presupuesto total del grupo en USD"),
        nights: z.number().int().min(1).max(60),
        travelers: z.number().int().min(1).max(12).optional(),
        month: z.number().int().min(1).max(12).optional().describe("Mes de viaje 1-12; omitir si es flexible"),
        style: z.enum(STYLES).optional(),
        interests: z.array(z.enum(INTERESTS)).optional(),
        regions: z.array(z.enum(REGIONS)).optional(),
        maxFlightHours: z.number().optional(),
      }),
      run: async (input) => {
        const month = input.month ?? null;
        const live =
          month != null
            ? await cheapestAnywhere(origin, `${today.getUTCFullYear() + (month < today.getUTCMonth() + 1 ? 1 : 0)}-${String(month).padStart(2, "0")}`)
            : undefined;
        const res = explore(
          {
            origin,
            budgetUSD: input.budgetUSD,
            nights: input.nights,
            travelers: input.travelers ?? profile.travelers,
            month,
            style: input.style ?? profile.style,
            interests: input.interests ?? profile.interests,
            regions: input.regions,
            exclude: profile.visited,
            maxFlightHours: input.maxFlightHours ?? profile.maxFlightHours,
          },
          live,
          today,
        );
        const compact = (s: (typeof res.suggestions)[number]) => ({
          id: s.destination.id,
          nombre: s.destination.name,
          mes: `${monthName(s.month)} ${s.year}`,
          totalUSD: s.cost.total,
          porPersonaUSD: s.cost.perPerson,
          vuelosUSD: s.cost.flights,
          alojamientoUSD: s.cost.lodging,
          gastosUSD: s.cost.daily,
          encaje: s.fit,
          motivos: s.reasons,
          fuenteVuelo: s.flightSource,
          docs: s.destination.docs,
        });
        return json({
          origen: origin,
          principales: res.suggestions.slice(0, 8).map(compact),
          alternativas: res.alternatives.map(compact),
        });
      },
    }),
    betaZodTool({
      name: "precios_por_mes",
      description: "Costo estimado por persona de un destino para cada uno de los próximos 12 meses, marcando los más convenientes.",
      inputSchema: z.object({
        destinationId: z.string(),
        nights: z.number().int().min(1).max(60),
        travelers: z.number().int().min(1).max(12).optional(),
        style: z.enum(STYLES).optional(),
      }),
      run: async (input) => {
        const dest = getDestination(input.destinationId);
        if (!dest) return `Destino desconocido: ${input.destinationId}`;
        const rows = monthOverview(origin, dest, input.nights, input.travelers ?? profile.travelers, input.style ?? profile.style, today);
        return json(rows.map((r) => ({ mes: `${monthName(r.month)} ${r.year}`, vueloPP: r.flightUSD, totalPP: r.totalPerPersonUSD, recomendado: r.best })));
      },
    }),
    betaZodTool({
      name: "calendario_vuelos",
      description: "Precios de vuelo ida y vuelta por persona para cada día de salida de un mes. Devuelve los 5 días más baratos.",
      inputSchema: z.object({
        destinationId: z.string(),
        month: z.string().regex(/^\d{4}-\d{2}$/).describe("YYYY-MM"),
        nights: z.number().int().min(1).max(60),
      }),
      run: async (input) => {
        const dest = getDestination(input.destinationId);
        if (!dest) return `Destino desconocido: ${input.destinationId}`;
        const cal = await flightCalendar(origin, dest, input.month, input.nights);
        const top = [...cal.days].sort((a, b) => a.priceUSD - b.priceUSD).slice(0, 5);
        return json({ enVivo: cal.live, masBaratos: top });
      },
    }),
    betaZodTool({
      name: "alojamiento",
      description: "Opciones de alojamiento (económico, confort, premium) con precio estimado y zona recomendada.",
      inputSchema: z.object({
        destinationId: z.string(),
        checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        nights: z.number().int().min(1).max(60),
        travelers: z.number().int().min(1).max(12).optional(),
      }),
      run: async (input) => {
        const dest = getDestination(input.destinationId);
        if (!dest) return `Destino desconocido: ${input.destinationId}`;
        const stays = stayOptions(dest, input.checkin, input.nights, input.travelers ?? profile.travelers);
        return json(stays.map(({ links: _links, ...s }) => s));
      },
    }),
    betaZodTool({
      name: "proponer_paquete",
      description:
        "Arma un paquete concreto (vuelo + alojamiento + gastos) para un destino y fecha de salida. El usuario lo verá como tarjeta y podrá guardarlo en 'Mis viajes'.",
      inputSchema: z.object({
        destinationId: z.string(),
        departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        nights: z.number().int().min(1).max(60),
        travelers: z.number().int().min(1).max(12).optional(),
        style: z.enum(STYLES).optional(),
        notes: z.string().optional().describe("Tips o comentarios para el usuario"),
      }),
      run: async (input) => {
        const dest = getDestination(input.destinationId);
        if (!dest) return `Destino desconocido: ${input.destinationId}`;
        const travelers = input.travelers ?? profile.travelers;
        const style = input.style ?? profile.style;
        const cal = await flightCalendar(origin, dest, input.departDate.slice(0, 7), input.nights);
        const day = cal.days.find((d) => d.date === input.departDate);
        const pkg = buildPackage({
          dest,
          origin,
          departDate: input.departDate,
          nights: input.nights,
          travelers,
          style,
          flightPP: day?.priceUSD,
          notes: input.notes,
        });
        proposals.push(pkg);
        return json({ ok: true, totalUSD: pkg.totalUSD, items: pkg.items.map((i) => `${i.label}: USD ${i.amountUSD}`) });
      },
    }),
  ];

  const context = `Hoy es ${today.toISOString().slice(0, 10)}.
Perfil del usuario:
- Nombre: ${profile.name || "(sin nombre)"}
- Sale desde: ${origin}
- Viajeros: ${profile.travelers}
- Estilo: ${profile.style === "low" ? "económico" : profile.style === "mid" ? "confort" : "premium"}
- Intereses: ${profile.interests.join(", ") || "(sin definir)"}
- Ya visitó: ${profile.visited.join(", ") || "(nada cargado)"}
- Máx. horas de vuelo: ${profile.maxFlightHours ?? "sin límite"}`;

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 10,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: context },
    ],
    tools,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  if (final.stop_reason === "refusal") {
    return { text: "No puedo ayudarte con ese pedido. ¿Probamos con otra consulta de viaje?", packages: proposals };
  }
  const text = final.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { text: text || "Listo. ¿Querés que ajuste algo?", packages: proposals };
}
