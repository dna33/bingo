# Etapa 5: partida oficial y evaluación automática

Fecha: 16 de noviembre de 2026. Se implementó el motor del piloto en el servidor y su consola privada. Los candidatos detectados no son premios confirmados: contacto, respuesta en 60 segundos y adjudicación corresponden a las etapas 6 y 7. No se enviaron mensajes reales, pagaron premios ni desplegó el sistema.

## Funcionamiento entregado

El servidor mantiene estados preparación, listo, en juego, pausado y finalizado. Configura y congela las reglas, valida la lista y los documentos, abre rondas, confirma extracciones y evalúa todos los cartones habilitados sin depender de sesiones de jugadores, clics, chat o tiempo de YouTube.

Cada extracción guarda número, edición, ronda, secuencia, fecha/hora, operador y origen. En la misma transacción se guardan las candidaturas completas, evidencia, contadores de empates, avance, versión y recibo idempotente. Una confirmación duplicada o un proceso interrumpido no deja una bolilla parcialmente evaluada.

| Componente | Función |
| --- | --- |
| `game-engine.js` | Validación de reglas y evaluador puro de máscaras, centro libre, completaciones y cercanía. |
| `game.js` | Configuración, preparación, estados, rondas, extracciones, incidencias y finalización. |
| `game-routes.js` | API privada, snapshot consistente, historial, evidencias y contactos separados. |
| `GameConfiguration`, `GameRoster`, `FigureResult`, `GameIncident` | Reglas históricas, copia congelada de cartones, grupos por figura e incidencias. |
| `persistence.js` | Frontera transaccional compartida de extracción y resultados, adaptada a inserción masiva. |
| `GamePanel.js` y `game-patterns.js` | Consola de operación y máscaras de referencia para revisión expresa. |

La página `index.html` conserva el juego antiguo como demostración independiente. Sus extracciones locales y contadores de victorias no escriben los resultados del piloto. La operación oficial está en `back-office.html` y la API `/bingo-api/pilot/.../game`.

## Reglas explícitas antes de iniciar

Un administrador debe confirmar una configuración completa. No se elige automáticamente una modalidad porque aparezca propuesta en el brief. Se exigen:

- Siete figuras F, A, B, U, L, S y O, con máscaras de cinco filas de cinco caracteres binarios. Deben exigir al menos una casilla numerada; una máscara vacía o formada solo por el centro no inicia una competición válida.
- Pozos de $50.000 para F, A, B, U, L y S, y $100.000 para una sola O: total configurado $400.000. No se permite duplicar o eliminar una figura o inventar otros montos desde esta ruta.
- Modalidad independiente o simultánea, orden completo sin repeticiones y extracción manual o digital.
- Posibilidad de ganar varias figuras y pausa o continuidad durante el contacto.
- Política de pesos residuales, partes descartadas, caso sin respuestas e inicio del minuto.
- Revisión visual de las máscaras y referencia de confirmación del equipo.

La única política de residuos admitida en esta versión es el sorteo auditable de pesos residuales propuesto en el brief. Debe seleccionarse y confirmarse expresamente; el sorteo y los importes se implementarán en la etapa 7. Se almacenan las alternativas `redistribute_confirmed`/`redispute_remainder`, `redispute_same_figure`/`advance_keep_unassigned` y `operator_confirms_notice` para que el evento no arranque con esas decisiones ausentes. Su ejecución financiera o de contacto no se presenta como terminada en esta etapa.

Los dibujos precargados en la consola son los del anexo y se muestran como referencias. Los campos de modalidades y políticas empiezan vacíos. El checkbox y la referencia guardan lo confirmado para esa edición; no modifican `config/piloto.borrador.json` ni acreditan una aprobación global de Fabuloso.

La combinación **figuras simultáneas y prohibición de ganar varias figuras** se rechaza. Necesita una regla adicional para asignar prioridad si la misma persona completa varias figuras con la misma bolilla. No se utiliza el orden de recorrido como desempate. La prohibición de repetición está implementada para rondas independientes.

## Preparación y copia oficial de cartones

Pasar a listo requiere configuración confirmada, lista cerrada y conciliación completa. Se verifican las grillas contra la variante emitida, las huellas de disposición y los bytes de todos los PDFs. No se utiliza solamente el indicador de disponibilidad del documento.

