# Checklist final de habilitación del piloto

Preparado el 17 de noviembre de 2026. **Estado: ensayos técnicos locales completados; habilitación operativa pendiente.**

Este documento organiza los cierres que faltan. No ejecuta ni autoriza despliegue, envíos a participantes o abonos en polla.cl. Las verificaciones pendientes se preparan con datos ficticios, proveedor simulado o sandbox sin entrega real, y comprobantes ficticios. Si un punto requiere una validación real posterior, queda pendiente hasta una acción expresamente autorizada por separado.

## Cómo cerrar cada punto

Marcar una casilla únicamente al adjuntar evidencia y registrar nombre del responsable, revisor y fecha. Una prueba local no cierra por sí sola un punto del entorno final. Los responsables indicados son roles propuestos, no personas ya designadas.

| Dato del piloto | Completar |
| --- | --- |
| Edición y fecha/hora/zona del evento | Pendiente |
| Versión de código y compilación que se habilitaría | Pendiente |
| Entorno, URL de consola y API | Pendiente |
| Participantes y consolas simultáneas acordadas | Pendiente |
| Responsable técnico y suplente | Pendiente |
| Responsable operativo de Fabuloso y suplente | Pendiente |
| Proveedor/canal y contacto de soporte | Pendiente |
| Ubicación protegida de las evidencias y acta | Pendiente |

### Evidencia disponible, sin confundirla con aprobación

| Comprobación local | Resultado registrado | Fuente |
| --- | --- | --- |
| Regresión tras optimizar alertas | 113 pruebas API y 160 de interfaz aprobadas; compilación correcta; lint sin errores y seis advertencias heredadas | [Verificación](evidencias/alertas/verificacion.json) |
| Carga de 3.000 y 10.000 cartones | Dos consolas reales, 60 extracciones por volumen, PDFs y entregas simuladas; mismas semillas y empates que la referencia | [Comparación](OPTIMIZACION_ALERTAS_RESULTADOS.md) |
| Alertas persistentes | p95 principal de 107,6 ms / 195,1 ms; segunda consola de 996,3 ms / 996,5 ms para 3.000 / 10.000 cartones | [Muestras y alcance](evidencias/alertas/ensayo-optimizado.json) |
| Recuperación | 31 colecciones restauradas en otra réplica y otro proceso; plazos y PDFs conservados; procedimiento local de recuperación de 11,6 s | [Ensayo integral](ETAPA_8_RESULTADOS.md) |
| Contacto y premios | Plazos individuales, respuestas oportunas/tardías, empates, remanentes y siete pozos verificados con datos sintéticos | [Contacto](ETAPA_6_RESULTADOS.md), [premios](ETAPA_7_RESULTADOS.md) |

Estas cifras corresponden al equipo y red local documentados. No son un compromiso de rendimiento, entrega, recuperación o capacidad humana en el evento. No hubo envíos ni abonos reales.

## 1. Pendientes técnicos

Responsable de cierre: equipo técnico. Fabuloso acepta el entorno y alcance acordados.

