# Etapa 6: alertas persistentes y contacto individual

Fecha: 16 de noviembre de 2026.

La consola operativa en `back-office.html` permite reconocer alertas de candidatos, registrar intentos y avisos exitosos o fallidos, conservar un minuto individual por candidatura y resolver respuestas o descartes con evidencia. El servidor sigue siendo la fuente oficial de tiempos y estados. No se enviaron mensajes reales ni se añadió un proveedor de contacto automático.

## Alertas durables y reconocimiento

Cada extracción que crea candidatos guarda, en la misma transacción que bolilla, evaluación y candidatos, una alerta por figura y grupo (`primary` o `reserve`). La alerta contiene ronda, extracción, cantidad completa de candidatos y fecha. Un empate de 3.000 personas produce una alerta con cantidad 3.000, sin truncar el conjunto de candidatos guardados. Figuras simultáneas producen alertas distintas. Las reservas quedan identificadas y no se mezclan con el primer grupo.

La clave única `(drawId, figure, cohort)` impide duplicar alertas al reintentar. Si la transacción de extracción falla, tampoco queda una alerta parcial. La consola consulta alertas cada dos segundos; las no reconocidas siguen visibles, con texto y borde, hasta reconocimiento explícito. El reconocimiento es compartido entre operadores, conserva fecha y actor y es idempotente. No confirma un premio, no marca contacto y no inicia el reloj. Se puede consultar el historial reconocido y paginarlo (25 filas por página; la API permite hasta 100).

El botón **Habilitar y probar sonido** requiere una interacción del usuario y emite un tono real de Web Audio. Mientras exista al menos una alerta pendiente, se repite cada cuatro segundos. **Silenciar en esta consola** detiene el sonido local y conserva la alerta pendiente. Una suspensión o bloqueo de audio muestra un error y permite habilitarlo otra vez. Tras recargar se debe habilitar el sonido nuevamente por las restricciones de reproducción del navegador. Las alertas de candidatos están separadas de las incidencias de partida y de las de entrega del PDF.

Para candidaturas creadas antes de instalar esta etapa existe **Recuperar alertas de candidaturas existentes**. Reconstruye las agrupaciones desde candidatos y extracciones oficiales completas, sin duplicar alertas ni borrar reconocimientos. Debe ejecutarlo un operador al actualizar una base que ya tenga partidas de la etapa 5. No inicia contactos ni cambia cartones.

## Contacto y plazo de respuesta

El flujo por candidatura es:

```text
detectado → contactando → esperando respuesta → confirmado por respuesta oportuna
                                             ↘ descartado
```

1. **Consultar contacto** revela, con permiso y auditoría, la persona registrada, email, teléfono, evidencia del cartón y los envíos del PDF vinculados a esa misma persona y cartón. Incluye identificadores de envío y su origen de reenvío, destinatario y estado; copiar o reenviar el PDF no cambia al titular del candidato.
2. **Registrar intento de contacto** exige canal `email` o `whatsapp` y evidencia. El servidor obtiene el destinatario del participante de esa edición; no acepta uno elegido por el cliente. Conserva una copia del canal y destinatario del intento. La fase `contactando` todavía no tiene vencimiento. Se puede registrar otro intento o canal mientras no exista aviso exitoso, conservando el historial previo.
3. El personal realiza el contacto fuera de la aplicación. **Registrar aviso fallido** conserva evidencia y mantiene `contactando`, sin iniciar un minuto ficticio. La aceptación o fallo del envío inicial del PDF no sustituye este aviso de premio.
4. **Confirmar aviso exitoso e iniciar 60 segundos** guarda `contactStartedAt` con el reloj del servidor, `expiresAt = contactStartedAt + 60.000 ms`, canal, destinatario y operador. Pasa a `awaiting_response`. El cliente no puede suministrar ni mover estas dos fechas. Otro aviso, canal o reintento con clave nueva no puede reiniciar el plazo. El reintento con la misma clave devuelve el resultado original.
5. **Registrar respuesta y resolver** exige hora de recepción ISO con zona horaria y evidencia del canal. La recepción no puede preceder al aviso ni estar en el futuro respecto del servidor. Una recepción anterior o igual a `expiresAt` confirma la respuesta; una posterior, incluso por un milisegundo, queda descartada con motivo `late_response`. Se guardan por separado recepción, registro/resolución y operador.
6. Si no hubo respuesta, después del vencimiento **Resolver descarte por falta de respuesta** exige evidencia y confirmar expresamente que se revisó el canal y no hay respuesta oportuna pendiente. Guarda `no_timely_response`, fecha y operador. En el instante exacto del vencimiento todavía no permite este descarte, pues una respuesta en ese límite es válida.

El destinatario del intento se muestra separado de los datos actuales del participante. El historial privado conserva cada intento, aviso, respuesta o revisión, con estado anterior y posterior, evidencia, canal, destinatario y actor. Es append-only en la capa de aplicación. La consulta muestra los 200 eventos más recientes; todos se conservan en la base. La auditoría general referencia operaciones y candidatos sin copiar destinatarios ni evidencia privada.