La preparación crea una copia de participante, cartón, origen, números y huellas en `GameRoster`. Ese conjunto es la fuente del motor durante la partida. No se incorpora o excluye silenciosamente a alguien por una actualización posterior de contactos, una desconexión, no abrir el PDF o un fallo de entrega.

Una vez listo, la configuración del juego y los participantes permanecen congelados. Iniciar es otra acción expresa y abre la primera ronda. «Listo» acredita estas condiciones del motor; no significa que el piloto completo haya sido aprobado para producción ni que las etapas de contacto y premios estén implementadas.

## Extracciones y estados

### Modalidad manual

La consola exige escribir y revisar el número antes de confirmarlo. La confirmación usa versión y ronda revisadas; si otro operador ya modificó la partida, el botón queda obsoleto y el servidor rechaza el comando. No se admiten números fuera de rango, fraccionarios, repetidos en la ronda o ingresados fuera de estado en juego.

Un número confirmado no se borra para ocultar una incidencia. El operador registra el motivo y, opcionalmente, la extracción relacionada. La incidencia pausa una partida que estaba en juego y conserva secuencia, cartones y resultados. La resolución operativa se coordina expresamente; no se implementó una edición retroactiva silenciosa de bolillas.

### Modalidad digital

El servidor elige con `crypto.randomInt` entre los números restantes. No acepta un número elegido por el cliente. Al agotarse el universo se rechaza otra extracción; no se recirculan bolillas dentro de la ronda.

### Transiciones

- Preparación → listo: validación y copia congelada.
- Listo → en juego: inicio expreso.
- En juego → pausado: operador, incidencia o detección bajo política de pausa.
- Pausado → en juego: reanudación autorizada, sujeta a candidatos pendientes cuando se eligió pausar por contacto.
- En juego/pausado → nueva ronda independiente: conserva cartones, devuelve bolillas y reinicia marcas derivadas.
- Listo/en juego/pausado → finalizado: acción expresa con motivo; conserva los datos y no confirma premios pendientes.

La siguiente ronda exige haber detectado candidatos en la actual. Si las reglas requieren pausa por contacto o prohíben repetir ganadores, no avanza con candidatos primarios sin resolver. Esas resoluciones se implementarán en la etapa 6. Con continuidad y repetición permitidas puede seguir el programa, conservando las candidaturas pendientes para su gestión posterior.

Las rondas independientes siguen el orden confirmado, con siete rondas y una O. La activación secuencial con marcas acumuladas no está soportada ni se adopta por defecto. En modalidad simultánea hay una ronda y todas las figuras están activas desde el inicio; no se garantiza que O salga última.

## Evaluación, empates y evidencia

Cada figura es una máscara de casillas. El centro `null` está satisfecho desde el inicio si forma parte de la figura. Los aciertos fuera del dibujo no invalidan una completación. Las marcas son derivadas de la secuencia guardada, no datos editables enviados por el jugador.

En cada extracción se recorren todos los cartones congelados, aplicando la elegibilidad por repetición. Se detecta el conjunto completo que completa cada figura por primera vez; no se corta el recorrido al encontrar el primero. Todos los que llegan en la misma primera bolilla forman el grupo `primary` de esa figura y su cantidad de empatados queda guardada.

Si continúa la extracción, las completaciones de bolillas posteriores se conservan como `reserve`, con su propia secuencia y evidencia. No se suman al primer grupo ni se convierten automáticamente en ganadores. Esa conservación permite aplicar RF-17 después, sin perder candidatos surgidos durante contactos. Si un pozo ya figura como adjudicado, el motor deja de agregar candidatos a esa figura. La transición de adjudicación será responsabilidad de la etapa 7.

Cada candidatura conserva configuración y versión, máscara, números, huella del cartón, casillas necesarias y extracción que completó el patrón. El motor también guarda los diez cartones más cercanos por figura y sus números pendientes para la consola. El orden usado para mostrar cercanía no decide quién gana.

