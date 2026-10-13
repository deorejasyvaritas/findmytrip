import { describe, expect, it, vi } from "vitest";
import { cached, peek, useCacheStore, type KVStore } from "../server/cache.ts";

function fakeKV() {
  const data = new Map<string, string>();
  const kv: KVStore & { data: Map<string, string> } = {
    data,
    get: async (k) => (data.has(k) ? JSON.parse(data.get(k)!) : null),
    put: vi.fn(async (k: string, v: string) => void data.set(k, v)),
  };
  return kv;
}

describe("caché", () => {
  it("guarda en KV y no repite la búsqueda", async () => {
    const kv = fakeKV();
    useCacheStore(kv);
    const load = vi.fn(async () => ({ price: 100 }));
    expect(await cached("k1", 3600, load)).toEqual({ price: 100 });
    expect(await cached("k1", 3600, load)).toEqual({ price: 100 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith("k1", '{"price":100}', { expirationTtl: 3600 });
    useCacheStore(undefined);
  });

  it("lee de KV aunque el Worker se haya reiniciado (sin memoria)", async () => {
    const kv = fakeKV();
    kv.data.set("k2", '{"price":7}');
    useCacheStore(kv);
    const load = vi.fn(async () => ({ price: 999 }));
    expect(await cached("k2", 60, load)).toEqual({ price: 7 });
    expect(load).not.toHaveBeenCalled();
    useCacheStore(undefined);
  });

  it("peek no llama a la API y no cachea null", async () => {
    expect(await peek("nada")).toBeNull();
    const load = vi.fn(async () => null);
    expect(await cached("k3", 60, load)).toBeNull();
    expect(await cached("k3", 60, load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
