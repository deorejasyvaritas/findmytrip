import { afterEach, describe, expect, it, vi } from "vitest";
import { connectTelegram, evaluateAlerts, saveSettings, telegramLink, upsertSub } from "../server/alerts.ts";
import { useCacheStore } from "../server/cache.ts";
import { runRadar } from "../server/radar.ts";

useCacheStore(undefined); // memoria

function mockAPIs(prices: Record<string, number>, telegram: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        telegram.push(JSON.parse(String(init?.body)).text);
        return Response.json({ ok: true });
      }
      if (url.includes("prices/cheap") && url.includes("depart_date=2026-11")) {
        const data = Object.fromEntries(
          Object.entries(prices).map(([code, price]) => [
            code,
            { "0": { price, airline: "H2", flight_number: 1820, departure_at: "2026-11-14T08:00:00-03:00", return_at: "2026-11-21T10:00:00-03:00" } },
          ]),
        );
        return Response.json({ success: true, data });
      }
      return Response.json({ success: true, data: {} });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("radar", () => {
  it("compara contra el historial y marca bajas, mínimos y ofertas", async () => {
    const t0 = new Date("2026-10-13T12:00:00Z");
    for (const [i, p] of [400, 410, 405].entries()) {
      mockAPIs({ SSA: p });
      await runRadar("tok", "BUE", new Date(t0.getTime() + i * 6 * 3600000));
    }
    mockAPIs({ SSA: 300 });
    const snap = await runRadar("tok", "BUE", new Date(t0.getTime() + 24 * 3600000));
    const ssa = snap.items.find((i) => i.destinationId === "salvador")!;
    expect(ssa).toMatchObject({ priceUSD: 300, typicalUSD: 405, baseline: "historial", trend: "down", isMinimum: true, isDeal: true });
    expect(ssa.discountPct).toBe(26);
    // 40 + 26 × 1,5 + 10 (mínimo) + 4 (bajó) = 93, con 26 % de descuento: "Excelente"
    expect(ssa).toMatchObject({ radarScore: 93, tier: "Excelente" });
    expect(snap.stats).toMatchObject({ down: 1, minimums: 1, deals: 1 });
  });

  it("si Travelpayouts no responde, conserva la última foto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const snap = await runRadar("tok", "BUE", new Date("2026-10-15T12:00:00Z"));
    expect(snap.items.find((i) => i.destinationId === "salvador")?.priceUSD).toBe(300);
  });

  it("detecta ofertas frente al precio estimado cuando todavía no hay historial", async () => {
    mockAPIs({ MCZ: 150, GIG: 9999 });
    const snap = await runRadar("tok", "ROS", new Date("2026-10-13T12:00:00Z"));
    const maceio = snap.items.find((i) => i.destinationId === "maceio")!;
    expect(maceio).toMatchObject({ priceUSD: 150, baseline: "estimado", isDeal: true, airline: "H2", flightNumber: "H21820" });
    expect(maceio.discountPct).toBeGreaterThan(50);
    // Contra un precio estimado el puntaje queda topeado en 85
    expect(maceio).toMatchObject({ radarScore: 85, tier: "Muy buena" });
    expect(snap.items[0].destinationId).toBe("maceio"); // la mejor oferta primero
    expect(snap.byMonth.maceio["2026-11"]).toMatchObject({ p: 150, dep: "2026-11-14" });
  });
});

describe("alertas", () => {
  it("avisa por Telegram cuando un destino seguido entra en el presupuesto, una sola vez por precio", async () => {
    await saveSettings("javier", { radarDeals: false, minDiscount: 25, telegramChatId: "42" });
    await upsertSub("javier", {
      id: "maceio",
      destinationId: "maceio",
      origin: "MDZ",
      targetUSD: 5000,
      nights: 7,
      month: 11,
      party: { adults: 2, childAges: [], bags: "cabin" },
      style: "mid",
      createdAt: "2026-10-01T00:00:00Z",
    });
    const sent: string[] = [];
    mockAPIs({ MCZ: 300 }, sent);
    const snap = await runRadar("tok", "MDZ", new Date("2026-10-13T12:00:00Z"));
    expect((await evaluateAlerts("javier", snap, { token: "bot", siteUrl: "https://x.dev" })).sent).toBe(1);
    expect(sent[0]).toContain("Maceió entró en tu presupuesto");
    expect(sent[0]).toContain("https://x.dev/destino/maceio");
    // Mismo precio en el siguiente barrido: no repite.
    expect((await evaluateAlerts("javier", snap, { token: "bot" })).sent).toBe(0);
  });

  it("avisa ofertas del radar por encima del descuento mínimo", async () => {
    await saveSettings("javier", { radarDeals: true, minDiscount: 30, telegramChatId: "42", origin: "TUC" });
    const sent: string[] = [];
    mockAPIs({ FLN: 90 }, sent);
    const snap = await runRadar("tok", "TUC", new Date("2026-10-13T12:00:00Z"));
    await evaluateAlerts("javier", snap, { token: "bot" });
    expect(sent.some((m) => m.startsWith("Oferta del radar: Florianópolis"))).toBe(true);
  });

  it("sin Telegram conectado no manda nada", async () => {
    await saveSettings("ana", { radarDeals: true, minDiscount: 5, origin: "SLA" });
    mockAPIs({ FLN: 90 });
    const snap = await runRadar("tok", "SLA", new Date("2026-10-13T12:00:00Z"));
    expect((await evaluateAlerts("ana", snap, { token: "bot" })).sent).toBe(0);
  });

  it("conecta Telegram solo con el código de la cuenta", async () => {
    let updates: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/getMe")) return Response.json({ ok: true, result: { username: "findmytrip_bot" } });
        if (url.includes("/getUpdates")) return Response.json({ ok: true, result: updates });
        return Response.json({ ok: true });
      }),
    );
    const link = await telegramLink("bot", "pedro");
    expect(link.url).toMatch(/^https:\/\/t\.me\/findmytrip_bot\?start=\w+$/);
    const code = link.url!.split("start=")[1];
    expect((await connectTelegram("bot", "pedro")).error).toContain("Todavía no llegó ningún mensaje a @findmytrip_bot");
    updates = [{ message: { text: "/start", chat: { id: 7, first_name: "Otro" } } }];
    expect((await connectTelegram("bot", "pedro")).error).toContain("no el código");
    updates.push({ message: { text: `/start ${code}`, chat: { id: 99, first_name: "Pedro" } } });
    expect(await connectTelegram("bot", "pedro")).toEqual({ ok: true, name: "Pedro" });
  });
});
