# FindMyTrip: contexto para Claude

Agente de viajes personal (español rioplatense). Mejor y con menos ruido que Despegar o Skyscanner:
buscar por presupuesto, fechas o destino, sugerir lugares que el usuario no tenía en cuenta, armar
paquetes (vuelo + alojamiento + extras) con precios reales. Siempre gratis de mantener; lo único pago
es opcional (agente con Claude).

## Reglas
- Trabajar y hacer push solo en la rama `claude/brave-pascal-6h0ge1`. No abrir PR salvo que se pida.
- UI en español rioplatense, estilo iOS, sin emojis en ningún lado. Marca: rosa `#e8436c`,
  acciones en el negro de la marca (`#1c1c1e`).
- Todo gratis: no sumar servicios pagos. Cuidar la cuota de SerpApi (250/mes) y el límite de CPU del
  plan gratis de Workers (10 ms por pedido): cachear en KV datos compactos.
- No agregar scripts de terceros (Travelpayouts Drive / White Label) a archivos del repo: van en
  `partner-head.html`, que está en `.gitignore` y lo maneja el usuario.
- Antes de push: `npm run typecheck`, `npm test` y `npm run build`.

## Stack
Vite + React + TypeScript; API con Hono como Cloudflare Worker (`server/index.ts`); KV `CACHE`;
Workers AI para el agente gratis; cron para el radar. Deploy: `npm run deploy` (desde la Mac del usuario).
Sitio: https://findmytrip.deorejasyvaritas.workers.dev

## Fuentes de precios
- Vuelos: Travelpayouts Data API (Aviasales), gratis y sin límite. SerpApi (Google Flights/Hotels/Explore) solo a pedido.
- Hoteles: Xotelo (gratis, sin clave), Google Hotels de respaldo.
- Afiliados: marker `789588`, proyecto (trs) `585192`. Links directos `tp.media/r` en `server/partner-links.ts`.
  Programas bloqueados por tráfico: Booking, Expedia, Agoda, Trip.com, Vio, Hostelworld, Vrbo.

## Mapa
- `server/engine.ts`: ranking, costos (comidas y paseos van aparte del total salvo `includeDaily`).
- `server/providers/`: flights, explore, hotels, xotelo, photos, fx.
- `server/radar.ts`, `server/alerts.ts` (Telegram), `server/holidays.ts` + `server/escapes.ts` (fines de semana largos),
  `server/cross.ts` (Cruzá y volá), `server/auth.ts` (cuentas en KV).
- `src/pages/`: Home (Explorar), Destination, Trips, Agent, Profile.
- Pendientes: ver `ROADMAP.md`.