Cuando no se permite repetir ganadores, las personas con una candidatura ya confirmada o entregada quedan fuera de nuevas figuras. Una mera detección no elimina a la persona, y un descarte por falta de respuesta no presume su exclusión de las figuras siguientes. Las pruebas simulan esos estados persistidos: todavía no existe un botón que confirme o descarte una respuesta en esta etapa.

No se crean registros `Award`, no se reparte dinero y no se inicia un temporizador por detectar una figura. Las alertas persistentes con reconocimiento y sonido corresponden a la etapa 6; aquí se muestran los grupos y sus contadores al actualizar la consola.

## Consistencia y recuperación

Se reutiliza el ejecutor de comandos con `expectedVersion`, `Idempotency-Key`, transacciones y confirmación `majority`. La extracción digital se elige dentro del comando y su recibo permite recuperarla aunque se pierda la respuesta. Las acciones concurrentes sobre la misma versión no generan dos números de secuencia iguales: una gana y la otra recibe conflicto.

Bolilla, candidatos, contadores de figura, progreso y auditoría se confirman o revierten juntos. Se cambió la inserción individual de candidatos por inserción masiva validada para evitar miles de consultas por una misma extracción empatada. Los índices por ronda/número, ronda/secuencia, figura/cartón y grupo de consulta refuerzan estas garantías.

El estado se reconstruye desde MongoDB tras reconexión. El centro libre y el cartón no cambian al abrir otra ronda. Se conservaron las pruebas anteriores de interrupción del proceso dentro de una transacción de extracción y se añadió rollback después de actualizar la detección de figuras, antes de completar la inserción de candidaturas.

## Consola y permisos

El administrador configura reglas. Administrador y operador pueden preparar, iniciar, pausar, reanudar, extraer, abrir ronda, registrar incidencias y finalizar. El resto del personal con lectura puede consultar el estado oficial y evidencia sin controles de operación.

La consola consulta el servidor cada segundo y muestra número, secuencia, ronda, máscaras, avance y cantidades completas de empatados. Las candidaturas se paginan; paginar no limita quién se evalúa ni quién queda registrado. Se distinguen primer grupo y reserva y puede revisarse el historial por ronda.

Los contactos se solicitan solo con una acción explícita y permiso `contacts:read`, en una vista privada separada. Incluye el vínculo de envíos registrados del mismo cartón y persona; los envíos siguen siendo simulados. La secuencia y las consultas generales no incluyen nombre, email o teléfono. Las incidencias, cuyo texto puede ser privado, requieren operación o auditoría. Estas consultas quedan auditadas sin copiar contactos al log.

## API

Prefijo `/bingo-api/pilot/editions/:editionId/game`:

| Método y ruta | Efecto o permiso adicional |
| --- | --- |
| `GET /` | Snapshot transaccional de estado, reglas vigentes, ronda, secuencia, figuras y avance. |
| `GET /configurations` | Historial de configuraciones sin la referencia libre de confirmación. |
| `GET /candidates` | Evidencia paginada; filtros `roundId`, `figure`, `cohort`. |
| `GET /candidates/:id/contact` | Contacto y vínculos de envío; requiere `contacts:read`. |
| `GET /incidents` | Historial privado; operación o auditoría. |
| `POST /configure` | Reglas completas y revisión; requiere `editions:configure`. |
| `POST /prepare`, `/start`, `/pause`, `/resume` | Control de estados; requiere `game:operate`. |
| `POST /draw` | Ronda actual y número solo si es manual; requiere `game:operate`. |
| `POST /next-round` | Nueva ronda independiente, sin alterar cartones. |
| `POST /incidents` | Incidencia con motivo; pausa si estaba en juego. |
| `POST /finish` | Finalización con motivo y conservación de resultados. |

Todas las rutas requieren personal autenticado y lectura de participantes. Las mutaciones exigen versión y clave de idempotencia. Los listados admiten de 1 a 100 elementos por página y las referencias se comprueban dentro de la edición. No existe endpoint para que un jugador envíe marcas o proclame un ganador.

## Pruebas y mediciones

Entorno: macOS ARM64, Node 22.16.0, npm 11.17.0 y MongoDB efímero 7.0.14 con replica set. No se agregaron dependencias en esta etapa. Los datos, reglas y máscaras de prueba son sintéticos y no aprueban las reglas pendientes del evento.

