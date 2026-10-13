// Aerolíneas frecuentes desde Argentina: nombre y sitio oficial (para comparar
// el precio directo con la aerolínea antes de comprar).
export const AIRLINES: Record<string, { name: string; url: string }> = {
  AR: { name: "Aerolíneas Argentinas", url: "https://www.aerolineas.com.ar" },
  LA: { name: "LATAM", url: "https://www.latamairlines.com/ar/es" },
  JJ: { name: "LATAM Brasil", url: "https://www.latamairlines.com/ar/es" },
  H2: { name: "SKY Airline", url: "https://www.skyairline.com/argentina" },
  JA: { name: "JetSMART", url: "https://jetsmart.com/ar/es/" },
  WJ: { name: "JetSMART", url: "https://jetsmart.com/ar/es/" },
  FO: { name: "Flybondi", url: "https://flybondi.com/ar" },
  G3: { name: "GOL", url: "https://www.voegol.com.br/es" },
  AD: { name: "Azul", url: "https://www.voeazul.com.br/ar/es/home" },
  CM: { name: "Copa Airlines", url: "https://www.copaair.com/es-ar/" },
  AV: { name: "Avianca", url: "https://www.avianca.com/es/" },
  BoA: { name: "BoA", url: "https://www.boa.bo" },
  OB: { name: "BoA", url: "https://www.boa.bo" },
  PZ: { name: "Paranair", url: "https://www.paranair.com" },
  IB: { name: "Iberia", url: "https://www.iberia.com/ar/" },
  UX: { name: "Air Europa", url: "https://www.aireuropa.com/ar/es/home" },
  AA: { name: "American Airlines", url: "https://www.aa.com" },
  UA: { name: "United", url: "https://www.united.com" },
  DL: { name: "Delta", url: "https://www.delta.com" },
  AF: { name: "Air France", url: "https://www.airfrance.com.ar" },
  KL: { name: "KLM", url: "https://www.klm.com.ar" },
  AZ: { name: "ITA Airways", url: "https://www.ita-airways.com" },
  LH: { name: "Lufthansa", url: "https://www.lufthansa.com" },
  TK: { name: "Turkish Airlines", url: "https://www.turkishairlines.com" },
  ET: { name: "Ethiopian Airlines", url: "https://www.ethiopianairlines.com" },
  EK: { name: "Emirates", url: "https://www.emirates.com/ar/spanish/" },
  QR: { name: "Qatar Airways", url: "https://www.qatarairways.com" },
  AM: { name: "Aeroméxico", url: "https://aeromexico.com" },
};

export const airlineName = (code?: string | null) => (code ? (AIRLINES[code]?.name ?? code) : null);
