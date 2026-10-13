# FindMyTrip ✈

Tu agente de viajes personal. La idea: sacar lo mejor de Despegar y Skyscanner
pero sin ruido, todo personalizado y pensado para **llegar al mejor viaje posible con tu presupuesto**.

## Qué hace

- **¿A dónde me alcanza?** Ponés presupuesto total, noches, viajeros y (opcional) el mes.
  Rankea destinos por encaje con tus intereses, época del año y cuánto rinde la plata,
  con el desglose vuelo + alojamiento + gastos diarios.
- **Lugares que quizás no estabas considerando.** Destinos menos obvios que también entran en el presupuesto.
- **Ficha de destino:** costo por mes, calendario de vuelos día por día con precios reales,
  precio exacto de Google Flights a pedido, hoteles reales de Google Hotels y armado del paquete.
- **Mis viajes**, **seguir destinos** con presupuesto objetivo, **perfil** y **agente conversacional** (opcional).

## Precios reales: de dónde salen (todo gratis)

| Qué | Fuente | Costo | Clave |
|---|---|---|---|
| Vuelos para explorar y calendarios | Travelpayouts / Aviasales Data API (precios reales que encontraron usuarios en los últimos días) | Gratis | `TRAVELPAYOUTS_TOKEN` |
| Precio exacto de un vuelo (botón) | Google Flights vía SerpApi | Gratis hasta 250 búsquedas/mes | `SERPAPI_KEY` |
| Hoteles reales (botón) | Google Hotels vía SerpApi | Comparte las mismas 250/mes | `SERPAPI_KEY` |
| Dólar tarjeta para ver precios en pesos | dolarapi.com | Gratis, sin clave | — |
| Gastos diarios (comida, transporte) | Estimación curada por destino | — | — (no hay API gratuita) |
| Chat del agente | Workers AI de Cloudflare (Llama 3.3) | **Gratis** con cuota diaria | — (viene con Cloudflare) |
| Chat del agente, mejor calidad | API de Claude | Pago por uso (opcional) | `ANTHROPIC_API_KEY` |
| Fotos de destinos | Wikipedia / Wikimedia | Gratis, sin clave | — |

Para que la cuota de SerpApi rinda: cada búsqueda queda guardada en Cloudflare KV (gratis) por 12-24 h, los hoteles
se buscan una vez por mes de viaje, y el precio de Google se trae solo para el primer día que se abre (los demás días
usan el calendario o el link a Aviasales, que busca en tiempo real sin límite). Si falta una clave, esa parte muestra estimaciones marcadas como "estimado".

## Probarlo en tu PC (Windows, CMD)

1. Instalá **Node.js LTS** (https://nodejs.org) y **Git** (https://git-scm.com).
2. En CMD:

```cmd
git clone https://github.com/deorejasyvaritas/findmytrip.git
cd findmytrip
git checkout claude/brave-pascal-6h0ge1
npm install
copy .dev.vars.example .dev.vars
notepad .dev.vars
```

3. Pegá tus claves en `.dev.vars` (ver abajo cómo sacarlas), guardá y corré:

```cmd
npm run dev
```

4. Abrí http://localhost:5173

## Cómo sacar las claves

**Travelpayouts (vuelos, gratis):** registrate en https://www.travelpayouts.com → en tu perfil, sección
*API token*, copiá el token (si te pide registrar un sitio, podés usar la URL de Cloudflare del paso de publicación). Uniéndote al programa de Aviasales también podés ganar comisión por las reservas.

**SerpApi (hoteles y Google Flights, gratis 250/mes):** registrate en https://serpapi.com (plan Free) →
*Dashboard* → copiá tu *API Key*.

**Claude (opcional, pago):** https://console.anthropic.com → *API Keys*. Si no la ponés, la app funciona
completa salvo el chat.

## Publicarlo en Cloudflare (gratis)

Corre como un Cloudflare Worker en el plan gratuito (100.000 requests por día), con la web y la API juntas.

```cmd
npx wrangler login
npx wrangler secret put TRAVELPAYOUTS_TOKEN
npx wrangler secret put SERPAPI_KEY
npm run deploy
```

Te devuelve una URL tipo `https://findmytrip.<tu-usuario>.workers.dev`. Para actualizar, volvé a correr
`npm run deploy`. (Opcional: `npx wrangler secret put ANTHROPIC_API_KEY` para el agente.)

> Ojo: si publicás la URL, cualquiera que entre usa tu cuota de SerpApi (y tu saldo de Claude si lo activaste).
> Para uso personal, no la compartas o protegela con Cloudflare Access (gratis hasta 50 usuarios).

## Cuentas (registro desde el sitio)

La primera persona que entra crea su cuenta y queda como dueña del sitio. Después el registro queda cerrado; la dueña
puede abrirlo desde Perfil, Cuenta. Cada cuenta tiene sus propios viajes, destinos seguidos y alertas, sincronizados
entre dispositivos. Contraseñas guardadas con PBKDF2 y sal; 5 intentos fallidos bloquean 15 minutos.

## Radar de ofertas y alertas (gratis)

- **Radar:** 5 veces por día (cron de Cloudflare) revisa los precios reales desde tu ciudad hacia todos los destinos,
  guarda el historial y marca lo que está por debajo de lo habitual ("bajó", "subió", "mínimo"). Ciudades: variable
  `RADAR_ORIGINS` en `wrangler.jsonc` (por defecto `BUE`).
- **Alertas por Telegram:** con tu propio bot. En Telegram buscá @BotFather, mandale `/newbot` y copiá el token; después
  `echo TU_TOKEN| npx wrangler secret put TELEGRAM_BOT_TOKEN`. En el sitio: Perfil, Alertas, "Abrir Telegram",
  apretá Iniciar en el chat del bot y después "Ya lo envié".
  Te avisa cuando un destino que seguís ("Avisarme si baja") entra en tu presupuesto y de las mejores ofertas del radar.

## Códigos de Travelpayouts (Drive y buscador en vivo)

Los scripts que da Travelpayouts van en `partner-head.html` (no se sube a git, así nunca hay conflictos):

```cmd
copy partner-head.example.html partner-head.html
notepad partner-head.html
npm run deploy
```

Pegá ahí el script de **Drive** y el **Main White Label code** del widget de vuelos. La página
`/vuelos.html` ya tiene los contenedores `tpwl-search` y `tpwl-tickets`: es un buscador de vuelos en
tiempo real, sin límite de búsquedas y con comisión para vos.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Web + API en http://localhost:5173 (usa `.dev.vars`) |
| `npm run dev:ai` | Igual, pero con el agente gratuito de Cloudflare (requiere `npx wrangler login`) |
| `npm test` | Tests del motor y de los proveedores de precios |
| `npm run typecheck` | Chequeo de tipos |
| `npm run deploy` | Build y publicación en Cloudflare |

## Cómo está armado

```
shared/          tipos y links de reserva (usados por web y API)
server/
  index.ts       API (Hono) que corre como Cloudflare Worker
  data/          catálogo curado de ~40 destinos (temporada, zonas, docs, gastos diarios)
  engine.ts      ranking de destinos, estimaciones de respaldo, calendario, alojamiento
  providers/     Travelpayouts (vuelos), SerpApi (Google Flights/Hotels), dolarapi (cotización)
  cache.ts       caché en Cloudflare para no repetir consultas
  agent.ts       agente con Claude + herramientas
src/             web React (Explorar, Destino, Mis viajes, Agente, Perfil)
tests/           tests
```

Todo lo personal (perfil, paquetes, chat) se guarda en tu navegador.
