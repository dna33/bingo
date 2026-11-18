# Optimización de alertas persistentes

Comparación local del 2026-11-17T20:48:49.993Z contra la medición de la etapa 8 del 2026-11-17T20:15:51.797Z.

Las alertas ahora se consultan al recibir una nueva versión oficial de la partida. El operador que confirma una extracción las actualiza después de la confirmación; la segunda consola las solicita al recibir esa versión por su actualización normal de partida. Se conserva el polling de dos segundos como recuperación periódica.

El servidor entrega filas, cantidad pendiente y versión desde un único snapshot MongoDB, con `private, no-store`. El cliente ignora snapshots anteriores a la versión conocida; agrupa nuevas señales durante una consulta y realiza una consulta posterior, sin perder el aviso. Cambiar de edición, credencial o página invalida las respuestas del contexto anterior. Un fallo conserva las alertas previas y muestra un error; no reconoce ni elimina registros.

Con audio habilitado, un aviso nuevo suena al recibir el dato persistido; sigue repitiéndose cada cuatro segundos mientras haya pendientes. Se detectan también avisos nuevos cuando un reconocimiento simultáneo mantiene el mismo total pendiente. Pulsos separados por menos de 250 ms se agrupan para evitar superposición. El reconocimiento sigue siendo explícito y compartido; no inicia contacto ni confirma premios.

## Resultados

| Cartones | Muestras con detecciones | Alerta principal p95 antes | Alerta principal p95 después | Reducción | Margen hasta 2.000 ms | Alerta segunda consola p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 3.000 | 26 | 1.992,2 ms | 107,6 ms | 94,6% | 1.892,4 ms | 996,3 ms |
| 10.000 | 30 | 1.991 ms | 195,1 ms | 90,2% | 1.804,9 ms | 996,5 ms |

| Cartones | Máximo alerta principal | Máximo alerta segunda consola | p95 actualización de partida principal | p95 actualización de partida segunda consola |
| --- | --- | --- | --- | --- |
| 3.000 | 108,2 ms | 1.001,5 ms | 149,2 ms | 989,7 ms |
| 10.000 | 218,9 ms | 999 ms | 219,4 ms | 990 ms |

Los p95 de alertas de ambas consolas quedaron bajo dos segundos en esta corrida, con el margen indicado. Es evidencia local, no habilitación del evento.

La etapa 8 medía la alerta persistente solo en la consola principal; no se inventa un valor anterior para las alertas de la segunda consola. Su p95 posterior sí se midió contra el mismo clic de confirmación. La actualización de partida de la segunda consola conserva su intervalo de aproximadamente un segundo.

## Método y alcance

Node v22.16.0, MongoDB 7.0.14, Chrome/157.0.8103.51, Apple M4 Pro, 48 GiB. API, réplica de un nodo y Chrome comparten este equipo; HTTP en loopback, sin sesiones de jugadores.

Se repitieron 3.000 y 10.000 participantes, emisión real de cartones y PDFs persistidos, encolado y procesamiento del proveedor simulado, dos consolas reales y 60 confirmaciones por volumen. Se conservaron las mismas semillas, CSV, disposiciones de cartón, secuencias de bolillas y máscaras de referencia del brief (siete figuras simultáneas). El comparador exige igualdad de los hashes de CSV y disposiciones, de las bolillas y de las primeras detecciones/empates.

El cronómetro empieza antes del clic de confirmación real. La alerta termina al aparecer en el DOM el total de alertas persistidas que corresponde a esa extracción; cada cifra incluye las extracciones con candidatos nuevos, también reservas. La partida se mide por su nueva versión, número y candidatos, más dos oportunidades de render en la consola principal. Las mediciones corresponden a DOM/Chrome headless; no al parlante ni a píxeles de una pantalla física.

Se usa el mismo criterio de p95 de rango más próximo, `ceil(0,95 × N)`. Una sola corrida por volumen describe este entorno. El avance del ensayo espera a las dos consolas y a las alertas: al acelerar las alertas también cambia el tiempo entre extracciones del circuito cerrado. No había otra suite de carga simultánea. La medición de la alerta segunda se añadió en esta repetición.

Se ejecutó la modalidad `load`: no se volvió a ensayar la recuperación de respaldo ni el circuito financiero completo, que permanecen documentados en la etapa 8 y cubiertos por regresión. La breve simulación probabilística del comando no sustituye el anexo de 300 partidas de la etapa 8. No se alteró la aleatoriedad de las extracciones digitales del evento.

Los tiempos del trabajador de entregas son del adaptador simulado y usan su reloj virtual, como en la medición anterior. No representan capacidad ni entrega de un proveedor real. Esta ejecución no realizó envíos ni abonos reales.

## Verificación

API: **113 pruebas aprobadas**. Interfaz: **160 pruebas aprobadas en 34 suites**. Compilación correcta; lint sin errores y con 6 advertencias heredadas de longitud de línea.

Las pruebas nuevas cubren refresco inmediato por versión, señales agrupadas durante consultas, snapshots antiguos, respuestas tardías de otra edición, fallo con conservación de filas, recuperación periódica, ausencia de bucles de peticiones, sonido inmediato y sustitución de una alerta sin cambio en el contador. Una prueba HTTP concurrente verifica que reconocimiento, filas, cantidad y versión sean consistentes.

Chrome verificó Web Audio real en estado running, repetición antes del reconocimiento y silencio posterior. El disparo inmediato se verifica además con pruebas automatizadas del componente; no se presenta un p95 de sonido físico.

## Reproducción y evidencia

SHA-256 original: c34c16e72b683132bd81fa30504e41bf72dd41016c3f385a79134fa779ad121d.
SHA-256 optimizado: 62380e562a01b08f2aaf64ed63d530adbc026da4dd2ad955caf94b8e628c8a9f.

```shell
nvm use
npm test
npm run test:api
npm run build
npm run lint
caffeinate -i node scripts/rehearse-pilot.cjs --cards=3000,10000 --draws=60 --trials=3 --mode=load --output=docs/evidencias/alertas/ensayo-optimizado.json
node scripts/compare-alert-rehearsals.cjs docs/evidencias/etapa8/ensayo.json docs/evidencias/alertas/ensayo-optimizado.json > docs/OPTIMIZACION_ALERTAS_RESULTADOS.md
```

En otros sistemas se omite caffeinate y se configura CHROME_BIN si hace falta. El laboratorio crea sus propias bases sintéticas y no acepta una URI de producción. Conserva las alertas persistidas y sus estados; la optimización cambia cuándo las consulta la consola, no la adjudicación o los plazos de contacto.

- [Medición original](evidencias/etapa8/ensayo.json).
- [Medición optimizada, semillas, muestras y hashes de fuentes](evidencias/alertas/ensayo-optimizado.json).
- [Muestras CSV comparables](evidencias/alertas/latencias.csv).
- [Verificación de pruebas, compilación, lint y audio](evidencias/alertas/verificacion.json).

## Pendientes

Validar en la infraestructura y red finales el número acordado de consolas, navegadores, reconexión y audio del equipo. Siguen pendientes la aprobación de reglas por Fabuloso, la habilitación del proveedor, los responsables operativos y el ensayo humano de la etapa 8. Esta comparación no ejecuta ni autoriza el despliegue, envíos o abonos reales.
