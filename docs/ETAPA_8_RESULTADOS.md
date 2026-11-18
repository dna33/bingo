# Etapa 8: ensayo integral, carga y recuperación

Este informe conserva la medición original. Para el comportamiento posterior de las alertas y su comparación con esta evidencia, ver [Optimización de alertas persistentes](OPTIMIZACION_ALERTAS_RESULTADOS.md).

Fecha de ejecución: 2026-11-17T20:15:51.797Z. Estado del laboratorio: `passed-functional-checks`.

**El ensayo técnico no habilita el piloto.** Fabuloso debe cerrar las reglas, el proveedor, la infraestructura y el ensayo humano. No se enviaron mensajes ni se ejecutaron abonos reales. Las constancias de abono del libro pertenecen exclusivamente a la base ficticia del laboratorio.

La evidencia completa, semillas, muestras, hashes de fuentes, tiempos y manifiesto del respaldo están en [ensayo.json](evidencias/etapa8/ensayo.json). El [guion operativo y de recuperación](ETAPA_8_GUION_Y_RECUPERACION.md) explica cómo repetirlo y qué debe ensayar el equipo.

## Entorno y metodología

Node v22.16.0, MongoDB 7.0.14, Chrome/157.0.8103.51; darwin/arm64, Apple M4 Pro, 14 CPU lógicas y 48 GiB de memoria física.

Una réplica local de un nodo, API Express, MongoDB y Chrome comparten el equipo. Se usaron dos credenciales de operador y dos pestañas con los componentes reales de consola, estilos compilados y llamadas HTTP reales. La consola operativa está en primer plano; se desactiva la limitación de temporizadores de pestañas en segundo plano para el segundo lector. No se simulan miles de sesiones de jugadores. No había otra suite de carga ejecutándose durante la corrida registrada.

Cada volumen tiene cartones completos distintos, PDFs persistidos y verificados por SHA-256, importación/reimportación y lista conciliada. El generador real recibe aleatoriedad sembrada solo por la dependencia interna del laboratorio. Se usan las máscaras de referencia del brief, 1–75 sin restricciones por columna, siete figuras simultáneas, repetición permitida y extracción manual de bolillas sin reposición. Estas reglas están confirmadas para la edición ficticia y no aprueban las del evento.

Se registra el intervalo desde el clic de confirmación real hasta el DOM con la nueva versión, número y resumen completo de candidatos, seguido de dos oportunidades de render (`requestAnimationFrame`) en la consola principal. No es una medida de píxeles en una pantalla física. La segunda consola usa su polling normal de partida; las alertas conservan su polling propio. Se guardan todas las muestras; el p95 es el valor de rango más próximo, `ceil(0,95 × N)`.

Se distingue la actualización general de las extracciones con candidatos nuevos, incluidas reservas. Se verifica por un cálculo independiente de posiciones/bolillas el primer grupo completo de cada figura. Una corrida por volumen, en loopback y con Chrome headless, no prueba una red remota, variación entre jornadas ni el peor caso de 70.000 candidaturas en una sola bolilla.

## Carga con consola real

| Cartones | Extracciones | Principal p95 (todas) | Principal p95 con candidatos | Segunda consola p95 | Alertas p95 | Máximo principal |
| --- | --- | --- | --- | --- | --- | --- |
| 3.000 | 60 | 122 ms | 122,2 ms (26 muestras) | 992,1 ms | 1.992,2 ms (26 muestras) | 124,4 ms |
| 10.000 | 60 | 198,9 ms | 208,4 ms (30 muestras) | 992,6 ms | 1.991 ms (30 muestras) | 239,8 ms |

Los p95 disponibles quedaron por debajo de 2.000 ms en esta corrida local. Es evidencia acotada al entorno medido; la capacidad y red del evento siguen pendientes de aceptación.

Las alertas persistentes quedaron muy cerca del límite de dos segundos: el polling de dos segundos deja poco margen. Debe comprobarse este recorrido en la infraestructura final; el resultado local no acredita margen de capacidad para red y equipos remotos.

Primeras detecciones y empates efectivamente verificados:

