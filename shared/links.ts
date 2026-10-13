// Links de reserva/comparación. La app arma el plan; la compra final se hace
// donde esté más barato, con la búsqueda ya precargada.

const yymmdd = (iso: string) => iso.slice(2).replaceAll("-", "");

export function flightLinks(
  origin: string,
  dest: string,
  depart: string,
  ret: string,
  adults: number,
  marker?: string | null,
): { label: string; url: string }[] {
  const o = origin.toLowerCase();
  const d = dest.toLowerCase();
  const ddmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
  return [
    {
      // Buscador de Aviasales: búsqueda en tiempo real, sin cuota. Con tu marker ganás comisión.
      label: "Aviasales",
      url: `https://www.aviasales.com/search/${origin}${ddmm(depart)}${dest}${ddmm(ret)}${adults}${marker ? `?marker=${marker}` : ""}`,
    },
    {
      label: "Google Flights",
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        `Flights from ${origin} to ${dest} on ${depart} through ${ret} ${adults} adults`,
      )}&hl=es-419&curr=USD`,
    },
    {
      label: "Skyscanner",
      url: `https://www.skyscanner.com.ar/transporte/vuelos/${o}/${d}/${yymmdd(depart)}/${yymmdd(ret)}/?adultsv2=${adults}`,
    },
    {
      label: "Despegar",
      url: `https://www.despegar.com.ar/shop/flights/results/roundtrip/${origin}/${dest}/${depart}/${ret}/${adults}/0/0`,
    },
  ];
}

export function stayLinks(
  place: string,
  checkin: string,
  checkout: string,
  adults: number,
  rooms: number,
): { label: string; url: string }[] {
  const q = encodeURIComponent(place);
  return [
    {
      label: "Booking",
      url: `https://www.booking.com/searchresults.es.html?ss=${q}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}&no_rooms=${rooms}&selected_currency=USD`,
    },
    {
      label: "Expedia",
      url: `https://www.expedia.com/Hotel-Search?destination=${q}&startDate=${checkin}&endDate=${checkout}&adults=${adults}&rooms=${rooms}`,
    },
    {
      label: "Airbnb",
      url: `https://www.airbnb.com.ar/s/${q}/homes?checkin=${checkin}&checkout=${checkout}&adults=${adults}`,
    },
  ];
}
