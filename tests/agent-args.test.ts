import { describe, expect, it } from "vitest";
import { z } from "zod";
import { repairArgs, resolveDestinationId, runAgent } from "../server/agent.ts";
import type { Profile } from "../shared/types.ts";

const schema = z.object({
  budgetUSD: z.number().optional(),
  nights: z.number().int().min(1).max(60).optional(),
  month: z.number().int().min(1).max(12).optional(),
  style: z.enum(["low", "mid", "high"]).optional(),
  interests: z.array(z.enum(["playa", "montaña", "ciudad"])).optional(),
  destinationId: z.string(),
});

describe("parámetros de la IA gratuita", () => {
  it("corrige números como texto, meses, enums y nombres de destino", () => {
    const r = repairArgs(schema, { budgetUSD: "USD 3.000", nights: "9", month: "enero", style: "LOW", interests: "Playa, Montana", destinationId: "Florianópolis" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ budgetUSD: 3000, nights: 9, month: 1, style: "low", interests: ["playa", "montaña"], destinationId: "florianopolis" });
  });

  it("saca lo opcional que sigue mal en vez de fallar", () => {
    const r = repairArgs(schema, { budgetUSD: "mucho", nights: 900, style: "barato", destinationId: "rio" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ destinationId: "rio" });
  });

  it("reconoce destinos por nombre", () => {
    expect(resolveDestinationId("Lisboa y Oporto")).toBe("lisboa");
    expect(resolveDestinationId("lisboa")).toBe("lisboa");
    expect(resolveDestinationId("Atlantis")).toBeUndefined();
  });
});

describe("Trippy con la IA gratuita", () => {
  it("busca aunque la IA mande los datos como texto, y no habla de errores", async () => {
    const calls: unknown[] = [];
    let round = 0;
    const ai = {
      run: async (_model: string, input: Record<string, unknown>) => {
        calls.push(input);
        round++;
        if (round === 1) return { tool_calls: [{ name: "explorar_destinos", arguments: { budgetUSD: "3000", nights: "9", month: "enero" } }] };
        const last = (input.messages as { content: string }[]).at(-1)!.content;
        return { response: last.includes("no se pudo") ? "hubo un problema con los parámetros" : "Te recomiendo Florianópolis." };
      },
    };
    const profile: Profile = { name: "", origin: "BUE", travelers: 2, style: "mid", interests: [], currency: "USD", visited: [], maxFlightHours: null };
    const reply = await runAgent({ AI: ai } as never, [{ role: "user", content: "playa en enero" }], profile, new Date("2026-10-15T12:00:00Z"));
    expect(reply.text).toBe("Te recomiendo Florianópolis.");
  });
});