| Cartones | Figura | Primera extracción | Candidatos en ese empate |
| --- | --- | --- | --- |
| 3.000 | F | 40 | 1 |
| 3.000 | A | 39 | 1 |
| 3.000 | B | 49 | 2 |
| 3.000 | U | 42 | 1 |
| 3.000 | L | 34 | 1 |
| 3.000 | S | 50 | 2 |
| 3.000 | O | 50 | 1 |
| 10.000 | F | 36 | 2 |
| 10.000 | A | 40 | 1 |
| 10.000 | B | 43 | 1 |
| 10.000 | U | 38 | 1 |
| 10.000 | L | 26 | 1 |
| 10.000 | S | 49 | 1 |
| 10.000 | O | 45 | 2 |

## Preparación y entrega simulada

| Participantes | Importar y aplicar | Emitir cartones/PDF persistidos | Bytes PDF | Encolar | Procesar proveedor simulado | Jobs iniciales / entregados simulados |
| --- | --- | --- | --- | --- | --- | --- |
| 3.000 | 1,9 s | 10,2 s | 12.540.113 | 4 s | 117,6 s | 3000 / 3000 |
| 10.000 | 16,8 s | 53,2 s | 41.825.075 | 31,8 s | 438,3 s | 10000 / 10000 |

El tiempo de emisión incluye una comprobación intermedia de bloqueo antes de completar todos los cartones. Cada PDF conserva su titular y hash; se compara el contenido de una muestra parseada y se verifican los hashes de todos.

El proveedor es el adaptador simulado existente, sin cliente SMTP, correo o WhatsApp. Su reloj de trabajador se adelanta para no esperar entre jobs. Estos tiempos no acreditan caudal ni entrega de un proveedor real. Con el espaciado configurado de 100 ms, solo el piso de espaciado sería aproximadamente 3.000: 299,9 s; 10.000: 999,9 s, antes de red, límites y reintentos reales.

## Recuperación del respaldo

Se detuvieron todos los escritores, se copiaron 31 colecciones en BSON comprimido (32.581.991 bytes) desde un snapshot transaccional y se apagó la réplica de origen. Se restauró en otra réplica/base vacía y se arrancó otro proceso de server.js.

| Medición | Resultado |
| --- | --- |
| Copia con escritores detenidos | 3,3 s |
| Restauración de archivos e índices | 9,6 s |
| Arranque del nuevo servidor | 0,2 s |
| Procedimiento de recuperación, incluida réplica nueva y verificación | 11,6 s |
| Indisponibilidad completa del laboratorio, incluida copia | 16,1 s |

Coincidieron los hashes BSON de todas las colecciones, cantidades, índices, bytes de PDFs y asignaciones. Se reintentó una extracción con su recibo original antes y después de restaurar: no se duplicó. Ambos contactos seguían esperando respuesta con los mismos `contactStartedAt` y `expiresAt`, distintos entre sí. El reloj no se reinició.

Tras esperar al vencimiento original, se acreditó una recepción oportuna registrada después y se descartó otra realmente tardía. La prueba continuó el remanente, reinició rondas conservando PDFs y completó los siete pozos. Los tiempos son del laboratorio; no constituyen RPO/RTO acordados de producción ni demuestran recuperación de escrituras posteriores al respaldo. La copia es lógica, con mantenimiento y sin escritores; no es un respaldo continuo o un ensayo de un proveedor cloud.

## Flujo integral y aceptación

El circuito financiero de seis personas usa una máscara mínima controlada (primera casilla numerada más centro libre) para forzar empates, reservas y respuestas distintas de forma reproducible. No es una partida de las siete letras del anexo. La carga con 3.000/10.000 cartones sí utiliza las siete máscaras de referencia reales; ambas evidencias se mantienen separadas.

La edición integral tiene 6 personas ficticias, 7 rondas, 15 premios sintéticos y 1 candidatura descartada. El libro asignó y marcó como abonados 400.000 CLP **solo en la simulación**; abonos externos ejecutados: 0. Exportación comprobada, pendientes de abono vacíos y descartados separados.

