import { describe, expect, it } from "vitest";
import { getDestination } from "../server/data/destinations.ts";
import { hotelQuery, nearDestination } from "../server/providers/hotels.ts";

describe("hoteles reales", () => {
  const aruba = getDestination("aruba")!;

  it("busca sin repetir el país cuando coincide con el nombre", () => {
    expect(hotelQuery(aruba)).toBe("hoteles en Aruba");
    expect(hotelQuery(getDestination("lisboa")!)).toBe("hoteles en Lisboa, Portugal");
  });

  it("descarta hoteles lejos del destino", () => {
    expect(nearDestination(aruba, { gps_coordinates: { latitude: -41.05, longitude: -71.53 } })).toBe(false);
    expect(nearDestination(aruba, { gps_coordinates: { latitude: 12.55, longitude: -70.06 } })).toBe(true);
    expect(nearDestination(aruba, {})).toBe(false);
  });
});