### Vencimiento y conciliación tardía

Al vencer, la API deriva `deadlineStatus = expired_pending_review` y la consola indica **Plazo vencido: conciliar respuesta o descarte**. No renueva el reloj ni confirma por defecto. La candidatura permanece pendiente de resolución hasta registrar la recepción acreditada o revisar y descartar. Este paso permite cumplir la recepción oportuna registrada después: una persona que respondió a los 59 segundos puede acreditarse después del minuto con la hora y evidencia originales. Una persona que realmente respondió a los 61 segundos queda descartada aunque el operador registre la respuesta inmediatamente.

No se concede tiempo adicional para responder ni se reserva un monto reclamable después: se mantiene una tarea de conciliación operativa, sin crear un premio o adjudicación. Resolver el descarte exige haber agotado esa revisión. Una resolución terminal no puede transformarse después en confirmación desde este flujo; por eso el operador debe registrar las respuestas oportunas antes de dar por revisado el canal. La evidencia es una declaración auditada del personal sobre un canal externo, no una verificación automática del proveedor.

Confirmación y descarte usan el mismo control transaccional de versión de edición e idempotencia de etapas anteriores. Dos operadores con la misma versión no pueden confirmar y descartar simultáneamente: uno confirma su transacción y el otro recibe conflicto. Los reintentos no agregan eventos o resoluciones duplicados. El servidor admite terminar la conciliación aun si terminó la extracción de la partida; finalizar la partida no adjudica ni cierra el reparto.

Cada empatado tiene su propio contacto y sus propias fechas. No se usa un temporizador de grupo ni la hora del video o del navegador. Las candidaturas en reserva aún no pueden contactarse para el mismo pozo: su habilitación depende de la continuación y reparto de la etapa 7. No se puede descartar a alguien que sigue en `detectado` o `contactando` como si hubiera transcurrido su minuto.

Cuando las reglas exigen pausa durante el contacto, el motor mantiene bloqueadas reanudación y siguiente ronda hasta resolver todos los candidatos primarios, incluidos los vencidos pendientes de revisión. Con prohibición de repetir ganadores se conserva también la barrera de avance existente. Ningún empate se resuelve implícitamente por orden de recorrido o selección del primer contacto.

## Consola, permisos y recuperación

El contador parte de la hora recibida del servidor y avanza con tiempo monotónico local. Es una estimación visual; la API decide la validez. Mientras el contacto está abierto se sincroniza cada dos segundos. Si pasan más de cinco segundos sin sincronización, advierte y deshabilita las resoluciones; ofrece actualización manual. No se anuncia cada segundo al lector de pantalla; los vencimientos y estados también aparecen como texto y fechas absolutas.

Administrador y operador pueden iniciar intentos, registrar avisos y reconocer alertas (`game:operate`). Confirmación y descarte requieren `results:confirm`; todos los cambios de contacto exigen además `contacts:read`. Consultar datos privados conserva la separación de permisos existente. Un viewer puede consultar alertas y evidencia de juego sin contactos ni controles de resolución; un importador no puede operar contactos aunque pueda leer datos del participante. Todas las consultas y mutaciones verifican la edición del recurso.

Los tiempos y resoluciones se guardan en MongoDB. Reiniciar Express, abrir otra consola o crear otra instancia del servicio conserva el vencimiento original y las alertas pendientes. No hay `setTimeout` del servidor cuya pérdida renueve o elimine un plazo. Las lecturas derivan el vencimiento directamente de la fecha persistida.

## API añadida

Todas las rutas cuelgan de `/bingo-api/pilot/editions/:editionId/game`, con autenticación de personal. Los POST requieren `expectedVersion` e `Idempotency-Key`.

| Método y ruta | Función |
| --- | --- |
| `GET /alerts?pending=true&limit=25&offset=0` | Alertas pendientes, cantidad total pendiente y hora del servidor; `pending=false` incluye reconocidas |
| `POST /alerts/:alertId/acknowledge` | Reconocimiento compartido, sin resolver candidatos |
| `POST /alerts/reconcile` | Recuperación de alertas de candidatos existentes |
| `GET /candidates` | Añade fechas, resolución y estado derivado de plazo sin contactos privados |
| `GET /candidates/:candidateId/contact` | Contacto privado, historial reciente, trazas de entrega, reloj y estado persistido |
| `POST /candidates/:candidateId/begin` | Canal y evidencia de intento |
| `POST /candidates/:candidateId/notice` | `success` y evidencia de aviso; únicamente éxito inicia reloj |
| `POST /candidates/:candidateId/respond` | `receivedAt` y evidencia; resuelve según la recepción acreditada |
| `POST /candidates/:candidateId/discard` | Evidencia y `reviewedNoTimelyResponse: true` después de vencer |

No se añadió un endpoint público de respuesta, un envío de mensajes, un premio monetario ni una transición operativa a `delivered`. El estado `confirmed` acredita respuesta oportuna de un candidato; el cálculo, adjudicación monetaria, registro de entrega y exportación pertenecen a la etapa 7.

## Verificación

Pruebas nuevas de integración en `api-tests/contacts.test.cjs`:

