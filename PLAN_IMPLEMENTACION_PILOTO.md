# Plan de implementación del piloto Bingo Fabuloso

Fecha: 16 de noviembre de 2026. Basado en `Brief_Codex_Factibilidad_Bingo_Fabuloso.md`, incluida la entrega obligatoria de PDF y la respuesta al aviso de premio en 60 segundos.

Este documento propone trabajo futuro: no acredita funcionalidades implementadas ni capacidad medida. Las etapas se cierran con evidencia verificable, no solo con pantallas terminadas. No se incluyen envíos reales ni despliegue como parte de esta planificación.

## Estado de avance

Etapa 0 ejecutada: instalación, compilación, pruebas y arranque verificados en Node 22.16.0. Ver [resultados y límites](docs/ETAPA_0_RESULTADOS.md). Reglas pendientes registradas en [configuración de borrador](config/piloto.borrador.json); no están aprobadas ni integradas al motor. Etapa 1 implementada y verificada en su alcance de infraestructura: ver [resultados](docs/ETAPA_1_RESULTADOS.md). Etapa 2 implementada: importación, previsualización, resolución y conciliación; ver [resultados](docs/ETAPA_2_RESULTADOS.md). Etapa 3 implementada: cartones y PDFs persistentes, emisión reanudable y recuperación verificada; ver [resultados](docs/ETAPA_3_RESULTADOS.md). El cierre ahora exige también PDFs disponibles. Etapa 4 implementada con proveedor exclusivamente simulado: cola persistente, estados, reconciliación y reenvíos; ver [resultados](docs/ETAPA_4_RESULTADOS.md). La integración real de mensajería sigue pendiente. Etapa 5 implementada: partida oficial, estados, rondas, extracción manual/digital y detección transaccional de candidatos y empates; ver [resultados](docs/ETAPA_5_RESULTADOS.md). Etapa 6 implementada: alertas persistentes, contacto auditado y plazos individuales de 60 segundos; ver [resultados](docs/ETAPA_6_RESULTADOS.md). Etapa 7 implementada: validación del reparto, contabilidad de los siete pozos, continuación, registro manual de abonos en cuentas de polla.cl y reportes; ver [resultados](docs/ETAPA_7_RESULTADOS.md). Etapa 8 ejecutada como ensayo técnico local: datos sintéticos, dos consolas reales con 3.000 y 10.000 cartones, restauración de respaldo y contraste del anexo; ver [resultados y pendientes](docs/ETAPA_8_RESULTADOS.md) y [guion operativo](docs/ETAPA_8_GUION_Y_RECUPERACION.md). La habilitación del evento sigue pendiente de Fabuloso, las reglas, el proveedor, la infraestructura y el ensayo humano. No se ejecutan abonos reales desde Bingo.

## 1. Resultado esperado y alcance

Fabuloso importa y concilia la lista completa de Polla, asigna un cartón permanente por persona y edición, genera su PDF y lo envía individualmente por un canal habilitado. Opera una partida oficial en el servidor, que evalúa todos los cartones, alerta sobre candidatos y administra contactos, respuestas, descartes y premios.

El jugador recibe el PDF y sigue YouTube, sin cuenta, login, activación ni reclamo manual de patrón. Copiar el PDF no transfiere el premio. Un fallo de entrega inicial no invalida el cartón. Completar una figura genera una candidatura; solo la respuesta oportuna permite confirmar el premio.

El piloto contempla 3.000 cartones y una consola interna; se medirá también un escenario de 10.000. No contempla compra, integración con Polla.cl, transmisión de video, plataforma interactiva para jugadores ni pagos bancarios. Email o WhatsApp son alternativas: basta un canal funcional para la entrega inicial.

## 2. Qué reutilizar y qué sustituir