El conjunto nuevo cubre validación de reglas, centro y marcas externas, todos los empates, reservas, estados e incidencias, lista y PDFs completos antes de listo, desconexión del jugador y fallo de entrega sin pérdida de elegibilidad, rondas y conservación del PDF, exclusión por victorias confirmadas cuando se prohíbe repetir, extracción digital completa sin reposición, concurrencia de dos operadores HTTP distintos, reintentos, reconexión y rollback de resultados parciales. Incluye las siete rondas configuradas con una O y suma de pozos de $400.000, sin adjudicar premios.

La prueba de volumen usa 3.000 cartones distintos persistidos con PDFs y una figura activa en ronda independiente. Fuerza que los 3.000 completen en la misma primera bolilla y verifica que se guarden los 3.000 candidatos primarios. Después registra otras 24 extracciones y consulta el snapshot por HTTP tras cada una. La medición va desde el inicio de la petición de extracción hasta recibir el snapshot posterior: incluye evaluación, persistencia y HTTP local.

La ejecución final de regresión dio p95 de **48 ms**, máximo de **198 ms**, y **198 ms** para la extracción con 3.000 empatados. Son resultados locales de una consola HTTP y una figura activa. No incluyen navegador remoto, render de pantalla, polling, Internet o YouTube; no acreditan por sí solos RNF-02 en producción ni el peor caso de siete figuras con 21.000 candidaturas simultáneas.

Se añadió sensibilidad del evaluador puro con 10.000 cartones sintéticos, siete figuras y 70.000 completaciones: aproximadamente **33 ms** en una ejecución. Para aislar el algoritmo se repiten disposiciones sintéticas; no es una emisión válida de cartones únicos ni una prueba de MongoDB, HTTP, 10.000 conexiones o del piloto completo. La prueba imprime alcance y medidas para no confundir ambas evidencias.

Para reproducir:

```shell
nvm use
npm test
npm run test:api
npm run build
npm run lint
```

La suite imprime `GAME_LOAD_METRICS` y `GAME_ENGINE_SENSITIVITY` con parámetros y tiempos. Las duraciones pueden variar por carga del equipo. La primera ejecución de la preparación detectó y permitió corregir la lectura de tipos binarios en una consulta de MongoDB; la validación actual calcula las huellas sobre los bytes correctos.

Resultados finales del 16 de noviembre de 2026, con Node 22.16.0:

| Verificación | Resultado |
| --- | --- |
| API, persistencia e integración | 79 pruebas aprobadas, ninguna omitida o fallida; aproximadamente 166 s |
| Interfaz y regresión del cliente | 139 pruebas aprobadas en 31 suites |
| Compilación | Correcta |
| Lint | Sin errores; seis advertencias de longitud de línea preexistentes |
| Sintaxis del servidor y pruebas API, y `git diff --check` | Correctos |

Las pruebas de integración levantan MongoDB local con soporte de transacciones. En este entorno requirieron ejecutar el runner fuera del sandbox para permitir sus puertos locales. No se realizó un ensayo visual manual completo en navegador real ni un ensayo operativo del programa; esos controles forman parte de la etapa 8.

## Límites de esta entrega

RF-07 a RF-12 cuentan con configuración explícita y funcionamiento del motor, dentro de las combinaciones admitidas. PA-05 tiene reinicio real de ronda con conservación de cartón y centro; PA-06, detección y evidencia privada; PA-07, conjunto completo de empates sin reparto todavía; PA-08 a PA-11, evaluación y consistencia sin depender del jugador. La parte de adjudicación y exportación de premios sigue pendiente.

Con pausa durante el contacto, una detección puede dejar la partida bloqueada esperando respuestas; esa protección es intencional y no se ofrece un atajo para ignorarla. Las transiciones de contacto y reparto se implementarán en las etapas 6 y 7. Las políticas de descarte y dinero están registradas para aplicarse después, no ejecutadas por este motor.

No se contactaron jugadores ni se usó un proveedor real. No se cambiaron el brief, la lista real o las decisiones globales pendientes. La siguiente etapa es añadir alertas persistentes y el flujo de contacto con vencimiento individual de 60 segundos sobre estas candidaturas.