- Alerta única con todos los empatados; reintento de extracción y reconocimiento; recuperación sin duplicados ni pérdida de reconocimiento.
- Aviso fallido sin reloj; destinatario resuelto en servidor; aviso exitoso idempotente sin renovación.
- Dos empatados con vencimientos diferentes; consulta después de vencer y servicio restaurado.
- Recepción exacta en el límite, recepción un milisegundo tarde y registro posterior de una recepción oportuna.
- Descarte imposible antes o en el límite, revisión explícita obligatoria y resolución terminal excluyente.
- Confirmación y descarte concurrentes: un solo resultado y evento.
- Rechazo de respuesta futura/anterior al aviso/sin zona, evidencia vacía, reservas y resultados ya cerrados.
- Permisos HTTP, aislamiento entre ediciones, no filtración de contactos, rechazo de reloj/destinatario enviados por cliente, trazas del PDF de la misma persona y cartón, historial append-only.
- Separación por figura y reserva, y rollback de extracción fallida sin alerta parcial.
- Reinicio real de Express durante la espera, conservando contacto, vencimiento y alerta pendiente.

La prueba adicional en `api-tests/game.test.cjs` usa la preparación y partida oficiales: detecta empate, pausa, registra dos contactos, vence ambos, registra una recepción oportuna y descarta al otro tras revisión; solo entonces permite reanudar. No crea premios.

Las pruebas de React verifican contador basado en servidor, acciones con evidencia y permisos, resolución después del vencimiento, revisión obligatoria, estados terminales y reservas, reconocimiento, habilitación/repetición/silencio del sonido y fallo visible de audio. Las pruebas existentes de consola se actualizaron para consultar alertas.

`node scripts/check-stage6-browser.cjs` compila los componentes reales en una página sintética local y usa Chrome instalado mediante CDP. Verifica un `AudioContext` real en estado `running`, dos osciladores reales (prueba y repetición), reconocimiento de la alerta, silencio posterior y render del contador. No instala dependencias. Usa `CHROME_BIN` para cambiar la ubicación de Chrome; por defecto usa la instalación de macOS. El navegador y perfil temporal se cierran y eliminan al finalizar. Este ensayo usa datos sintéticos y API simulada; persistencia y HTTP se prueban por separado contra MongoDB.

Comandos reproducibles con Node 22.16.0 y los requisitos locales de la etapa 0:

```shell
nvm use
npm test
npm run test:api
npm run build
npm run lint
node scripts/check-stage6-browser.cjs
```

Resultados finales con Node 22.16.0:

| Verificación | Resultado |
| --- | --- |
| Regresión completa de API | **90 pruebas aprobadas**, ninguna fallida u omitida; aproximadamente 178 s |
| Regresión completa de interfaz | **148 pruebas aprobadas en 33 suites** |
| Contacto e integración con la partida | Diez pruebas nuevas de contacto y una nueva de partida; aprobadas también en ejecución dirigida |
| Chrome headless | Web Audio real habilitado, prueba y repetición, silencio tras reconocimiento y contador renderizado |
| Compilación | Correcta |
| Lint | Sin errores; seis advertencias preexistentes de longitud de línea |
| Sintaxis de los archivos añadidos y `git diff --check` | Correctos |

La regresión conserva la prueba de 3.000 cartones y 25 extracciones: en esta ejecución dio p95 HTTP local de 49 ms, máximo de 216 ms y 216 ms para la primera detección con 3.000 empatados. Incluye persistencia de la alerta nueva en la extracción. Conserva el alcance y las limitaciones de carga descritas en la etapa 5; no representa la latencia de un navegador remoto o de la transmisión.

En este entorno las pruebas de MongoDB, HTTP y Chrome requieren ejecución fuera del sandbox para sus puertos locales. La comprobación de Chrome usa componentes reales con una API sintética; los tiempos, transacciones y recuperación se verificaron por separado contra MongoDB. Las suites antiguas del cliente todavía emiten algunos mensajes de diagnóstico y advertencias de `act()` de React; no hubo pruebas fallidas.

## Límites y siguiente etapa

La etapa cubre alertas y recepción individual de PA-19 a PA-24, dentro del alcance de contacto. PA-20 y PA-21 todavía no acreditan reparto ni registro de entrega de dinero: no se crean `Award`. La etapa 7 deberá verificar todos los primarios resueltos antes de adjudicar o cerrar irreversiblemente un pozo, aplicar RF-17, mantener el presupuesto y habilitar reservas según las reglas elegidas. No debe interpretar vencidos pendientes de conciliación como confirmados ni como descartes definitivos.

La prueba en Chrome headless verifica ejecución del audio y reconocimiento, pero no escucha el parlante físico ni sustituye el ensayo con el equipo, volumen, navegador, suspensión de pestaña y sonido de transmisión de la etapa 8. Las restricciones de autoplay, permisos de audio y ahorro de energía del navegador siguen aplicando; una alerta visible persiste aunque falle el sonido.

No se cambió el brief ni se aprobaron reglas globales pendientes. No se enviaron mensajes reales ni se desplegó el piloto.
