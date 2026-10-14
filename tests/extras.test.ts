import { afterEach, describe, expect, it, vi } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { extrasFor } from "../shared/extras.ts";
import { partnerLinks } from "../server/partner-links.ts";

afterEach(() => vi.unstubAllGlobals());

describe("extras del viaje", () => {
  it("arma traslado, auto, excursiones, entradas, eSIM y seguro según el destino", () => {
    expect(extrasFor(getDestination("lisboa")!).map((x) => x.kind)).toEqual(["traslado", "auto", "excursiones", "entradas", "esim", "seguro"]);
    expect(extrasFor(getDestination("lisboa")!).find((x) => x.kind === "esim")?.url).toBe("https://www.airalo.com/portugal-esim");
    // Dentro de Argentina no hace falta eSIM, seguro internacional ni entradas de Tiqets; el auto sí suma.
    expect(extrasFor(getDestination("bariloche")!).map((x) => x.kind)).toEqual(["traslado", "auto", "excursiones"]);
  });

  it("ofrece auto solo donde conviene y nunca más de seis tarjetas", async () => {
    const { DESTINATIONS } = await import("../server/data/destinations.ts");
    for (const id of ["nueva-york", "paris", "japon", "madrid", "galapagos"]) {
      expect(extrasFor(getDestination(id)!).some((x) => x.kind === "auto")).toBe(false);
    }
    expect(extrasFor(getDestination("bariloche")!).find((x) => x.kind === "auto")?.url).toBe("https://localrent.com/es/argentina/");
    expect(extrasFor(getDestination("roma")!).find((x) => x.kind === "entradas")?.url).toBe("https://www.tiqets.com/es/search?q=Roma");
    for (const d of DESTINATIONS) expect(extrasFor(d).length).toBeLessThanOrEqual(6);
  });

  it("Localrent y Tiqets van por la API de links (sin ids inventados)", async () => {
    const fn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ result: { links: [{ url: body.links[0].url, code: "success", partner_url: `https://tp.media/r?u=${encodeURIComponent(body.links[0].url)}` }] } });
    });
    vi.stubGlobal("fetch", fn);
    const urls = ["https://localrent.com/es/greece/", "https://www.tiqets.com/es/search?q=Atenas"];
    const r = await partnerLinks({ token: "t", marker: "789588", trs: "585192" }, urls);
    expect(fn).toHaveBeenCalledTimes(2);
    for (const u of urls) expect(r[u]).toBe(`https://tp.media/r?u=${encodeURIComponent(u)}`);
  });

  it("convierte los links con la API de Travelpayouts solo si hay TRS", async () => {
    const fn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ trs: 123, marker: 789588, shorten: false });
      return Response.json({ result: { links: [{ url: body.links[0].url, code: "success", partner_url: "https://tp.media/r?x=1" }] } });
    });
    vi.stubGlobal("fetch", fn);
    const url = "https://www.tiqets.com/es/";
    expect(await partnerLinks({ token: "t", marker: "789588" }, [url])).toEqual({ [url]: url });
    expect(fn).not.toHaveBeenCalled();
    expect(await partnerLinks({ token: "t", marker: "789588", trs: "123" }, [url])).toEqual({ [url]: "https://tp.media/r?x=1" });
  });

  it("arma el link directo para los programas conocidos, sin API", async () => {
    const fn = vi.fn();
    vi.stubGlobal("fetch", fn);
    const url = "https://www.airalo.com/peru-esim";
    const r = await partnerLinks({ marker: "789588", trs: "585192" }, [url]);
    expect(r[url]).toBe(`https://tp.media/r?campaign_id=541&marker=789588&p=8310&trs=585192&u=${encodeURIComponent(url)}`);
    expect(fn).not.toHaveBeenCalled();
  });
});
