# FindMyTrip ✈

Tu agente de viajes personal. La idea: sacar lo mejor de Despegar y Skyscanner
pero sin ruido, todo personalizado y pensado para **llegar al mejor viaje posible con tu presupuesto**.

## Qué hace

- **¿A dónde me alcanza?** Ponés presupuesto total, noches, viajeros y (opcional) el mes.
  Rankea destinos por encaje con tus intereses, época del año y cuánto rinde la plata,
  con el desglose vuelo + alojamiento + gastos diarios.
- **Lugares que quizás no estabas considerando.** Una sección aparte con destinos menos obvios
  que también entran en el presupuesto (y distintos de los que ya tenés en mente).
- **Fechas flexibles.** Si no elegís mes, busca el mejor de los próximos 12.
- **Ficha de destino:** costo por mes (★ mejores meses por precio + clima), calendario de vuelos
  día por día con los días baratos resaltados, opciones de alojamiento por estilo y zona.
- **Armado de paquetes:** elegís día y alojamiento, ves el total y lo guardás en *Mis viajes*
  (estados: idea → armando → reservado). Cada ítem tiene link directo a Google Flights,
  Skyscanner, Despegar, Booking o Airbnb con la búsqueda ya cargada.
- **Seguir destinos:** guardás un objetivo de presupuesto y en el inicio ves si hoy entra o no.
- **Agente conversacional (Claude):** le hablás normal ("tengo USD 2.500 para 2, 10 días en marzo")
  y busca, compara y te propone paquetes guardables usando las mismas herramientas de la app.
- **Perfil:** ciudad de salida, viajeros, estilo, intereses, lugares ya visitados (se excluyen),
  límite de horas de vuelo, y precios en USD o pesos.

Todo lo personal (perfil, paquetes, chat) se guarda en tu navegador.

## Cómo correrlo

Requisitos: Node 20+.

```bash
npm install
cp .env.example .env   # opcional: completá las claves
npm run dev            # web en http://localhost:5173, API en :8787
```

Producción:

```bash
npm run build
npm start              # sirve web + API en http://localhost:8787
```

Otros comandos: `npm test` (tests del motor de precios), `npm run typecheck`.

### Variables de entorno (`.env`)

| Variable | Para qué | Sin ella |
|---|---|---|
| `ANTHROPIC_API_KEY` | Habilita el agente conversacional | El resto de la app funciona igual |
| `TRAVELPAYOUTS_TOKEN` | Precios de vuelos reales (Aviasales Data API, gratis en travelpayouts.com) | Se usan estimaciones por temporada, distancia, día de semana y anticipación |
| `USD_ARS_RATE` | Cotización para mostrar precios en pesos | 1450 |

## Cómo está armado

```
shared/          tipos y links de reserva (usados por web y API)
server/
  data/          catálogo curado de ~40 destinos (costos, temporada, zonas, docs)
  engine.ts      estimaciones de precios, ranking de destinos, calendario, alojamiento
  providers/     precios de vuelos en vivo (Travelpayouts) con caché y fallback
  agent.ts       agente con Claude + herramientas (explorar, precios por mes, calendario, alojamiento, paquete)
  index.ts       API Express
src/             web React (Explorar, Destino, Mis viajes, Agente, Perfil)
tests/           tests del motor
```

### Importante sobre precios

Los montos de alojamiento y gastos diarios son **estimaciones** del catálogo, útiles para comparar
destinos entre sí. Los vuelos son estimados salvo que tengas `TRAVELPAYOUTS_TOKEN` (ahí se marcan
"en vivo"). Antes de comprar, confirmá en el sitio de reserva con los links de cada paquete.

## Próximos pasos posibles

- Alertas por mail/WhatsApp cuando un destino seguido baja de tu objetivo.
- Hoteles con precios reales (API de Booking/Hotellook) y más destinos en el catálogo.
- Cuenta de usuario para sincronizar viajes entre dispositivos.
