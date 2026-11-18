# Etapa 4: entrega masiva trazable con proveedor simulado

Fecha: 16 de noviembre de 2026. Estado: implementada en el alcance solicitado de simulación. **No se envían mensajes reales.** No existe adaptador SMTP, cliente de email, API de WhatsApp ni configuración para habilitarlos accidentalmente. La integración y habilitación de un proveedor real siguen pendientes.

## Resultado y componentes

Se agregó una cola persistente de entregas individuales que consume los PDFs de la etapa 3. Cada trabajo conserva edición, participante, cartón, fila de origen, canal, destinatario, huella del PDF y responsable de la solicitud. Cada intento conserva fecha, estado, referencia del proveedor, resultado y motivo técnico cuando corresponde.

| Componente | Función |
| --- | --- |
| `bingo-api/pilot/deliveries.js` | Encolado, reintentos, reenvíos, procesador, reconciliación y eventos simulados. |
| `bingo-api/pilot/mock-provider.js` | Adaptador sin red: aceptación, confirmaciones y fallos simulados con recibos durables en MongoDB. |
| `bingo-api/pilot/delivery-routes.js` | API privada de cola, historial, operación y simulación. |
| Modelos `Delivery`, `DeliveryControl`, `SendAttempt`, `MockReceipt`, `DeliveryEvent` | Trabajos, límites compartidos entre procesos, intentos, evidencia del simulador y deduplicación de eventos. |
| `scripts/delivery-worker.cjs` | Procesador local persistente o una sola pasada con `--once`. |
| `DeliveryPanel.js` | Consola de estados, destinatarios, incidencias, historial y acciones explícitas. |

No se invoca el generador de cartones ni el renderizador PDF al entregar. Antes del despacho se lee el PDF almacenado y se comprueban sus bytes contra la huella del cartón y del trabajo. Un documento faltante o corrupto queda como incidencia; no se reemplaza silenciosamente.

## Flujo y permanencia de la asignación

1. Cerrar la lista conciliada con sus cartones y PDFs completos. Esta condición fija el conjunto de participantes antes de preparar la entrega inicial.
2. Elegir canal y escenario simulado. Se pueden encolar todos los pendientes por lotes de hasta 100 o seleccionar participantes por sus identificadores internos.
3. El sistema obtiene los destinatarios de los contactos registrados; no acepta un email, teléfono o adjunto arbitrario como destino de la petición.
4. Cada trabajo inicial es único por edición/cartón, con independencia del canal. Reencolar, reimportar o reintentar la misma petición no crea otro trabajo inicial.
5. El procesador reclama un trabajo, guarda el intento y despacha un único destinatario con su PDF individual, sin listas CC/BCC.
6. La aceptación se conserva como tal. La entrega solo se registra cuando el simulador tiene una confirmación explícita, consultada o introducida como evento simulado.
7. Ante fallos, se consulta el historial y se aplica reintento, reconciliación o reenvío, según el estado.

La cola guarda una copia inmutable del canal, destinatario y huella del PDF de cada trabajo. Si el contacto vigente ya no coincide al procesarlo, aparece `recipient_changed`. No se cambia el destinatario histórico. El operador debe gestionar la corrección por el procedimiento correspondiente y pedir un reenvío explícito al contacto registrado actual de la misma persona.

Un fallo, rebote o envío incierto no modifica la actividad del participante, no elimina el cartón y no bloquea su evaluación por el motor futuro. Tampoco cambia la adjudicación ni inicia el minuto de contacto por premio: esta entrega inicial es un flujo diferente.

## Estados y significado

| Estado | Significado |
| --- | --- |
| `pending` | Trabajo en cola, eventualmente esperando su fecha de reintento. |
| `processing` | Reclamado temporalmente por un procesador; tiene identificador de posesión y vencimiento. |
| `uncertain` | No se sabe si el proveedor aceptó el intento. Se bloquea el reenvío a ciegas. |
| `provider_accepted` | El proveedor simulado aceptó el documento. **No acredita recepción ni lectura.** |
| `delivered` | Existe confirmación explícita de entrega simulada. No implica lectura. |
| `bounced` | El simulador confirmó un rebote. |
| `failed` | Fallo definido o presupuesto automático agotado; queda visible para gestión. |

El estado del trabajo puede volver a `pending` tras un fallo temporal. El intento anterior permanece registrado como `failed`; no se borra para aparentar que el envío tuvo éxito.

## Reintentos, resultados inciertos y reenvíos

### Fallos definidos

Los fallos temporales permiten hasta tres intentos automáticos, con esperas de uno y dos segundos entre ellos. Tras agotar ese presupuesto, el trabajo queda fallido. Un nuevo intento manual requiere motivo y queda registrado con su responsable; no reinicia silenciosamente el historial ni habilita un bucle de reintentos ilimitado.

Los fallos permanentes y rebotes no se reintentan automáticamente. El operador puede solicitar un intento adicional con el mismo destinatario o un reenvío explícito, justificándolo. En simulación también puede elegir un escenario de recuperación para probar el procedimiento.

