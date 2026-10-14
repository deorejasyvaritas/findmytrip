import { describe, expect, it } from "vitest";
import type { RadarItem } from "../shared/types.ts";
import { bestDeal, pickHeroTiles, shortRange, tileHref } from "../src/lib/hero-picks.ts";
import { netChange, type ItemDiff } from "../shared/recheck.ts";

const item = (id: string, over: Partial<RadarItem> = {}): RadarItem => ({
  destinationId: id,
  name: id.toUpperCase(),
  iata: "XXX",
  priceUSD: 400,
  typicalUSD: 400,
  discountPct: 0,
  baseline: "historial",
  trend: "same",
  isMinimum: false,
  isDeal: false,
  depart: "2026-12-10",
  ret: "2026-12-17",
  score: 0,
  ...over,
});

const REGION: Record<string, string> = { rio: "Brasil", flor: "Brasil", salvador: "Brasil", cusco: "Sudamérica", madrid: "Europa", bariloche: "Argentina" };
const photos = Object.fromEntries(Object.keys(REGION).map((id) => [id, `https://img/${id}.jpg`]));
const opts = {
  photos,
  regionOf: (id: string) => REGION[id],
  nameOf: (id: string) => (REGION[id] ? id.toUpperCase() : undefined),
  fallbackIds: ["flor", "rio", "cusco", "madrid"],
  today: "2026-10-14",
};

describe("bestDeal", () => {
  it("elige el mayor descuento con historial real", () => {
    const pick = bestDeal([
      item("rio", { discountPct: 20, priceUSD: 300, typicalUSD: 375 }),
      item("cusco", { discountPct: 40, baseline: "estimado", priceUSD: 240, typicalUSD: 400 }),
      item("madrid", { discountPct: 25, priceUSD: 900, typicalUSD: 1200 }),
    ]);
    expect(pick?.destinationId).toBe("madrid");
  });

  it("sin descuentos con historial, la más barata frente a su habitual", () => {
    const pick = bestDeal([
      item("rio", { priceUSD: 380, typicalUSD: 400 }),
      item("cusco", { priceUSD: 300, typicalUSD: 400, baseline: "estimado", discountPct: 25 }),
      item("madrid", { priceUSD: 1300, typicalUSD: 1200 }),
    ]);
    expect(pick?.destinationId).toBe("cusco");
  });
});

describe("pickHeroTiles", () => {
  it("la grande es la oferta del día y las otras dos de regiones distintas", () => {
    const tiles = pickHeroTiles(
      [
        item("rio", { discountPct: 30, priceUSD: 280, typicalUSD: 400, score: 30 }),
        item("flor", { discountPct: 10, score: 25 }),
        item("salvador", { discountPct: 8, score: 20 }),
        item("madrid", { score: 5, priceUSD: 1100, typicalUSD: 1150 }),
        item("cusco", { score: 1 }),
      ],
      opts,
    );
    expect(tiles.map((t) => t.destinationId)).toEqual(["rio", "madrid", "cusco"]);
    expect(tiles[0]).toMatchObject({ priceUSD: 280, deal: true, month: "2026-12", depart: "2026-12-10" });
    expect(tiles[1].deal).toBe(false);
  });

  it("sin descuento real no dice que hoy conviene", () => {
    const tiles = pickHeroTiles([item("rio"), item("madrid"), item("cusco", { baseline: "estimado", discountPct: 30, priceUSD: 280 })], opts);
    expect(tiles[0].destinationId).toBe("cusco");
    expect(tiles[0].deal).toBe(false);
  });

  it("descarta destinos sin foto y salidas pasadas", () => {
    const tiles = pickHeroTiles(
      [
        item("lima", { discountPct: 50 }),
        item("rio", { discountPct: 40, depart: "2026-10-01", ret: "2026-10-08" }),
        item("madrid"),
        item("cusco"),
        item("bariloche"),
      ],
      opts,
    );
    expect(tiles.map((t) => t.destinationId)).not.toContain("lima");
    expect(tiles.map((t) => t.destinationId)).not.toContain("rio");
    expect(tiles).toHaveLength(3);
  });

  it("sin radar: fotos del catálogo y ningún precio", () => {
    for (const items of [null, [], [item("rio")]]) {
      const tiles = pickHeroTiles(items, opts);
      expect(tiles.map((t) => t.destinationId)).toEqual(["flor", "cusco", "madrid"]);
      expect(tiles.every((t) => t.priceUSD === undefined && !t.deal && !t.month)).toBe(true);
    }
  });

  it("sin fotos suficientes no arma el mosaico", () => {
    expect(pickHeroTiles(null, { ...opts, photos: { rio: "x" } })).toEqual([]);
  });
});

describe("fechas y links", () => {
  it("rango corto", () => {
    expect(shortRange("2026-12-10", "2026-12-17")).toBe("10 al 17 dic");
    expect(shortRange("2026-11-28", "2026-12-05")).toBe("28 nov al 5 dic");
  });

  it("abre la ficha en el mes y la fecha de la oferta", () => {
    expect(tileHref({ destinationId: "rio", name: "Río", deal: false })).toBe("/destino/rio");
    expect(tileHref({ destinationId: "rio", name: "Río", deal: true, month: "2026-12", depart: "2026-12-10", ret: "2026-12-17" })).toBe(
      "/destino/rio?month=2026-12&depart=2026-12-10&nights=7",
    );
  });
});

describe("netChange", () => {
  const d = (status: ItemDiff["status"], deltaUSD: number) => ({ i: 0, status, deltaUSD, newAmountUSD: 0, canUpdate: false, result: {} }) as ItemDiff;
  it("suma solo los precios exactos", () => {
    expect(netChange([d("subio", 40), d("bajo", -10), d("otro-dia", 500)])).toEqual({ status: "subio", deltaUSD: 30 });
    expect(netChange([d("bajo", -25)])).toEqual({ status: "bajo", deltaUSD: -25 });
    expect(netChange([d("igual", 0)])).toEqual({ status: "igual", deltaUSD: 0 });
    expect(netChange([d("sin-precio", 0)])).toBeNull();
  });
});
