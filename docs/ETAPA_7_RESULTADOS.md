# Etapa 7: validación del reparto, abonos en polla.cl y reportes

Fecha: 17 de noviembre de 2026.

Se implementaron propuestas revisables de reparto, contabilidad por figura, continuación de los saldos, registro manual de abonos y reportes separados. El destino del premio es **saldo abonado en la cuenta verificada del participante en polla.cl**. Bingo no ingresa a esas cuentas, no solicita contraseñas, no consulta saldos de Polla y no ejecuta abonos. Registra la adjudicación y, posteriormente, el comprobante de un abono realizado fuera de la aplicación.

## Flujo operativo

La consola `back-office.html` incorpora **Premios y abonos en polla.cl**, junto a la partida y el contacto de candidatos.

1. Resolver todos los contactos del grupo primario, incluidos los vencidos pendientes de conciliación. La confirmación de respuesta exige fecha, operador y evidencia de recepción oportuna; por sí sola todavía no adjudica dinero.
2. En el reporte de respuestas oportunas, verificar con Polla la referencia de cuenta de cada confirmado. El identificador importado `jugador_id` es una pista de origen, **no una cuenta verificada automáticamente**. Registrar referencia, evidencia de pertenencia y confirmación expresa. El servidor comprueba que la persona pertenezca a la edición y que la misma cuenta no se asigne a otra persona de esa edición.
3. Registrar motivo y **Preparar reparto**. Se conserva una propuesta única por figura y ciclo, con participantes, estados, cuentas, saldo disponible, participaciones enteras, pesos residuales, semilla y destino del remanente. Se puede revisar todo el grupo por páginas. Preparar no crea premios ni abonos.
4. Revisar el grupo completo, cuentas, montos y destino del saldo; **Validar y adjudicar propuesta**. El servidor valida nuevamente los datos y el presupuesto y crea premios solo para confirmados con una participación positiva. Las participaciones de $0 quedan registradas, sin un abono ficticio ni premio pendiente de entrega.
5. Polla o el equipo autorizado realiza el abono fuera de Bingo. En **Pendientes de abono**, seleccionar el premio y registrar el comprobante individual, fecha efectiva con zona horaria, evidencia y confirmación expresa de que el monto completo ya se abonó en esa cuenta de polla.cl.
6. Consultar/exportar adjudicados, pendientes de abono y abonados; consultar/exportar los descartados por separado. Avanzar de figura únicamente después de resolver el reparto o cierre del pozo actual.

Una cuenta puede corregirse antes de aprobar el reparto. Si ya existía propuesta, debe prepararse nuevamente para actualizar el destino y revisarla otra vez: mantiene el mismo identificador, semilla y participaciones. Después de una aprobación que la utilice, la cuenta queda bloqueada en este flujo, y cada premio conserva su copia del destino. No existe una operación para redirigir un premio aprobado a otra persona.

## Reparto, reglas de continuación y agotamiento

Los montos no llegan desde el cliente: F, A, B, U, L y S tienen $50.000 cada una; O tiene $100.000, una sola vez. Cada figura posee un pozo único por edición.

| Situación y regla congelada | Resultado |
| --- | --- |
| Todos responden oportunamente | Repartir todo el saldo entre los confirmados |
| Algunos descartados, `redistribute_confirmed` | Repartir todo el saldo entre quienes respondieron oportunamente; descartados reciben $0 |
| Algunos descartados, `redispute_remainder` | Calcular las partes del grupo completo; adjudicar solo las de confirmados y volver a disputar las partes descartadas |
| Nadie responde, `advance_keep_unassigned` | No crear premios; cerrar ese saldo como no asignado y permitir la siguiente figura |
| Nadie responde, `redispute_same_figure` | Conservar todo el saldo disponible y abrir un ciclo nuevo de la misma figura |
| Hay reservas cuando se debe volver a disputar | Promover **todo el grupo de la primera extracción oficial pendiente**, no elegir una persona ni mezclar distintas extracciones |
| No hay reservas y todavía existen cartones elegibles | Mantener la figura abierta para nuevas extracciones y candidaturas |
| No queda ningún cartón elegible | Preparar cierre excepcional como no asignado; exige revisión adicional explícita y motivo antes de permitir avanzar |

Ejemplo de remanente: dos empatados disputan $50.000, uno responde y el otro queda descartado. Con `redistribute_confirmed`, el confirmado recibe $50.000. Con `redispute_remainder`, recibe $25.000 y se disputan los otros $25.000; dos confirmados en el siguiente grupo reciben $12.500 cada uno. La segunda adjudicación referencia la propuesta anterior y su saldo, sin crear otro pozo de $50.000.