| Componente actual | Acción propuesta | Motivo y evidencia |
| --- | --- | --- |
| Express y estructura de API | Reutilizar y ampliar | `server.js` y `bingo-api/routes/index.js` ofrecen una base de servidor, pero no endpoints de partidas, cartones o premios. |
| MongoDB y Mongoose | Conservar, ajustar compatibilidad y agregar modelos | `bingo-api/models/db.js` y los controladores usan opciones y APIs antiguas que deben validarse contra las dependencias instaladas. |
| Consola React | Reutilizar componentes aptos, construir flujos nuevos | `src/back-office/components/` contiene tablas, formularios y diálogos; hoy administra usuarios y saldos, no una edición. |
| Autenticación de administradores | Adaptar antes de exponer datos | Hay JWT, pero las rutas deben exigir identidad y permisos de personal. Revisar registro de administradores y separar credenciales de jugadores y operadores. |
| Modelo de usuarios | Crear participantes de edición separados | `bingo-api/models/users.js` exige email único y contiene contraseña, saldo y victorias. No representa contactos compartidos ni participantes sin cuenta. |
| Presentación de cartón | Aprovechar la referencia visual | `src/card/card.js` dibuja una grilla, pero mezcla DOM, clics y detección. El PDF necesita una representación independiente y fiel al dato central. |
| Generador de cartones | Sustituir su algoritmo; conservar el concepto de grilla | `src/utils/numbers-generator.js` excluye el primer número del rango y puede producir columnas incompletas. `src/card/card-numbers-generator.js` fija rangos por columna que aún no están acordados. |
| Extracción local | Sustituir por operación del servidor | `src/dauber/dauber.js` mantiene números en memoria del navegador y termina por cantidad de turnos; no constituye la partida oficial. |
| Detección local | Construir motor independiente | `src/card/card.js` depende de clics; `src/utils/winning-patterns.js` reconoce patrones distintos de las letras del piloto. |
| Pruebas existentes | Conservar las útiles y agregar pruebas de dominio e integración | `front-end-tests/` y `back-office-tests/` no demuestran importación, persistencia, empates ni respuesta en 60 segundos. |
| Compra, saldo y login del jugador | Dejar fuera del flujo del piloto | No deben condicionar emisión, participación o premio. |

## 3. Decisiones que deben cerrarse

Las alternativas pueden modelarse y probarse con datos sintéticos. Ningún supuesto de desarrollo se convierte automáticamente en regla del evento.

| Decisión | Responsable propuesto | Cuándo bloquea | Propuesta para evaluar |
| --- | --- | --- | --- |
| Universo de números y restricciones por columna | Fabuloso | Antes de emitir cartones definitivos | 1–75 sin restricciones si se quiere contrastar el modelo del anexo. |
| Máscaras definitivas de las siete letras | Fabuloso | Antes de congelar reglas | Renderizar y aprobar visualmente las del anexo. |
| Rondas independientes o figuras simultáneas | Fabuloso | Antes de cerrar el motor del piloto | Rondas independientes F, A, B, U, L, S, O si O debe cerrar. |
| Extracción física registrada o digital | Fabuloso y equipo técnico | Antes de completar la operación | Implementar una modalidad completa primero. |
| Posibilidad de ganar varias figuras | Fabuloso | Antes de congelar elegibilidad | No inferirla de los cálculos del anexo. |
| Redondeo de repartos | Fabuloso | Antes de adjudicar | Evaluar sorteo auditable de pesos residuales; máximo un peso de diferencia. |
| Canal, proveedor y canal alternativo de entrega | Fabuloso y equipo técnico | Antes del ensayo de envíos | Un canal habilitado con PDF; no exigir ambos. |
| Inicio exacto del minuto y evidencia del aviso | Fabuloso | Antes del ensayo de premios | Hora de envío del aviso confirmada por Fabuloso, nunca detección ni anuncio en YouTube. |
| Partes descartadas y pozo si nadie responde | Fabuloso | Antes de habilitar adjudicaciones | Elegir redistribución o nueva adjudicación y destino de fondos remanentes. |
| Pausa o continuidad durante contactos | Fabuloso | Antes de completar RF-17 | Pausar simplifica la operación; si continúa, conservar todos los candidatos posteriores. |
| Procedimiento y dotación para contactos simultáneos | Fabuloso | Antes del ensayo operativo | Contactar a todos sin selección arbitraria, con plazos individuales y evidencia. |
| Infraestructura, conservación de datos y recuperación | Fabuloso y equipo técnico | Antes del ensayo de carga y recuperación | Definir acceso restringido, respaldos y procedimiento de restauración. |

## 4. Etapas de implementación

### Etapa 0. Estabilizar la base y registrar acuerdos

