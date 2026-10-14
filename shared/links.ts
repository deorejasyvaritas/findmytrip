// Links de reserva/comparación. La app arma el plan; la compra final se hace
// donde esté más barato, con la búsqueda ya precargada: misma ruta, mismas
// fechas (ida y vuelta) y el grupo real (adultos, niños y bebés), para que el
// total que se ve al pagar sea el del mismo viaje.

/** Grupo para armar links: cantidad de adultos o el detalle con la edad de cada menor. */
export type PartyLike = number | { adults: number; childAges?: number[] };

const yymmdd = (iso: string) => iso.slice(2, 10).replaceAll("-", "");
const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;

function normParty(p: PartyLike): { adults: number; childAges: number[] } {
  if (typeof p === "number") return { adults: Math.max(1, Math.round(p) || 1), childAges: [] };
  return { adults: Math.max(1, Math.round(p.adults) || 1), childAges: (p.childAges ?? []).filter((a) => a >= 0 && a < 18) };
}

/**
 * Pasajeros como los cuenta una aerolínea: desde 12 años es tarifa de adulto,
 * de 2 a 11 niño y menos de 2 bebé en brazos (máximo uno por adulto).
 */
export function flightPax(p: PartyLike): { adults: number; children: number; infants: number } {
  const { adults, childAges } = normParty(p);
  const grown = adults + childAges.filter((a) => a >= 12).length;
  const children = childAges.filter((a) => a >= 2 && a < 12).length;
  const babies = childAges.filter((a) => a < 2).length;
  // Bebés de más (más que adultos) viajan con asiento: cuentan como niños.
  const infants = Math.min(babies, grown);
  return { adults: Math.min(9, grown), children: Math.min(9, children + babies - infants), infants: Math.min(9, infants) };
}

/** Parte de pasajeros de la búsqueda de Aviasales: adultos, y niños y bebés si hay ("2", "21", "211", "201"). */
export function aviasalesPax(p: PartyLike): string {
  const { adults, children, infants } = flightPax(p);
  if (!children && !infants) return String(adults);
  return `${adults}${children}${infants || ""}`;
}

const withMarker = (url: string, marker?: string | null) => (marker ? `${url}${url.includes("?") ? "&" : "?"}marker=${marker}` : url);

/**
 * Búsqueda de Aviasales: /search/{DESDE}{DDMM}{HASTA}[{DDMM}]{pasajeros}.
 * Sin vuelta es solo ida. El precio en vivo que muestra Aviasales es para todo el grupo.
 */
export function aviasalesSearchUrl(o: {
  from: string;
  to: string;
  depart: string;
  ret?: string | null;
  party: PartyLike;
  marker?: string | null;
}): string {
  const path = `${o.from}${ddmm(o.depart)}${o.to}${o.ret ? ddmm(o.ret) : ""}${aviasalesPax(o.party)}`;
  return withMarker(`https://www.aviasales.com/search/${path}`, o.marker);
}

// /search/BUE1503RIO22031 (ida y vuelta) o /search/BUE1503RIO1 (solo ida): el final son los pasajeros.
const AVIASALES_PATH = /^(\/search\/[A-Z]{3}\d{4}[A-Z]{3}(?:\d{4})?)(\d{1,3})$/;

/**
 * Cambia los pasajeros de un link de Aviasales (los de la Data API vienen
 * siempre para 1 adulto). Otros links quedan igual.
 */
export function aviasalesForParty(url: string | null | undefined, party: PartyLike): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!/(^|\.)aviasales\.[a-z.]+$/.test(u.hostname)) return url;
  const m = AVIASALES_PATH.exec(u.pathname);
  if (!m) return url;
  u.pathname = `${m[1]}${aviasalesPax(party)}`;
  return u.toString();
}