- [ ] **T-01 — Acceso desde los equipos del evento.** Configurar y comprobar URL de consola/API, autenticación, transporte protegido y orígenes permitidos. **Avance técnico del 18/11/2026:** URLs públicas configurables sin recompilar bundles, lista CORS exacta y pruebas locales implementadas; ver [configuración, resultados y pendientes](T_01_CONFIGURACION_URLS_CORS.md). Faltan dominios definitivos, HTTPS/proxy y aceptación desde los equipos del evento. No dar por validado un acceso remoto por haber pasado el ensayo local. **Evidencia de cierre:** configuración de publicación y acceso desde los equipos acordados, con personal autorizado, responsable y revisor.
- [ ] **T-02 — Entorno e identificación de la versión.** Fijar versión de código, compilación y dependencias compatibles con el repo; configurar MongoDB con replica set o mongos, índices únicos, variables y secretos fuera de los reportes. Verificar arranque, salud y reinicio controlado. **Evidencia:** inventario y comprobación del entorno final, sin credenciales en el acta.
- [ ] **T-03 — Adaptador de mensajería real.** Implementar y probar en sandbox el adaptador del canal elegido con las validaciones P-01 a P-06. El repo utiliza hoy [un proveedor exclusivamente simulado](../bingo-api/pilot/mock-provider.js); credenciales o remitente habilitados no sustituyen la integración. Conservar destinatario individual, mismo PDF, estados, conciliación y claves de reintento. **Avance técnico del 18/11/2026:** adaptadores reales de email (SMTP genérico) y WhatsApp (API Cloud de Meta) implementados y probados en sandbox, con el proveedor simulado como opción por defecto; ver [implementación, limitaciones y pendientes](T_03_ADAPTADOR_MENSAJERIA_REAL.md). Faltan credenciales reales, plantilla de WhatsApp aprobada por Meta y hosting del webhook. **Evidencia de cierre:** revisión del adaptador y pruebas sin entregas reales; habilitación real separada, si corresponde.
- [ ] **T-04 — Usuarios y permisos del equipo.** Provisionar cuentas nominativas y suplentes con los permisos necesarios; comprobar denegaciones, revocación y consulta/exportación de contactos y cuentas. El equipo debe entrar a la consola oficial; el modo legacy no será fuente de números ni de premios. **Evidencia:** matriz de acceso y recorrido por rol.
- [ ] **T-05 — Reglas aprobadas compatibles con el software.** Aplicar y congelar la configuración que Fabuloso cierre en F-02 a F-06. Comprobar que cada combinación esté soportada; una política distinta exige implementación y nuevas pruebas antes de habilitarla. **Evidencia:** versión de configuración, referencia de aprobación y pruebas del caso elegido. El [borrador](../config/piloto.borrador.json) no equivale a reglas aprobadas.
- [ ] **T-06 — Conciliación de la edición.** Con la lista autorizada, comprobar participantes únicos, resolución de filas conflictivas, un cartón por persona, identidad de origen, PDFs disponibles y ausencia de omisiones o extras. Verificar bloqueo de inicio ante diferencias. **Evidencia:** conciliación final cerrada y hashes/identificadores de cartones y PDFs, bajo acceso protegido.
- [ ] **T-07 — Preparación de PDFs y cola.** Medir generación, encolado y capacidad de preparación del lote acordado. Preservar cartones al reimportar, reintentar o reenviar; demostrar aislamiento de destinatarios y recuperación de estados inciertos. **Evidencia:** lote ficticio trazado y cronograma que use los límites validados del proveedor, no el tiempo del adaptador simulado.
- [ ] **T-08 — Rendimiento en el entorno final.** Repetir medición desde confirmación hasta candidatos y alertas visibles con el volumen y número de consolas de F-01/F-07; objetivo p95 menor a dos segundos. Incluir segunda consola y registrar máximos, hardware, red y alcance. **Evidencia:** muestras reproducibles y aceptación del perfil. No reemplazarlo por tiempos HTTP o del evaluador puro ni crear sesiones masivas de jugadores como requisito.
- [ ] **T-09 — Navegador, sonido y reconexión.** Probar en los equipos operativos aviso visible, habilitación de audio, sonido inmediato/repetición, silencio local, reconocimiento compartido, historial, recarga y pérdida/recuperación de conexión. Escuchar el parlante y revisar suspensión de pestaña. **Evidencia:** ensayo humano firmado; Chrome headless no acredita el sonido físico.
- [ ] **T-10 — Respaldo y restauración del entorno elegido.** Acordar pérdida de datos tolerable (RPO), tiempo objetivo de recuperación (RTO), almacenamiento protegido, retención y custodia de secretos. Restaurar una copia en un destino aislado, preferentemente otro equipo, y comprobar índices, PDFs, recibos, presupuesto y plazos de contactos en curso. **Evidencia:** respaldo verificable y acta de recuperación con tiempos. La copia BSON local con escritores detenidos no acredita respaldo continuo o cloud.
- [ ] **T-11 — Recuperación e incidencias operativas.** Ensayar pausa, cambio de operador, operación con resultado incierto, contactos vencidos durante una caída y reapertura auditada cuando proceda. Si se reutilizan datos de etapas anteriores, conciliar premios sin libro y saldos de rondas abandonadas antes de operar. **Evidencia:** guion ejecutado con datos ficticios, resultado esperado y responsable de escalamiento.
- [ ] **T-12 — Regresión y reportes de la versión final.** Ejecutar pruebas y compilación después de los ajustes finales; revisar pendientes de PA-01 a PA-24 y exportar confirmados, adjudicados, pendientes de abono, abonados y descartados por separado. Verificar cuenta, monto, evidencia y neutralización de fórmulas CSV. **Evidencia:** resultados vinculados a la versión de T-02 y aceptación de los reportes por Fabuloso.

