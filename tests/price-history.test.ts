import { describe, expect, it } from "vitest";
import { chartGeometry, historySentence, nearestIndex, summarizeHistory, type PricePoint } from "../shared/price-history.ts";
import { saveJSON, useCacheStore } from "../server/cache.ts";
import { routeHistory } from "../server/radar.ts";

useCacheStore(undefined); // memoria

const pts = (...prices: number[]): PricePoint[] =>
  prices.map((p, i) => ({ t: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), p }));

describe("historial de precios", () => {
  it("no resume si hay menos de 3 puntos", () => {
    expect(summarizeHistory(pts(500, 480))).toBeNull();
    expect(summarizeHistory([])).toBeNull();
  });

  it("compara el precio de hoy contra la mediana de lo anterior", () => {
    const s = summarizeHistory(pts(500, 520, 480, 400))!;
    expect(s).toMatchObject({ typical: 500, current: 400, min: 400, max: 520, deltaPct: -20, verdict: "below" });
    expect(s.minIndex).toBe(3);
    expect(historySentence(s)).toBe("Hoy está 20 % por debajo de lo habitual.");
  });

  it("dice por encima y en su precio habitual", () => {
    const up = summarizeHistory(pts(400, 400, 400, 460))!;
    expect(up.verdict).toBe("above");
    expect(historySentence(up)).toBe("Hoy está 15 % por encima de lo habitual.");
    const same = summarizeHistory(pts(400, 410, 405))!;
    expect(same.verdict).toBe("typical");
    expect(historySentence(same)).toBe("Hoy está en su precio habitual.");
  });

  it("ordena por fecha y descarta datos rotos", () => {
    const raw = [...pts(300, 310, 320)].reverse();
    raw.push({ t: "no", p: 1 }, { t: raw[0].t, p: Number.NaN });
    const s = summarizeHistory(raw)!;
    expect(s.points.map((o) => o.p)).toEqual([300, 310, 320]);
    expect(s.current).toBe(320);
  });

  it("ubica los puntos por tiempo y deja aire en los bordes", () => {
    const raw = pts(500, 400, 600);
    raw[2].t = new Date(Date.UTC(2026, 9, 5)).toISOString(); // salto de 3 días
    const s = summarizeHistory(raw)!;
    const g = chartGeometry(s);
    expect(g.xy.map((p) => p.x)).toEqual([0, 25, 100]);
    for (const p of g.xy) expect(p.y).toBeGreaterThan(0), expect(p.y).toBeLessThan(100);
    expect(g.xy[2].y).toBeLessThan(g.xy[1].y); // más caro, más arriba
    expect(g.line.startsWith("M0 ")).toBe(true);
    expect(g.area.endsWith("Z")).toBe(true);
    expect(nearestIndex(g.xy, 70)).toBe(2);
    expect(nearestIndex(g.xy, 10)).toBe(0);
  });

  it("no se rompe con precios iguales", () => {
    const g = chartGeometry(summarizeHistory(pts(300, 300, 300))!);
    expect(g.xy.every((p) => Number.isFinite(p.y))).toBe(true);
  });

  it("devuelve el historial compacto de una ruta", async () => {
    await saveJSON("radar:hist:COR", { salvador: [{ t: "2026-10-01T10:17:03.120Z", p: 420 }] });
    expect(await routeHistory("COR", "salvador")).toEqual([{ t: "2026-10-01T10:17Z", p: 420 }]);
    expect(await routeHistory("COR", "otro")).toEqual([]);
  });
});