/** Ruta y fechas de un link de búsqueda de Aviasales (para revisar precios de viajes viejos). */
export function parseAviasalesUrl(url: string | null | undefined, year: number): { from: string; to: string; depart: string; ret: string | null } | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = /^\/search\/([A-Z]{3})(\d{2})(\d{2})([A-Z]{3})(?:(\d{2})(\d{2}))?\d{1,3}$/.exec(path);
  if (!m) return null;
  const [, from, d1, m1, to, d2, m2] = m;
  const depart = `${year}-${m1}-${d1}`;
  // La vuelta en un mes "anterior" a la ida es del año siguiente.
  const ret = d2 && m2 ? `${Number(m2) < Number(m1) ? year + 1 : year}-${m2}-${d2}` : null;
  return { from, to, depart, ret };
}

export function flightLinks(
  origin: string,
  dest: string,
  depart: string,
  ret: string | null,
  party: PartyLike,
  marker?: string | null,
): { label: string; url: string }[] {
  const o = origin.toLowerCase();
  const d = dest.toLowerCase();
  const pax = flightPax(party);
  const { childAges } = normParty(party);
  const people = `${pax.adults} adults${pax.children ? ` ${pax.children} children` : ""}${pax.infants ? ` ${pax.infants} infants on lap` : ""}`;
  // Skyscanner pide la edad de cada menor (los de 12 o más ya cuentan como adultos).
  const kids = childAges.filter((a) => a < 12);
  const sky = new URLSearchParams({ adultsv2: String(pax.adults), cabinclass: "economy" });
  if (kids.length) sky.set("childrenv2", kids.join("|"));
  return [
    {
      // Buscador de Aviasales: búsqueda en tiempo real, sin cuota. Con tu marker ganás comisión.
      label: "Aviasales",
      url: aviasalesSearchUrl({ from: origin, to: dest, depart, ret, party, marker }),
    },
    {
      label: "Google Flights",
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        ret ? `Flights from ${origin} to ${dest} on ${depart} through ${ret} ${people}` : `One way flights from ${origin} to ${dest} on ${depart} ${people}`,
      )}&hl=es-419&curr=USD`,
    },
    {
      label: "Skyscanner",
      url: `https://www.skyscanner.com.ar/transporte/vuelos/${o}/${d}/${yymmdd(depart)}/${ret ? `${yymmdd(ret)}/` : ""}?${sky}`,
    },
    {
      label: "Despegar",
      url: `https://www.despegar.com.ar/shop/flights/results/${ret ? "roundtrip" : "oneway"}/${origin}/${dest}/${depart}/${ret ? `${ret}/` : ""}${pax.adults}/${pax.children}/${pax.infants}`,
    },
  ];
}

export function stayLinks(
  place: string,
  checkin: string,
  checkout: string,
  party: PartyLike,
  rooms: number,
): { label: string; url: string }[] {
  const q = encodeURIComponent(place);
  const { adults, childAges } = normParty(party);
  const booking = new URLSearchParams({
    ss: place,
    checkin,
    checkout,
    group_adults: String(adults),
    group_children: String(childAges.length),
    no_rooms: String(rooms),
    selected_currency: "USD",
  });
  for (const a of childAges) booking.append("age", String(a));
  const expedia = new URLSearchParams({ destination: place, startDate: checkin, endDate: checkout, adults: String(adults), rooms: String(rooms) });
  // Expedia: "1_5,1_8" = habitación 1, chicos de 5 y 8.
  if (childAges.length) expedia.set("children", childAges.map((a) => `1_${a}`).join(","));
  const airbnb = new URLSearchParams({ checkin, checkout, adults: String(adults), currency: "USD" });
  const kids = childAges.filter((a) => a >= 2).length;
  const babies = childAges.length - kids;
  if (kids) airbnb.set("children", String(kids));
  if (babies) airbnb.set("infants", String(babies));
  return [
    { label: "Booking", url: `https://www.booking.com/searchresults.es.html?${booking}` },
    { label: "Expedia", url: `https://www.expedia.com/Hotel-Search?${expedia}` },
    { label: "Airbnb", url: `https://www.airbnb.com.ar/s/${q}/homes?${airbnb}` },
  ];
}