| Aceptación | Evidencia del ensayo | Estado / límite |
| --- | --- | --- |
| PA-01 | Importaciones completas de ambos volúmenes, un cartón por persona | Cumple en laboratorio |
| PA-02 | Reimportación del mismo archivo y repetición del encolado sin duplicados | Cumple en laboratorio |
| PA-03 | CSV inválido y contactos compartidos visibles; aplicación bloqueada; decisiones explícitas | Cumple en laboratorio |
| PA-04 | 24 números, centro libre, titulares, unicidad y hashes de todos los PDFs | Cumple en laboratorio; muestra visual humana pendiente |
| PA-05 | Siete rondas con bolillas reiniciadas y PDFs/cartones sin cambios | Cumple en laboratorio |
| PA-06 | Empate conocido y oracle independiente del primer grupo por figura; contacto privado HTTP | Cumple técnico; operación humana pendiente |
| PA-07 | Todos los empatados y reparto de remanente sin exceder $400.000 | Cumple en laboratorio |
| PA-08 | Máscara con centro libre, marcas exteriores y comparación de posiciones exigidas | Cumple en laboratorio |
| PA-09 | Cero cuentas/sesiones de jugador; PDF y evaluación del servidor | Cumple técnico; recepción real no probada |
| PA-10 | Dos operadores, una escritura; recibo reintentado también tras restaurar | Cumple en laboratorio |
| PA-11 | Otra réplica y otro proceso; contenido, índices, secuencia y plazos conservados | Cumple local; infraestructura/respaldos reales pendientes |
| PA-12 | Viewer/importador sin contactos o premios; roles de personal y edición comprobados | Cumple técnico |
| PA-13 | Siete pozos, una O, exportación y suma de dinero sintético consistente | Cumple técnico; referencias y abonos reales no ensayados |
| PA-14 | Muestras de consola y alertas para ambos volúmenes, sin sesiones masivas de jugador | Cumple local; red e infraestructura final pendientes |
| PA-15 | Lista cerrada conciliada, sin omisiones ni jugadores extras en ambos volúmenes | Cumple con lista ficticia; lista oficial pendiente |
| PA-16 | Fallo permanente y reenvío del mismo cartón sin perder elegibilidad | Cumple con proveedor simulado |
| PA-17 | Preparación bloqueada antes de completar cartones y cierre | Cumple técnico |
| PA-18 | PDFs individuales, bytes, destinatarios y receipts del adaptador simulado | Parcial: proveedor/entrega real pendientes |
| PA-19 | Alerta y grupo no duplicados al reintentar; DOM real medido | Cumple técnico; sonido físico pendiente |
| PA-20 | Respuesta realmente posterior al minuto descartada y ausente de pendientes | Cumple técnico; revisión de ausencia y límite exacto también en regresión |
| PA-21 | Recepción oportuna acreditada tarde, cuenta ficticia, premio y constancia sintética | Cumple técnico; abono real fuera de alcance |
| PA-22 | Reenvío por otro canal, mismo titular y mismo hash de PDF | Cumple técnico |
| PA-23 | Plazos distintos y redisputa del remanente con grupo completo de reservas | Cumple técnico; dotación humana por acordar |
| PA-24 | Restauración durante espera, vencimiento original y respuesta tardía sin premio | Cumple en laboratorio |

La matriz distingue comprobaciones automáticas del trabajo humano y del proveedor. No afirma que se haya ensayado una transmisión o que todas las políticas del brief estén aprobadas. La regresión de las etapas anteriores conserva otras alternativas de continuación, límite exacto de respuesta, descartes revisados, fallos y permisos.

## Regresión y comprobaciones

| Comprobación | Resultado |
| --- | --- |
| API | 112 pruebas aprobadas; 0 fallidas; 194,5 segundos |
| Interfaz | 153 pruebas aprobadas en 34 suites |
| Compilación | Correcta |
| Lint | 0 errores; 6 advertencias heredadas de longitud de línea |

Resumen y hashes de las ejecuciones en [verificacion.json](evidencias/etapa8/verificacion.json) y [verificacion.txt](evidencias/etapa8/verificacion.txt). Las pruebas nuevas cubren restauración BSON, integridad, tipos e índices y reproducibilidad del anexo. La sintaxis de los scripts y git diff --check también se verificaron.