### Incertidumbre y recuperación

Cada intento tiene una clave estable para el proveedor. El simulador guarda sus recibos en MongoDB y reconoce una segunda invocación con la misma clave y contenido. Si el contenido difiere, la rechaza.

Un timeout posterior a la aceptación se resuelve consultando ese recibo, sin crear otro mensaje. Si no hay información definitiva, el intento permanece incierto. Un trabajo en procesamiento o incierto bloquea otro envío del mismo cartón hasta aclararse, incluso si se intenta cambiar de canal.

Un resultado definitivo de «no aceptado» sella la clave anterior. Un procesador atrasado no puede convertir ese intento después en aceptado cuando ya se autorizó un nuevo intento. El simulador distingue este resultado de la simple ausencia de evidencia. No se asume que un 404 o un timeout de un proveedor real tenga esa garantía.

La posesión de trabajo vence a los 60 segundos. Si un procesador se interrumpe, el siguiente marca el resultado como incierto y consulta al proveedor antes de decidir. Una respuesta atrasada de un procesador anterior no puede hacer retroceder un estado ya reconciliado o entregado: la escritura comprueba posesión, estado y clave de intento.

### Reenvío explícito y canal alternativo

Un reenvío crea un trabajo nuevo vinculado al anterior, con el mismo participante, cartón y PDF. Puede cambiar de email a WhatsApp simulado o viceversa usando el contacto registrado, pero no admite transferir el documento a otra persona ni reemplazar sus números. Exige motivo y conserva ambos trabajos.

Reenviar un documento ya aceptado o entregado es una decisión expresa; puede producir otra entrega intencionada y no se presenta como un reintento automático sin duplicados. Las garantías de unicidad se refieren a la entrega inicial, al procesamiento del mismo intento y a los reintentos de una misma operación.

## Persistencia y límites del procesador

Las operaciones de personal usan los comandos versionados e idempotentes de las etapas anteriores. El reclamo del trabajo, intento y auditoría se guardan transaccionalmente. El despacho se hace **fuera** de esa transacción: un efecto del proveedor no puede deshacerse mediante rollback de la base local.

Los resultados usan transacciones independientes y comprobaciones de posesión. No incrementan la versión de edición ni modifican bolillas o resultados del juego. Los índices únicos de trabajo, intento, recibo y evento limitan duplicados ante concurrencia.

Existe una puerta persistente por edición que permite como máximo una solicitud nueva cada 100 ms, compartida entre procesadores. La cola es reanudable y los reintentos esperan su fecha. El límite no acredita las cuotas de un proveedor real ni es un límite global compartido por todas las ediciones.

Para operar sin una ventana del navegador abierta:

```shell
npm run deliveries:worker
```

Para procesar solo el trabajo actualmente disponible:

```shell
npm run deliveries:worker -- --once
```

Se usan Node 22 y la URI MongoDB replica set de `.env`. El proceso imprime «SIMULATION ONLY» y no imprime destinatarios o credenciales. Ctrl+C/SIGTERM detiene el ciclo; el estado confirmado permanece en la base. No se instaló un servicio del sistema ni un supervisor: el comando debe ejecutarse para que la cola avance sin la consola.

## Simulaciones disponibles

| Escenario | Comportamiento |
| --- | --- |
| `accepted` | Acepta, sin confirmar entrega. |
| `delivered` | Acepta y dispone de confirmación explícita simulada de entrega. |
| `bounced` | Acepta y luego permite consultar el rebote simulado. |
| `transient_failure` | El primer intento falla temporalmente; el siguiente puede aceptarse. |
| `temporary_outage` | Fallos temporales persistentes para agotar el presupuesto automático. |
| `permanent_failure` | Fallo definido sin reintento automático. |
| `timeout_before_accept` | Primer intento incierto; la consulta confirma no aceptación. |
| `timeout_after_accept` | Guarda la aceptación y pierde la respuesta; la consulta evita reenviar. |
| `unknown` | El primer intento permanece incierto hasta aportar evidencia simulada; después puede recuperarse. |

Los eventos manuales son operaciones autenticadas **del simulador**, no webhooks públicos ni confirmaciones reales de un destinatario. Llevan clave de evento y clave del intento. Se deduplican, rechazan cambios incompatibles y no permiten transformar una negativa definitiva en una entrega del mismo intento. Los marcadores `not_accepted` del simulador son evidencia negativa; no representan mensajes enviados.

## Consola, API y permisos

La consola distingue simulación, aceptación, entrega e incidencias, permite filtrar estados y consultar intentos. El procesamiento puede pausarse al terminar el lote en curso; la cola también puede retomarse con el comando local. Los reenvíos y reintentos piden motivo, y los casos inciertos ofrecen reconciliación en lugar de repetir a ciegas.

Administrador e importador tienen `deliveries:read`, `deliveries:manage` y acceso a contactos. Operador y auditor tienen consulta de entregas; viewer no accede a destinatarios. Las rutas verifican la edición del trabajo y no devuelven contactos de otras ediciones mediante una referencia ajena.

