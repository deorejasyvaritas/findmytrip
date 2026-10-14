# Ideas para que FindMyTrip funcione mejor

Ordenadas por impacto para el viajero. Las marcadas con (gratis) no suman costos.

## Búsqueda y precios
1. **Alertas de precio reales** (hecho, Telegram): un cron de Cloudflare revisa a diario los destinos seguidos y avisa por mail (Resend/MailChannels, plan gratis) o Telegram cuando bajan del objetivo.
2. **Radar de ofertas** (hecho, con filtros por mes, región y precio): barrido programado (por ejemplo 4-5 veces por día) de rutas desde tu ciudad con Travelpayouts, comparando contra la mediana de los últimos 30 días para marcar "precio muy bajo" o "posible error de tarifa".
3. **Historial de precios por ruta** (en parte: el radar guarda historial; falta mostrar el gráfico por ruta): guardar cada precio visto en KV/D1 para mostrar "hoy está 18 % más barato que lo habitual".
4. **Aeropuertos cercanos** (hecho, "Cruzá y volá"): comparar con salir desde Montevideo, Santiago o San Pablo sumando el cruce.
5. **Vuelos directos o con escalas** (hecho en el buscador: escalas, aerolíneas, horario y precio).
6. **Impuestos argentinos**: mostrar el precio en pesos con dólar tarjeta y percepciones, y comparar con pagar en dólares.
7. **Multi-destino** (hecho: Multidestino y "Ya sé a dónde" con paradas y traslados por tierra; falta precio de micros y trenes).
8. **Fin de semana largo** (hecho): feriados calculados según la ley y escapadas con precio real en Explorar.

## Paquete y viaje
9. **Extras del paquete con comisión** (hecho: Welcome Pickups, Klook, Airalo, EKTA; faltan auto y Tiqets): traslados (Kiwitaxi, GetTransfer), auto (Localrent, GetRentacar), eSIM (Airalo, Yesim), seguro (EKTA), excursiones (Klook, Tiqets).
10. **Requisitos de entrada** por destino (DNI, pasaporte, visa, vacunas) con fuente oficial y fecha de actualización.
11. **Presupuesto día por día** y checklist de viaje (documentos, reservas, check-in online).
12. **Compartir un viaje** por link con quien viaja con vos y votar opciones.
13. **Clima esperado** por mes (Open-Meteo, gratis) en cada destino.

## Experiencia
14. **Comparar 2 o 3 destinos** lado a lado.
15. **Sincronizar entre dispositivos** (hecho, cuentas con KV) con una cuenta simple (Cloudflare D1, gratis).
16. **App instalable (PWA)** con notificaciones push.
17. **Página de "Cómo funciona"**: de dónde salen los precios y cómo ganamos (afiliados), para dar confianza.

## Ideas de turismocity
18. **Mapa de vuelos baratos**: tocar un destino en el mapa y ver el precio desde tu ciudad (con los datos del radar).
19. **Crear alerta desde un resultado**: botón "Avisarme si baja" también en las tarjetas de la búsqueda.