## Anexo: cálculo y simulación reproducibles

Semilla bingo-etapa8-annex-v1, 300 partidas de 3.000 cartones; máscaras de referencia y generador real. El orden fijo 1–75 es equivalente por simetría para cartones uniformes sin restricciones. Se mantiene el mismo cartón para las siete figuras, conservando su dependencia. Se verificaron 420 comparaciones con el evaluador real en los límites de completación. No se simularon respuestas ni cobros.

| Figura | Números exigidos | P(alguien a 40), teoría | A 40, simulación | Empate, teoría | Empate, simulación | Media de primera extracción: teoría / simulación |
| --- | --- | --- | --- | --- | --- | --- |
| F | 11 | 75.74% | 77.33% | 14.36% | 15.67% | 37,9 / 38 |
| A | 13 | 24.81% | 23.67% | 15.36% | 16.00% | 42,5 / 42,4 |
| B | 15 | 5.16% | 3.33% | 16.49% | 17.33% | 46,2 / 46,5 |
| U | 13 | 24.81% | 20.67% | 15.36% | 18.00% | 42,5 / 42,5 |
| L | 9 | 99.86% | 100.00% | 13.60% | 16.33% | 32,2 / 32,1 |
| S | 16 | 2.18% | 3.33% | 17.09% | 15.00% | 47,8 / 47,5 |
| O | 16 | 2.18% | 2.00% | 17.09% | 16.67% | 47,8 / 47,6 |

La suma teórica de las siete rondas independientes es 296,8 bolillas, consistente con las aproximadamente 297 del brief. En la simulación simultánea, la última primera detección ocurrió en promedio a 49,2 bolillas; O fue última, incluidos empates de orden, en 57.00% de las partidas. No se presume que O cierre el programa.

Las diferencias de frecuencia son variación Monte Carlo: con 300 partidas el error estándar puede acercarse a 2,9 puntos porcentuales en una probabilidad de 50%; no es una validación de cuatro decimales. Las fórmulas, quantiles y errores estándar están en JSON. La coincidencia marginal S/O o A/U no implica independencia entre letras. La simulación no estima probabilidad de cobrar ni incorpora RF-17, contacto o dinero; el ensayo integral verifica esos flujos por separado.

Por simetría, sin descartes y repartiendo íntegramente los pozos, el importe esperado por persona sería $16,67 por figura ordinaria, $33,33 para O y $133,33 sumando siete pozos con 3.000 participantes. Esto reproduce la referencia matemática del brief; no estima el cobro con respuesta obligatoria ni un beneficio de la jugada.

## Cambios necesarios y pendientes

Se añadió un laboratorio repetible con datos sembrados, observación de DOM en Chrome, validación de primeros candidatos, copia/restauración BSON y reporte. Las pruebas de respaldo rechazan origen sin pausa declarada, archivos corruptos y destino no vacío, y verifican tipos e índices únicos. El ensayo detectó además que los códigos seguros de error de contacto/premios no llegaban a la consola: se incorporaron a la lista permitida del servidor y una prueba HTTP verifica la explicación de respuesta pendiente. No se cambió la selección criptográfica de bolillas del evento.

Pendientes para habilitación:

- Fabuloso: aprobar rango, restricciones, máscaras, modalidades y todas las políticas pendientes; revisión expresa de reservas y agotamiento.
- Fabuloso: nombrar responsables y suplentes; ensayar contactos simultáneos, sonido físico, vista pública de la transmisión y registro de incidencias.
- Proveedor: habilitar remitente/canal, verificar límites, adjuntos, reintentos y entrega real en pruebas autorizadas.
- Infraestructura: entorno final, red, carga concurrente acordada, almacenamiento y métricas de consola real.
- Recuperación: custodia/cifrado/retención, secretos externos y RPO/RTO; restaurar desde otro equipo y con la herramienta productiva elegida.
- Premios: acordar referencias reales de cuenta y comprobante, controles operativos y firma del revisor; no se realizaron abonos reales.

**Decisión:** ensayo técnico documentado; piloto no habilitado automáticamente. La autorización operativa corresponde a Fabuloso tras resolver los pendientes.