**Reutilizar:** repositorio, servidor, consola y herramientas de pruebas existentes.

**Construir o adaptar:** instalación y arranque reproducibles; tareas de compilación y pruebas que terminen y reporten fallos correctamente; compatibilidad real de Mongoose, conexión y controladores. Documentar versiones del entorno y resultados de la línea base. Crear configuración versionada con las decisiones anteriores y marcar expresamente las pendientes. Evitar una migración general de frameworks si no es necesaria para operar.

**Cierre:** servidor conectado a una base de prueba, consola compilada y pruebas ejecutables; fallos previos registrados. Reglas del piloto identificadas y responsables asignados. No se afirma que las dependencias actuales sean operativas sin ejecutarlas.

### Etapa 1. Persistencia, permisos y trazabilidad

**Reutilizar:** Express, MongoDB y el acceso del personal, después de corregirlo.

**Construir:** modelos de edición, versión de importación y filas, participante, cartón, ronda, extracción, candidatura, adjudicación, intento de envío y evento de auditoría. Mantener participantes separados de cuentas de acceso. Restringir operaciones y proyecciones de datos; no devolver hashes, sales ni contactos a salidas públicas.

Definir índices únicos por edición/participante y edición/disposición del cartón; por ronda/número y ronda/secuencia; y por operación lógica de adjudicación. Serializar comandos de una partida y rechazar versiones obsoletas. Persistir extracción y resultados de forma atómica, o mediante un procesamiento recuperable que impida avanzar hasta completar la evaluación. Si se usan transacciones multidocumento, preparar MongoDB con la topología que las soporte.

**Cierre:** accesos indebidos rechazados, duplicados impedidos por la base y recuperación demostrada en una operación interrumpida. Cubrir RNF-03, RNF-04 y RNF-05 desde esta etapa y mantenerlos en las siguientes.

### Etapa 2. Importación y conciliación de participantes

**Reutilizar:** componentes de tabla y formularios de la consola.

**Construir:** carga CSV UTF-8, archivo original protegido, previsualización y validación de email/teléfono como texto; detección de duplicados y conflictos, resolución explícita y reporte de conciliación. Usar identificador externo cuando exista; en su ausencia, el par de contactos normalizados detecta duplicados exactos, sin atribuir identidad civil. Conservar cada fila y su resolución, incluso si tiene errores.

Implementar reimportación sin duplicar ni dar bajas implícitas; correcciones respaldadas por Polla antes del cierre y bloqueo de cambios silenciosos después. La edición solo puede quedar lista cuando todos los participantes únicos de la lista definitiva tengan cartón y no existan diferencias pendientes. Ese control se completa en la siguiente etapa.

**Cierre:** demostrar PA-01 a PA-03 y PA-15 a PA-17 conjuntamente con la emisión; ningún contacto compartido fusiona personas automáticamente.

### Etapa 3. Cartones permanentes y PDF individual

**Reutilizar:** referencia visual de la grilla y estilos aprovechables.

**Construir:** generador de servidor con aleatoriedad adecuada, 24 números distintos, centro libre y variante configurable. Generar cada cartón una sola vez, comprobar unicidad de la disposición y asignarlo a su participante. El centro debe ser un dato estructurado, no HTML.

Generar el PDF desde ese cartón guardado: edición, fecha y horario cuando existan, identificador, grilla e instrucciones de PDF/YouTube, detección automática y condición de respuesta al aviso. Almacenar referencia y huella del artefacto. Reenvíos y recuperaciones usan el mismo cartón. El identificador impreso no habilita consulta de datos privados.

**Cierre:** PA-04, PA-05, PA-08 y parte documental de PA-18 y PA-22. Comparar automáticamente las casillas del PDF con los datos del motor y revisar legibilidad en móvil e impresión. Probar que la generación siempre completa la grilla y respeta los rangos elegidos.

### Etapa 4. Entrega masiva trazable

**Reutilizar:** API y consola; no existe integración de envío que pueda darse por lista.

**Construir:** adaptador del canal elegido y cola persistente de trabajos con límites de envío, reintentos y reenvíos explícitos. Registrar destinatario, canal, PDF, intento, fecha y estados: pendiente, enviado al proveedor, entregado si hay confirmación, rebotado o fallido. Asociar referencias del proveedor y procesar sus eventos sin duplicarlos.