En modo `redispute_remainder`, el sorteo de pesos residuales se aplica a las partes del grupo original, incluidos los descartados. Una parte descartada, también su peso residual si le correspondió, sigue disponible para redisputa. En modo `redistribute_confirmed`, se aplica solo a los confirmados. Cuando nadie responde, la política de falta total de respuesta determina el destino aunque se haya calculado la distribución del grupo.

Al promover reservas se conservan cartón, PDF, extracción y evidencia originales. Se registran promoción y ciclo; no se reutilizan contactos ni minutos anteriores. Los nuevos primarios deben ser contactados y cada uno inicia sus 60 segundos cuando se registra su aviso exitoso. Si se configuró pausa por contacto, la promoción pausa la ronda. Sin reservas, la extracción puede continuar según el estado de partida; el servidor no extrae una bolilla automáticamente durante una adjudicación.

Quien ya fue confirmado o descartado para esa figura no vuelve a entrar en otra disputa de la misma figura. Su cartón sí puede participar en figuras posteriores según la configuración. Con prohibición de repetir ganadores, una adjudicación **positiva** consume la posibilidad de ganar otra figura; una participación de $0 no equivale a haber ganado dinero. Las figuras simultáneas sin repetición continúan bloqueadas por la falta de una regla de prioridad entre figuras, como en la etapa 5.

El cierre por agotamiento no se presenta como una nueva regla de premio aprobada por Fabuloso: es una excepción operativa explícita, solo disponible cuando el servidor comprueba que no hay reservas ni cartones restantes habilitados. No permite adjudicar el saldo a un descartado. El operador debe reconocer la imposibilidad de continuar y autorizar conservarlo como no asignado. Esta excepción y el criterio de activar reservas por primera extracción pendiente deben incluirse en la revisión operativa de la etapa 8.

## Pesos enteros y aprobación de lo revisado

Se ejecuta la política congelada `auditable_residual_draw`. Se asigna la parte entera a cada integrante y se sortean los pesos residuales, uno por persona: la diferencia entre partes es como máximo un peso. Se ordenan los identificadores antes de Fisher–Yates, con HMAC-SHA256 y rechazo de módulo para los índices del sorteo. Una semilla aleatoria de 256 bits, generada con `crypto.randomBytes`, permite reproducir el resultado con `prize-split.js`.

La semilla y el algoritmo se guardan en la propuesta. Reintentar o corregir una cuenta antes de aprobar **no permite volver a sortear** los pesos. El orden de consulta, contacto o inserción de candidatos no define los residuos. Este registro permite reproducción y auditoría; no implementa un sorteo público con compromiso externo previo de semilla.

La aprobación requiere `reviewedSnapshotHash`, correspondiente exactamente al grupo, reglas, saldo y cuentas mostrados. Además del control de versión de edición, se vuelve a verificar esa huella. Si otro operador corrige un destino y actualiza la propuesta, una pantalla que todavía muestra la cuenta anterior no puede aprobar el destino nuevo, aunque ya haya recibido la última versión de edición por polling.

## Contabilidad y registro del abono

Por pozo se conservan total, adjudicado, abonado, no asignado y saldo disponible. La contabilidad de los siete pozos mantiene:

```text
$400.000 = adjudicado + disponible + no asignado
0 ≤ abonado ≤ adjudicado
pendiente de abono = adjudicado − abonado
```

**Abonado es parte de adjudicado**, no otro gasto que se sume al presupuesto. Una adjudicación reduce disponible; un abono únicamente mueve el premio de pendiente a entregado. Un cierre como no asignado retira el saldo de lo disponible, sin crear un premio ni moverlo a otra figura.

Cada cambio financiero concilia pozos, premios, liquidaciones y comprobantes en una transacción. Las liquidaciones identifican saldo anterior, asignación, saldo no asignado, saldo posterior, ciclo, propuesta fuente, operador, fecha y motivo. Comprobantes y liquidaciones son append-only en la capa de aplicación. No se usan saldos enviados por el navegador. Una inconsistencia bloquea la operación y conserva la transacción previa.

El abono debe coincidir con la totalidad del monto adjudicado y con la cuenta guardada. Exige un comprobante individual no usado antes en la edición, evidencia, fecha efectiva posterior o igual a la adjudicación y no futura, y confirmación `creditedToPolla: true`. No se admiten abonos parciales desde este flujo. Un comprobante de lote debe individualizar cada operación mediante una referencia única para cada premio.

