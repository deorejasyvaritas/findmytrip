import { afterEach, describe, expect, it, vi } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { extrasFor } from "../shared/extras.ts";
import { partnerLinks } from "../server/partner-links.ts";

afterEach(() => vi.unstubAllGlobals());

describe("extras del viaje", () => {
  it("arma traslado, excursiones, eSIM y seguro según el destino", () => {
    expect(extrasFor(getDestination("lisboa")!).map((x) => x.kind)).toEqual(["traslado", "excursiones", "esim", "seguro"]);
    expect(extrasFor(getDestination("lisboa")!).find((x) => x.kind === "esim")?.url).toBe("https://www.airalo.com/portugal-esim");
    // Dentro de Argentina no hace falta eSIM ni seguro internacional.
    expect(extrasFor(getDestination("bariloche")!).map((x) => x.kind)).toEqual(["traslado", "excursiones"]);
  });

  it("convierte los links con la API de Travelpayouts solo si hay TRS", async () => {
    const fn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ trs: 123, marker: 789588, shorten: false });
      return Response.json({ result: { links: [{ url: body.links[0].url, code: "success", partner_url: "https://tp.media/r?x=1" }] } });
    });
    vi.stubGlobal("fetch", fn);
    const url = "https://www.airalo.com/peru-esim";
    expect(await partnerLinks({ token: "t", marker: "789588" }, [url])).toEqual({ [url]: url });
    expect(fn).not.toHaveBeenCalled();
    expect(await partnerLinks({ token: "t", marker: "789588", trs: "123" }, [url])).toEqual({ [url]: "https://tp.media/r?x=1" });
  });
});