Evitar trabajos duplicados por reimportación o reintento de API. Si el proveedor deja un envío en resultado incierto, reconciliarlo antes de repetir ciegamente; no prometer entrega exactamente una vez sin soporte del proveedor. Mostrar pendientes e incidencias y permitir canal alternativo hacia la misma persona y cartón. Mantener la evaluación independiente de la cola.

**Dependencias:** proveedor habilitado, credenciales protegidas, remitente y capacidad acordados. Verificar WhatsApp con el proveedor si se elige ese canal.

**Cierre:** PA-16, PA-18 y PA-22 con proveedor simulado o entorno de pruebas: destinatarios aislados, adjunto correcto, reintentos controlados y fallos visibles. No enviar a participantes reales durante el desarrollo.

### Etapa 5. Partida oficial y evaluación automática

**Reutilizar:** consola y, opcionalmente, recursos visuales de bolillas.

**Construir:** estados preparación, listo, en juego, pausado y finalizado; configuración congelada; rondas y máscaras versionadas. Implementar la modalidad de extracción elegida, validación de estado/rango y registro de secuencia, hora y operador. Si es manual, mostrar el número antes de confirmarlo; si es digital, seleccionar sin reposición con aleatoriedad adecuada.

Después de cada extracción confirmada, evaluar todos los cartones y detectar juntos a quienes completen por primera vez cada figura activa. Las marcas fuera de la máscara no invalidan la figura. Guardar evidencia y avance; no usar clics, conexión del jugador ni tiempo del video. Si hay rondas independientes, conservar cartones y reiniciar bolillas y marcas, dejando satisfecho el centro.

**Cierre:** PA-06 a PA-11 con escenarios deterministas, dos operadores concurrentes y reinicios en distintos puntos de una extracción. No adjudicar al primer registro recorrido ni incorporar candidatos posteriores a un pozo ya adjudicado.

### Etapa 6. Alertas, contacto y respuesta en 60 segundos

**Reutilizar:** diálogos y componentes aptos de la consola; el temporizador local existente no será la fuente oficial.

**Construir:** alerta visible y sonora persistente por resultado, reconocimiento y consulta posterior sin duplicación. Mostrar evidencia y vínculo de envío de cada candidato. Separar estas alertas de incidencias técnicas y de entrega. No se requieren mensajes automáticos de premio: el personal puede contactar por el canal registrado y dejar evidencia en la consola.

Implementar estados detectado, contactando, esperando respuesta, confirmado por respuesta oportuna, descartado y entregado. Guardar `contacto_iniciado_en`, `vence_en`, `respuesta_recibida_en`, canal, destinatario, operador y evidencia. El servidor conserva el vencimiento; la consola solo muestra el tiempo restante. Un envío fallido no inicia un contacto válido. Cada empatado tiene su plazo individual.

Confirmación y descarte deben excluirse mutuamente y resistir reintentos. Permitir documentar una respuesta recibida a tiempo y registrada después, con evidencia y resolución auditada, sin aceptar como oportuna una respuesta realmente tardía. No cerrar irreversiblemente el reparto mientras existan respuestas oportunas pendientes de conciliar. Un reinicio conserva todos los plazos originales.

**Cierre:** PA-19 a PA-24, incluidos respuesta exacta en el límite, tardía, registrada después, fallo del aviso, varios vencimientos y caída durante la espera. Probar sonido y reconocimiento en el navegador operativo.

### Etapa 7. Reparto, continuación y reportes

**Reutilizar:** componentes de tabla; el contador histórico de victorias no sustituye adjudicaciones.

**Construir:** cálculo de los seis pozos de $50.000 y el de O de $100.000, reparto entre candidatos confirmables, redondeo acordado y destino explícito de partes descartadas. Aplicar RF-17 según configuración, incluyendo el caso sin respuestas y candidatos surgidos mientras se esperaba si las extracciones continúan.

Mantener contabilidad de monto disponible, asignado y entregado para evitar usar dos veces una parte del pozo; el máximo total es $400.000. Toda nueva adjudicación debe identificar qué saldo reutiliza y por qué. Registrar entregas manuales y exportar evidencia, contactos y montos de confirmados; exportar descartados por separado. No incluir descartados en premios pendientes de entrega.