## 2. Decisiones y aprobaciones de Fabuloso

Responsable de cierre: dirección operativa de Fabuloso, con Polla cuando corresponda. Registrar la decisión elegida, no solo una firma genérica.

- [ ] **F-01 — Alcance del evento.** Confirmar edición, fecha/hora/zona, participantes, cantidad de cartones y volumen/concurrencia que debe sostener el entorno. Ratificar la experiencia PDF y YouTube, sin cuenta, login o activación del jugador en Bingo. **Evidencia:** ficha operativa del evento.
- [ ] **F-02 — Cartones y máscaras.** Aprobar rango de números, restricciones por columna y las siete máscaras exactas, incluido el centro libre y tratamiento de marcas exteriores. Las referencias del anexo no son aprobación gráfica definitiva. **Evidencia:** dibujos/matrices versionados y conformidad de Fabuloso.
- [ ] **F-03 — Partida y repetición de ganadores.** Elegir rondas independientes u operación simultánea, orden, extracción manual o digital y posibilidad de ganar varias figuras. Aceptar la revisión antes de confirmar una bolilla manual. La combinación simultánea sin repetición sigue bloqueada hasta definir e implementar prioridad entre figuras. **Evidencia:** opciones concretas y configuración congelada.
- [ ] **F-04 — Presupuesto, empate y residuos.** Ratificar seis pozos de $50.000 y una sola O de $100.000, máximo $400.000. Aprobar reparto entero y sorteo auditable de residuos, sin usar orden de contacto o conexión. Aceptar que una participación de $0 no crea abono pendiente ni consume una victoria monetaria. **Evidencia:** regla firmada y ejemplo de empate con pesos residuales.
- [ ] **F-05 — Contacto y minuto individual.** Aprobar que cada plazo de 60 segundos comience al registrar aviso exitoso, no al detectar o anunciar en video. Definir evidencia y procedimiento para recepción exacta en el límite, recepción oportuna registrada después, fallo del aviso y descarte tras revisar el canal. **Evidencia:** protocolo de contacto y responsables de revisión. No reiniciar el reloj al recuperar la partida.
- [ ] **F-06 — Continuación y saldo.** Elegir redistribución entre confirmados o redisputa de partes descartadas; si nadie responde, redisputar la figura o avanzar dejando saldo no asignado. Elegir pausa o continuación de extracción durante el contacto. Aprobar expresamente promoción del grupo completo de la primera extracción pendiente y cierre excepcional por agotamiento de elegibles; si se pide otra regla, resolver T-05 antes de operar. **Evidencia:** decisiones para cada caso y ejemplos del saldo que continúa.
- [ ] **F-07 — Equipo, suplentes y capacidad de contacto.** Designar dirección, operador principal/respaldo, coordinación de contactos, revisor de premios, responsable de abonos, infraestructura y auditoría. Probar cómo se contactará a todos los empatados, sin selección arbitraria. **Evidencia:** nombres, permisos, turnos, suplencias y capacidad acordada; un motor rápido no valida esa dotación.
- [ ] **F-08 — Cuenta de Polla y control del abono.** Definir quién valida la pertenencia de la cuenta y quién ejecuta el abono fuera de Bingo. Acordar evidencia, referencia individual única y revisión de monto completo. No inferir una cuenta verificada desde `jugador_id` ni desde quien presente una copia del PDF. No habilitar cambios de destino después de aprobar una propuesta. **Evidencia:** procedimiento validado con Polla y ejemplos ficticios de P-07.
- [ ] **F-09 — Fuente de participantes y calendario.** Designar quién entrega/corrige la lista oficial, cuándo se cierra y quién aprueba diferencias y preparación del lote. Un fallo de entrega no excluye al titular ni transfiere el premio. **Evidencia:** lista autorizada y calendario acordado con el proveedor.
- [ ] **F-10 — Información privada y conservación.** Definir quién consulta/exporta contactos, cuentas, comprobantes y respaldos, dónde se conservan y por cuánto tiempo. Asegurar que la transmisión no exponga la consola privada. **Evidencia:** responsables, ubicaciones protegidas y recorrido de la vista que se transmitirá.
- [ ] **F-11 — Ensayo humano y aceptación.** Ejecutar el [guion operativo](ETAPA_8_GUION_Y_RECUPERACION.md) con los responsables, datos ficticios y casos de pausa, empate, caída, respuesta tardía, remanentes y reportes. Definir quién pausa/cancela ante un bloqueo y cómo se informa al programa. **Evidencia:** acta con diferencias, cierres y decisión operativa.