Registrar el abono cambia conjuntamente el premio y el candidato a `delivered`, guarda destino `polla.cl` y actualiza el total abonado. Reintentos con la misma clave devuelven el resultado anterior. Una nueva clave no puede abonar de nuevo un premio ya entregado ni usar el comprobante de otro premio. No existe integración de transferencias ni garantía automática sobre la autenticidad del comprobante: es una constancia auditada del abono externo que declara el equipo.

## Estados, cierre y recuperación

La siguiente ronda independiente exige el pozo actual `adjudicated` o `unassigned`. Resolver contactos sin validar el reparto ya no permite saltarlo. La reanudación de extracción conserva la política de pausa por contacto; puede usarse para obtener nuevas reservas mientras se revisa un reparto si las reglas permiten continuar.

Finalizar la partida se bloquea si existe una detección con reparto pendiente o una redisputa abierta. Para una interrupción se usa pausa/incidencia. Se permite finalizar sin detecciones pendientes, conservando como disponible el dinero de figuras no disputadas: finalizar extracciones no lo convierte en premios ni en abonos.

Para una ronda actual que hubiera quedado finalizada en una versión anterior con saldo sin resolver existe `POST /reopen-round`: requiere revisión y motivo, verifica partida/pozo, registra una incidencia de recuperación y reabre esa misma ronda **en pausa**. Conserva extracciones, candidatos, contactos, premios y presupuesto; las restricciones de reanudación siguen vigentes. No reabre un pozo adjudicado ni reinicia los minutos.

Las bases de etapas anteriores no requieren emitir nuevos cartones o PDFs. Los pozos se inicializan de forma transaccional al preparar el primer reparto o recuperar la ronda. Si existen premios heredados sin el libro contable de esta etapa, se bloquea la operación para conciliación; no se reinterpretan registros antiguos como abonos reales. Saldos de rondas anteriores ya abandonadas, fuera de la ronda actual, requieren revisión de migración: no se trasladan a otra figura automáticamente.

## Reportes y permisos

Los reportes se leen desde un snapshot transaccional e incluyen versión de edición y hora del servidor. Se separan:

- `confirmed`: respuestas oportunas, incluso antes de adjudicar; monto vacío si aún no hay reparto y $0 si fue una participación liquidada sin abono debido.
- `awards`: premios adjudicados positivos.
- `pending`: únicamente premios adjudicados positivos pendientes de abono; excluye descartados y participaciones de $0.
- `delivered`: abonos registrados.
- `discarded`: descartados, sin mezclarlos con premios pendientes.

Incluyen identidad y contactos registrados, fila e identificador de origen, cartón, figura, ciclo, evidencia oficial, historial/evidencia de contacto, plazos y recepción, cuenta verificada y respaldo de verificación, monto, estado, destinatarios de envío del PDF y comprobante/evidencia del abono cuando existe. Se mantiene el vínculo con el participante original del cartón, sin premiar al portador de una copia.

La consola pagina a 25 filas. La API admite hasta 100 por página y filtrar por figura. `format=csv` exporta el conjunto completo del filtro, no solo la página, y rechaza más de 100.000 filas para exigir un filtro explícito. El CSV usa UTF-8 con BOM, comillas y protección de fórmulas de planilla, incluidos contactos o evidencias que comiencen por `=`, `+`, `-` o `@`.

Operador y administrador requieren `results:confirm` y `contacts:read` para cuentas, preparación, aprobación y constancia del abono. Los reportes privados permiten esos roles y a quien tenga `exports:read` más `contacts:read`; CSV exige específicamente `exports:read` (administrador/auditor según roles actuales). Viewer solo consulta contabilidad sin contactos, cuentas ni comprobantes. Importador no opera premios. Lecturas privadas, exportaciones y mutaciones se auditan; la auditoría general no copia datos de cuenta ni evidencia privada. Las respuestas de premios se marcan `private, no-store`.

## API

Base: `/bingo-api/pilot/editions/:editionId/prizes`. Los POST requieren autenticación, `expectedVersion` e `Idempotency-Key`.

| Ruta | Función |
| --- | --- |
| `GET /` | Presupuesto, pozos, resultados, propuestas y liquidaciones sin datos de cuenta privados |
| `GET /accounts/:participantId` | Persona de origen y cuenta verificada con evidencia, bajo permiso |
| `POST /accounts` | Verificar/corregir referencia de cuenta antes de aprobar |
| `POST /prepare` | Preparar/refrescar propuesta única con `resultId` y motivo, conservando el sorteo |
| `GET /proposals/:proposalId` | Detalle revisable, cuentas, participaciones, semilla y huella |
| `POST /confirm` | Aprobar `proposalId`, `reviewedSnapshotHash`, `reviewed: true` y motivo; en agotamiento exige `exhaustionAcknowledged: true` |
| `POST /credits` | Registrar `awardId`, monto completo, cuenta, referencia, evidencia, `creditedAt` y `creditedToPolla: true` |
| `POST /reopen-round` | Recuperar ronda actual detenida con `reviewed: true` y motivo, dejando pausa |
| `GET /reports/:kind` | Reporte privado paginado; admite `figure`, `limit`, `offset`, `format=csv` |