**Cierre:** PA-07, PA-13, PA-20, PA-21 y PA-23 con todas las alternativas efectivamente habilitadas. Probar que el orden de procesamiento no cambia ganadores ni reparto y que ninguna secuencia supera el presupuesto.

### Etapa 8. Ensayo integral y habilitación del piloto

**Resultado del ensayo técnico local (17/11/2026):** ejecutado y documentado en [ETAPA_8_RESULTADOS.md](docs/ETAPA_8_RESULTADOS.md). Los p95 de consola quedaron bajo dos segundos en ambos volúmenes. La [optimización posterior de alertas](docs/OPTIMIZACION_ALERTAS_RESULTADOS.md) redujo el p95 principal de unos 1,99 s a 107,6 ms con 3.000 cartones y 195,1 ms con 10.000; la segunda consola quedó en unos 997 ms. La infraestructura final sigue pendiente de aceptación. Respaldo restaurado en otra réplica con plazos conservados. Esto no equivale a habilitación operativa; los pendientes y responsables por designar figuran en el informe y el guion.

**Construir:** conjunto reproducible de datos sintéticos, pruebas de carga, guion operativo y procedimiento de recuperación. Registrar entorno, volumen, concurrencia de operadores, metodología y resultados. Evaluar 3.000 y 10.000 cartones; medir p95 desde la confirmación del número hasta la actualización de ganadores en consola, con objetivo menor a 2 segundos bajo la carga acordada. No simular 3.000 sesiones de jugadores como requisito del piloto.

Ejecutar PA-01 a PA-24 de extremo a extremo, restaurar un respaldo y recuperar una partida con contactos en curso. Medir también tiempo de generación y envío del lote para preparar la edición con anticipación. Ensayar con el equipo quién opera, quién contacta y quién resuelve incidencias.

Reproducir por separado los cálculos del anexo y contrastar simulaciones del generador y motor elegidos, conservando semillas de simulación, máscaras y supuestos. Las probabilidades del anexo se refieren a candidatos: no presentar como probabilidad de cobrar sin modelar respuestas y RF-17. La simulación reproducible no implica usar semillas públicas o predecibles en la extracción del evento.

**Cierre:** informe de aceptación con evidencia por prueba, decisiones cerradas, capacidad medida, recuperación ensayada y responsables operativos. Fabuloso determina la habilitación del evento con esta evidencia. Los envíos reales y el despliegue se realizan posteriormente como acciones operativas explícitas.

## 5. Dependencias y orden de entrega

Ruta principal: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**. Las reglas se cierran antes de la etapa que las necesita. La integración del proveedor puede prepararse mientras se desarrolla el motor, pero el circuito completo se valida solo cuando PDF, participante y envío están vinculados.

Cada entrega debe incluir código, pruebas pertinentes, instrucciones de ejecución y una demostración con datos sintéticos. No se asignan fechas aún: primero deben conocerse la fecha del evento, disponibilidad del equipo, estado ejecutable de la base y habilitación del proveedor. Los principales riesgos de calendario son la integración de mensajes, la compatibilidad del entorno existente y la definición de RF-17.

## 6. Criterios para iniciar el evento

El [checklist final de habilitación](docs/CHECKLIST_HABILITACION_PILOTO.md) reúne los pendientes por responsable, las evidencias requeridas y el acta de decisión, sin autorizar envíos, abonos o despliegue.

- Lista definitiva conciliada: todos los participantes únicos tienen cartón; no hay personas ajenas ni conflictos pendientes.
- Reglas completas y congeladas, incluidas respuesta, continuación, descartes y reparto.
- PDFs fieles a los cartones; envíos individualizados trazados e incidencias gestionadas. No exigir lectura ni eliminar participantes por fallo de entrega.
- Autenticación y permisos efectivos en la consola; información privada protegida.
- Detección de empates, plazos individuales, presupuesto y reportes comprobados.
- Rendimiento y recuperación demostrados con el entorno acordado; personal entrenado y procedimiento de incidencias disponible.

Un circuito visual terminado no satisface estos criterios por sí solo. Los bloqueos deben quedar identificados y resueltos antes del inicio, sin sustituirlos por decisiones improvisadas durante la transmisión.