## 3. Validaciones del proveedor y de Polla

Responsable de cierre: interlocutor del proveedor; Fabuloso y el equipo técnico verifican su aplicación al piloto. No asumir que un `delivered` del simulador demuestra entrega real.

- [ ] **P-01 — Canal, remitente y entorno habilitados.** Confirmar proveedor, email y/o WhatsApp elegidos, cuenta remitente, permisos/habilitación que correspondan y sandbox o mecanismo de prueba sin entrega a participantes. **Evidencia:** confirmación del proveedor, configuración y destino de pruebas. Si exige una prueba real para habilitar el canal, dejarla pendiente de autorización separada.
- [ ] **P-02 — PDF individual y destinatario.** Validar soporte y límites de tamaño/formato del PDF, destinatario individual sin copias a otros participantes y tratamiento de adjuntos o enlaces, si aplica. Asegurar que cualquier canal alternativo conserve persona y cartón. **Evidencia:** contrato del adaptador y resultados de sandbox.
- [ ] **P-03 — Capacidad y preparación del lote.** Confirmar cuotas, ritmo permitido, concurrencia, ventanas y condiciones aplicables al canal, tiempos de preparación y atención de contingencias. Contrastar 3.000/10.000 destinos con el calendario de F-09. **Evidencia:** límites vigentes suministrados por el proveedor y plan aceptado; no extrapolar el reloj virtual del laboratorio.
- [ ] **P-04 — Estados y comprobación de entrega.** Acordar qué significan aceptación, entrega, rebote, fallo y resultado incierto; cómo consultar/reconciliar estado y validar la autenticidad de los eventos recibidos. **Evidencia:** documentación y casos de sandbox. No equiparar aceptación con entrega o lectura.
- [ ] **P-05 — Reintentos e idempotencia.** Confirmar claves o mecanismo disponible, plazo de conservación, tratamiento de timeout después de aceptación, duplicación de eventos y reenvío explícito. No prometer entrega exactamente una vez sin respaldo del proveedor. **Evidencia:** resultados de fallo/reconciliación y correspondencia con T-03/T-07.
- [ ] **P-06 — Operación y soporte.** Acordar custodio de credenciales, contacto de soporte durante el evento, escalamiento, interrupción de envíos y canal alternativo cuando corresponda. **Evidencia:** responsables, instrucciones y referencias protegidas; no guardar secretos en este checklist.
- [ ] **P-07 — Referencias de cuenta y comprobante de Polla.** Validar con Polla cómo se identifica una cuenta y se acredita su pertenencia al participante de origen; qué referencia individual y evidencia permitirán registrar el abono externo. Ensayar con ejemplos ficticios el monto completo, fecha, duplicado y comprobante de lote individualizado. **Evidencia:** conformidad de Polla y del revisor de Fabuloso; sin abonos reales.
- [ ] **P-08 — Resolución de diferencias de abono.** Acordar cómo se consulta y resuelve fuera de Bingo un comprobante rechazado, destino incorrecto o diferencia de saldo, y quién registra la incidencia. El sistema conserva premios aprobados y constancias; no ofrece abonos parciales, redirección automática ni reversión desde este flujo. **Evidencia:** procedimiento conjunto con Polla y responsables de F-08.