## Pruebas y resultados

Las pruebas nuevas cubren:

- Reparto entero exacto, residuos reproducibles e independencia del orden de entrada.
- Contactos pendientes, evidencia oportuna y verificación explícita de cuenta antes de adjudicar.
- Propuesta única sin nuevos sorteos, corrección antes de aprobar, rechazo de una huella anterior y bloqueo de cambio de cuenta después de aprobar.
- Redistribución entre confirmados, redisputa del remanente, las dos alternativas cuando nadie responde y promoción del grupo completo de reservas por extracción.
- Pausa por contacto al promover reservas y minutos individuales nuevos.
- Agotamiento con revisión excepcional; redisputas sucesivas hasta un peso y exclusión de participaciones de $0 de los abonos pendientes.
- Aprobaciones concurrentes, reintentos de abono sin duplicados y comprobantes únicos.
- Rechazo de monto, cuenta, evidencia o fecha incorrectos; persistencia de recibos tras reconectar MongoDB.
- Siete figuras independientes y simultáneas, una sola O y máximo $400.000; orden inverso de liquidación de figuras con mismos ganadores y montos.
- Bloqueo de avance/cierre sin reparto y rollback conjunto de premios, libro, propuesta y liquidación cuando falla la continuación; recuperación auditada.
- Permisos e aislamiento HTTP, aprobación vinculada a la vista revisada, reportes separados y CSV protegido.
- Consola: presupuesto sin contactos para viewer, revisión antes de aprobar, cuenta sin inferencia automática, formulario de constancia de abono y reportes separados.

Se actualizaron las pruebas de rondas de la etapa 5: ahora resuelven contacto, verifican cuenta y adjudican antes de avanzar. No se eliminaron las comprobaciones de evaluación, empates, cartones/PDF permanentes, volumen ni concurrencia de extracciones.

Comandos con Node 22.16.0 y MongoDB local de pruebas:

```shell
nvm use
npm test
npm run test:api
npm run build
npm run lint
```

Resultados finales con Node 22.16.0 y MongoDB 7.0.14 de pruebas:

| Verificación | Resultado |
| --- | --- |
| Regresión completa de API | **108 pruebas aprobadas**, ninguna fallida u omitida; aproximadamente 189 segundos |
| Regresión completa de interfaz | **153 pruebas aprobadas en 34 suites** |
| Compilación | Correcta |
| Lint | Sin errores; seis advertencias heredadas de longitud de línea |
| Sintaxis de módulos añadidos y modificados, y `git diff --check` | Correctos |

La regresión conserva los lotes de 3.000 PDFs/envíos y la evaluación de 3.000 cartones. En la medición de extracción más snapshot HTTP local dio p95 de **45 ms**, máximo de **201 ms**, y **201 ms** para la detección con 3.000 empatados. Conserva las limitaciones de esa medición de la etapa 5: no incluye navegador remoto, transmisión ni un lote financiero masivo. La sensibilidad del evaluador puro con 10.000 cartones sintéticos y siete figuras dio aproximadamente 30 ms; no es una prueba del flujo completo.

Las pruebas de MongoDB/HTTP requieren permiso para puertos locales fuera del sandbox en este entorno. Dos repeticiones previas sufrieron timeouts o pausas prolongadas del monitor de MongoDB local. La corrida final secuencial pasó completa usando `caffeinate -i` en macOS para inhibir temporalmente la suspensión por inactividad, asociado al proceso de pruebas y sin cambiar ajustes persistentes del equipo. No se aumentaron los límites de tiempo para ocultar esas interrupciones. También se completaron los datos de una prueba sintética para cumplir la validación adicional de evidencia de respuesta, sin relajar la validación del servidor.

Las pruebas de interfaz son automatizadas; todavía corresponde el ensayo manual del navegador y equipo operativo previsto en la etapa 8.

## Alcance pendiente

La etapa 8 debe ensayar con el equipo la aprobación financiera, referencias reales de cuenta/comprobante, tratamiento de agotamiento y reservas, recuperación de respaldo, operación de consola y carga acordada. Este desarrollo no habilita por sí solo el piloto ni confirma decisiones globales del brief. No se hicieron abonos o envíos reales y no se desplegó la aplicación.