Prefijo `/bingo-api/pilot/editions/:editionId/deliveries`:

| Método y ruta | Función |
| --- | --- |
| `GET /summary` | Conteos, pendientes iniciales y límites; señala simulación. |
| `GET /` | Listado privado paginado, con filtro opcional `state`. |
| `GET /:jobId` | Origen, vínculo con el trabajo previo, motivo e historial de reintentos. |
| `GET /:jobId/attempts` | Intentos, fechas, destinatario, referencia del proveedor y huella PDF. |
| `POST /enqueue` | Canal, escenario y lote de pendientes; opcional `participantIds`. |
| `POST /process` | Ejecuta un lote de procesador; no admite opciones de proveedor real. |
| `POST /:jobId/retry` | Otro intento con el mismo destino, con `reason`. |
| `POST /:jobId/resend` | Nuevo trabajo, mismo cartón/persona y canal registrado elegido, con `reason`. |
| `POST /:jobId/reconcile` | Consulta la evidencia del simulador para el intento actual. |
| `POST /:jobId/mock-event` | Evento simulado con `eventKey`, `providerKey` y `status`. |

Encolado, reintento, reenvío y evento requieren `expectedVersion` e `Idempotency-Key`. Procesamiento y reconciliación usan la protección de posesiones/estados; no hacen un envío externo dentro del ejecutor de comandos. El listado admite de 1 a 500 trabajos por página y los lotes, de 1 a 100.

Se auditan solicitudes, reclamos del procesador, resultados, reintentos y consultas privadas. Los destinatarios y motivos libres permanecen en sus registros protegidos y no se copian al log de auditoría. La emisión de alertas de premios sigue siendo otra función, pendiente de la etapa 6.

## Verificación y resultados

Entorno: macOS ARM64, Node 22.16.0, npm 11.17.0 y MongoDB temporal 7.0.14 con replica set. No se agregaron dependencias al proyecto en esta etapa.

| Control | Resultado |
| --- | --- |
| Suite completa de API, `npm run test:api` | **62 pruebas aprobadas**, incluidas las 48 anteriores y 14 de entrega. |
| Interfaz, `npm test` | **30 suites y 134 pruebas aprobadas**, con cuatro pruebas nuevas del panel. |
| `npm run build` | Compilación correcta. |
| `npm run lint` | Cero errores y seis advertencias heredadas de longitud de línea. |
| `node --check` en backend, scripts y pruebas | Sin errores de sintaxis. |
| `git diff --check` | Sin errores de espacios. |

Se comprobaron encolado concurrente e idempotente, recuperación tras reconexión, destinatario individual y PDF correcto, aceptación distinta de entrega, eventos repetidos, rebotes, backoff, agotamiento de reintentos, motivo del intento manual, fallos permanentes, timeouts antes/después de aceptar, incertidumbre persistente, interrupción simulada después del efecto del proveedor, vencimiento de posesión, respuesta atrasada, límite compartido entre procesadores, canal alternativo, permisos, referencias entre ediciones y ejecución real del CLI contra la base efímera.

La prueba de volumen generó y procesó **3.000 entregas simuladas**, comprobando para cada una destinatario, vínculo con el cartón, tipo de documento, tamaño y huella del PDF original. Reencolar con otro canal no creó una segunda entrega inicial. Se comprobaron 3.000 intentos y 3.000 recibos de aceptación, sin crear cartones o PDFs nuevos durante el despacho.

Los fallos de PDF y destinatario alterado se conservaron como incidencias, sin regeneración ni cambio silencioso del destino. Las pruebas del panel verifican que la simulación se anuncie, la aceptación no aparezca como entrega, el rol de consulta no tenga controles de envío y un reenvío o evento conserve el vínculo correcto.

La suite completa tomó aproximadamente 152 segundos en este equipo. La prueba de volumen usa un reloj controlado para avanzar las esperas, y el límite real se comprueba aparte con procesadores concurrentes. Ese tiempo no es un benchmark de un proveedor real ni estima su plazo de entrega. No se realizó un recorrido visual manual completo de la consola en navegador real.

## Alcance y pendientes

PA-16, la parte de entrega de PA-18 y la conservación de asignación de PA-22 tienen cobertura con simulador. Un proveedor real todavía necesita selección, habilitación, remitente/canal, credenciales protegidas, cuotas, callbacks autenticados y garantías comprobadas de idempotencia y consulta. WhatsApp solo está representado como canal simulado: no se acreditó disponibilidad de un proveedor ni aprobación de documentos o plantillas.

La política ante incertidumbre de un proveedor real deberá basarse en sus garantías; esta implementación no promete entrega exactamente una vez para un servicio externo desconocido. No se enviaron emails, mensajes de WhatsApp, notificaciones de premios ni pagos; tampoco se desplegó el sistema o se cambiaron bases reales. La siguiente etapa del plan es el motor de partida oficial y evaluación automática.