## 4. Registro de cierres

Duplicar una fila por cada ID anterior. En «evidencia» registrar una referencia protegida, versión o acta; no contraseñas, tokens, contactos ni números de cuenta.

| ID | Decisión / resultado verificado | Responsable nominal | Evidencia / versión | Revisor | Fecha | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| Pendiente | Pendiente | Por designar | Pendiente | Por designar | Pendiente | Abierto |

Un «no aplica» necesita motivo, validación del revisor y correspondencia con el alcance elegido. No sustituye un bloqueo: por ejemplo, no permite usar mensajería real con el adaptador simulado o una modalidad de reglas que el motor no soporte.

## 5. Decisión final de habilitación

Mantener **NO HABILITADO** mientras exista un bloqueo abierto del alcance elegido, falten reglas firmadas, proveedor/adaptador válido, conciliación, recuperación del entorno o ensayo humano.

- [ ] Todos los puntos técnicos aplicables tienen evidencia aceptada y corresponden a la versión que se habilitaría.
- [ ] Fabuloso aprobó las opciones concretas y la configuración de la edición; las decisiones no se deducen de los supuestos del laboratorio.
- [ ] Proveedor y Polla completaron las validaciones aplicables; cualquier comprobación real requerida sigue pendiente hasta su autorización separada.
- [ ] Lista, cartones/PDFs, preparación, permisos, presupuesto, reportes y recuperación están conciliados para el evento.
- [ ] Responsables y suplentes completaron el ensayo y aceptaron los procedimientos de contacto, incidencias y recuperación.
- [ ] Se registró una decisión nominal de Fabuloso, con versión, alcance, fecha y condiciones.

| Acta de habilitación | Completar |
| --- | --- |
| Decisión | **Pendiente — NO HABILITADO** |
| Responsable autorizado de Fabuloso | Por designar |
| Responsable técnico / versión aceptada | Pendiente |
| Conformidad del proveedor y de Polla | Pendiente |
| Edición, fecha y alcance autorizado | Pendiente |
| Bloqueos o condiciones pendientes | Referenciar IDs abiertos |
| Fecha y referencia del acta | Pendiente |

Completar este documento no despliega la aplicación, envía PDFs ni abona premios. Esas acciones operativas requieren instrucciones expresas posteriores.

## Referencias

- [Plan de implementación](../PLAN_IMPLEMENTACION_PILOTO.md) y [brief de requisitos](../Brief_Codex_Factibilidad_Bingo_Fabuloso.md).
- [Configuración pendiente de confirmación](../config/piloto.borrador.json).
- [Ensayo integral y matriz PA-01 a PA-24](ETAPA_8_RESULTADOS.md).
- [Optimización de alertas y mediciones actuales](OPTIMIZACION_ALERTAS_RESULTADOS.md).
- [Guion del equipo y recuperación](ETAPA_8_GUION_Y_RECUPERACION.md).
- [Entrega simulada](ETAPA_4_RESULTADOS.md), [contacto](ETAPA_6_RESULTADOS.md) y [reparto/abonos registrados](ETAPA_7_RESULTADOS.md).
