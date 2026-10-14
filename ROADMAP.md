# Ideas para que FindMyTrip funcione mejor

Ordenadas por impacto para el viajero. Las marcadas con (gratis) no suman costos.

## Búsqueda y precios
1. **Alertas de precio reales** (hecho, Telegram): un cron de Cloudflare revisa a diario los destinos seguidos y avisa por mail (Resend/MailChannels, plan gratis) o Telegram cuando bajan del objetivo.
2. **Radar de ofertas** (hecho, con filtros por mes, región y precio): barrido programado (por ejemplo 4-5 veces por día) de rutas desde tu ciudad con Travelpayouts, comparando contra la mediana de los últimos 30 días para marcar "precio muy bajo" o "posible error de tarifa".
3. **Historial de precios por ruta** (hecho: gráfico en la ficha de destino): guardar cada precio visto en KV/D1 para mostrar "hoy está 18 % más barato que lo habitual".
4. **Aeropuertos cercanos** (hecho, "Cruzá y volá"): comparar con salir desde Montevideo, Santiago o San Pablo sumando el cruce.
5. **Vuelos directos o con escalas** (hecho en el buscador: escalas, aerolíneas, horario y precio).
6. **Impuestos argentinos**: mostrar el precio en pesos con dólar tarjeta y percepciones, y comparar con pagar en dólares.
7. **Multi-destino** (hecho: Multidestino y "Ya sé a dónde" con paradas y traslados por tierra; falta precio de micros y trenes).
8. **Fin de semana largo** (hecho): feriados calculados según la ley y escapadas con precio real en Explorar.

## Paquete y viaje
9. **Extras del paquete con comisión** (hecho: Welcome Pickups, Klook, Airalo, EKTA, Localrent, Tiqets): traslados (Kiwitaxi, GetTransfer), auto (Localrent, GetRentacar), eSIM (Airalo, Yesim), seguro (EKTA), excursiones (Klook, Tiqets).
10. **Requisitos de entrada** (hecho) por destino (DNI, pasaporte, visa, vacunas) con fuente oficial y fecha de actualización.
11. **Presupuesto día por día** (hecho, con checklist) y checklist de viaje (documentos, reservas, check-in online).
12. **Compartir un viaje** (hecho) por link con quien viaja con vos y votar opciones.
13. **Clima esperado** (hecho) por mes (Open-Meteo, gratis) en cada destino.

## Experiencia
14. **Comparar 2 o 3 destinos** (hecho) lado a lado.
15. **Sincronizar entre dispositivos** (hecho, cuentas con KV) con una cuenta simple (Cloudflare D1, gratis).
16. **App instalable (PWA)** (hecho, sin push: los avisos van por Telegram) con notificaciones push.
17. **Página de "Cómo funciona"** (hecho): de dónde salen los precios y cómo ganamos (afiliados), para dar confianza.

## Ideas de turismocity
18. **Mapa de vuelos baratos** (hecho): tocar un destino en el mapa y ver el precio desde tu ciudad (con los datos del radar).
19. **Crear alerta desde un resultado** (hecho): botón "Avisarme si baja" también en las tarjetas de la búsqueda.

## Próximo
20. **Rutas armadas** (idea de Trailfinders): itinerarios modelo de varios países ("Nordeste de Brasil, 12 días", "Europa clásica, 15 días") con precio "desde" por persona, filtros por país, duración y estilo; se abren en "Ya sé a dónde" con precios reales del día.
21. **Filtro por duración** del viaje (idea de trip-finder.org).
22. **Pantallas** (auditoría): contraste de textos grises y del mensaje verde sobre el rosa, mensajes en inglés sin conexión, app instalada después de una actualización, avisos que fallan sin mostrar error, zonas táctiles chicas.
