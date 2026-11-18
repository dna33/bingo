# Documento de requisitos del sistema Bingo

Versión de trabajo: 16 de noviembre de 2026.

## 1. Objetivo y alcance

El sistema **Bingo** recibe una tabla de jugadores habilitados, con su email y teléfono, y cumple tres funciones principales:

1. Generar, asignar y enviar a cada jugador su cartón en un archivo PDF.
2. Ejecutar y controlar el bingo.
3. Detectar ganadores y empates en tiempo real, alertar al equipo de Fabuloso y conservar sus datos para contactarlos y gestionar sus premios.

**Polla entrega al equipo de Fabuloso la lista completa de jugadores que participan por la promoción: toda persona que juegue con el código FABULOSOPOLLA debe participar en el bingo de la edición correspondiente.** La lista no es una muestra ni una selección por sorteo. Polla identifica a los participantes de la promoción y entrega sus datos de contacto.

**Fabuloso es responsable de que su sistema Bingo cumpla estos requisitos y de que el bingo funcione correctamente.** Su equipo recibe la lista de Polla, incorpora a todos sus participantes, genera y asigna sus cartones, opera el juego e identifica a los ganadores en tiempo real. Esta distribución reemplaza cualquier planteamiento anterior en que Polla apareciera como operador del bingo.

Bingo no verifica compras, montos ni códigos promocionales: utiliza la lista entregada por Polla y no necesita integrarse con Polla.cl para cumplir su función principal. Fabuloso no debe exigir a las personas de esa lista una nueva compra, inscripción o conexión en vivo para incluirlas en el juego.

El primer caso de uso es un bingo remoto durante “Una Mañana Fabulosa”, transmitido por YouTube. Se dimensiona inicialmente para 3.000 jugadores. Los resultados dependen de los cartones y números oficiales registrados por Bingo, no del chat, de la marcación manual ni del retraso del video.

**Experiencia del piloto:** el jugador recibe su cartón PDF y sigue los números desde su casa mirando YouTube. Puede abrirlo en su teléfono o computador, o imprimirlo. No debe crear una cuenta, iniciar sesión, ingresar a una plataforma de Bingo, activar el cartón ni confirmar que está presente. La evaluación de su cartón ocurre automáticamente dentro del sistema de Fabuloso. No necesita detectar ni reclamar el patrón por iniciativa propia: el sistema lo detecta. Sin embargo, para confirmar el premio debe responder al contacto de Fabuloso dentro de un minuto. Si no responde dentro del plazo, pierde ese premio y el juego continúa.

## 2. Actores y límites

| Actor | Responsabilidad |
| --- | --- |
| Polla | Identificar a todas las personas que participan por la promoción y entregar a Fabuloso su lista con email y teléfono. Resolver aclaraciones o correcciones sobre esa lista. |
| Equipo de Fabuloso | Recibir y conciliar la lista, garantizar la incorporación de todos sus participantes y responder por el cumplimiento de los requisitos y el correcto funcionamiento del bingo. |
| Operador de Bingo, designado por Fabuloso | Importar jugadores, revisar cartones, iniciar y conducir el juego, consultar y confirmar resultados y gestionar incidencias. |
| Jugador | Recibir el PDF y seguir el bingo por YouTube, sin cuenta ni inicio de sesión en Bingo. |
| Sistema Bingo | Mantener cartones, juego y resultados consistentes y trazables. |

Fabuloso debe disponer del sistema, infraestructura, personal de operación, pruebas previas y procedimientos de recuperación necesarios. Si utiliza un proveedor tecnológico, Fabuloso conserva la responsabilidad por el funcionamiento del bingo frente a Polla. Polla no administra el motor, genera cartones ni opera las extracciones.

La compra de juegos, verificación de elegibilidad promocional, transmisión de YouTube y pago bancario de premios quedan fuera del sistema. La responsabilidad por financiar y pagar los premios se acordará separadamente; no se deduce de la responsabilidad de operar Bingo. El envío individual del cartón PDF es obligatorio para el piloto. El cartón se envía por email o WhatsApp, registrando el canal y destinatario utilizados. Un fallo de envío debe gestionarse sin eliminar el cartón ni detener su evaluación. La plataforma interactiva para jugadores queda fuera del alcance del piloto.

## 3. Entrada: tabla de jugadores

### RF-01. Importar jugadores

El sistema debe aceptar un archivo CSV UTF-8 con encabezados `email` y `telefono`. La importación XLSX puede agregarse posteriormente. Cada fila representa un jugador habilitado.

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `email` | Sí | Correo de contacto del jugador. |
| `telefono` | Sí | Teléfono con código de país. El importador debe tratarlo como texto. |
| `jugador_id` | No | Identificador estable entregado por Polla, si existe. |
| `nombre` | No | Nombre para facilitar la operación y comunicación. |

Si no se proporciona `jugador_id`, Bingo genera uno interno. Email y teléfono son medios de contacto, no una prueba de identidad civil.

### RF-02. Validar antes de incorporar

El sistema debe mostrar una previsualización con filas válidas, inválidas, duplicadas y con conflictos, indicando el motivo y la fila de origen. Debe validar campos obligatorios, formato de email y teléfono, preservando el archivo original para trazabilidad bajo acceso autorizado.

Una fila repetida no debe crear otro jugador o cartón. Si el identificador coincide pero cambian los contactos, o si varios jugadores comparten un contacto, debe solicitar resolución del operador antes de incorporarlos. No debe fusionar personas automáticamente por compartir un teléfono o email.

Cuando no exista identificador externo, el par de contactos normalizados sirve para detectar duplicados exactos de importación, sin presentarlo como una garantía de identidad. La edición debe registrar la versión de la tabla aprobada.

### RF-03. Reimportar sin duplicar

Reimportar el mismo archivo debe producir el mismo conjunto de jugadores y cartones. Antes del cierre de la lista de la edición, el operador puede aplicar correcciones y altas o bajas respaldadas por una versión o aclaración de Polla, dejando registro. No puede excluir jugadores por decisión propia. Una reimportación no debe eliminar automáticamente a quienes no aparecen en el nuevo archivo.

Después del cierre, el conjunto de jugadores y cartones queda congelado. Cualquier incidencia debe registrarse y resolverse expresamente, sin modificar silenciosamente una partida en curso.

### RF-03A. Garantizar la inclusión completa de la lista de Polla

Fabuloso debe conciliar los participantes únicos informados por Polla con los incorporados al sistema y con los cartones emitidos. Cada persona debe quedar vinculada a su fila de origen y cartón. El reporte de recepción debe registrar edición, versión del archivo, fecha de recepción, cantidad de filas, duplicados resueltos, participantes únicos y diferencias pendientes.

Un error de contacto, un conflicto de identidad o un fallo de envío no autoriza a descartar al participante silenciosamente. Fabuloso debe conservar el registro y gestionar con Polla la aclaración necesaria. El fallo de entrega de un mensaje no elimina un cartón válido ni su derecho a ganar.

La edición no debe pasar a estado listo si quedan participantes de la lista sin cartón o diferencias de identidad sin resolver. La conciliación debe demostrar que todos los participantes únicos de la lista definitiva de Polla están incluidos, sin jugadores agregados por fuera de esa lista. Si no se puede completar a tiempo, Fabuloso debe informar la incidencia y coordinar su resolución con Polla antes de iniciar.

Los 3.000 jugadores son una referencia de dimensionamiento, no un cupo para excluir personas. Si la lista supera esa cifra, Fabuloso debe asegurar la capacidad necesaria antes del inicio.

## 4. Función 1: generar cartones

### RF-04. Emitir un cartón por jugador y edición

Para la versión inicial se utiliza **un cartón por jugador por edición**. El sistema debe emitir cartones de 5 × 5 con **24 números distintos y una casilla central libre**, situada en fila 3, columna 3.

Cada cartón debe tener identificador único, propietario y edición. Su disposición completa de números no puede repetirse dentro de esa edición. La generación debe ser aleatoria y no favorecer jugadores. El rango de números y las restricciones por columna deben definirse antes de generar cartones; el modelo analítico del anexo supone 1–75 sin restricciones por columna, pero no impone esa variante al producto.

### RF-05. Mantener el cartón y su titular

Reabrir, descargar, reenviar o recuperar un cartón no debe modificar sus números ni emitir otro. La casilla libre siempre está marcada, no contiene número y permanece marcada después de reiniciar una ronda.

El único vínculo operativo entre el cartón y la persona es el registro central de a quién se envió ese cartón, basado en los contactos entregados por Polla. Debe guardar identificador del cartón, referencia a la fila de origen, email o número de WhatsApp destinatario, canal, fecha y estado de cada envío. El identificador interno permite trazabilidad, no crea una cuenta de jugador ni constituye otro mecanismo de identificación. Reenviar o copiar el PDF no modifica ese destinatario ni transfiere el premio. Fabuloso contacta a la persona mediante los contactos registrados, no mediante quien presente una copia del PDF. No se exige autenticación del jugador, contraseña, código de activación ni verificación de acceso al PDF. Los permisos y la autenticación se aplican exclusivamente a la consola del equipo de Fabuloso.

### RF-06. Generar y enviar el PDF a cada jugador

El sistema debe producir un PDF individual que contenga edición, fecha y horario cuando estén definidos, identificador del cartón, grilla 5 × 5 y centro libre. Debe incluir instrucciones breves para seguir el bingo por YouTube y explicar que el sistema detecta automáticamente a los ganadores. No debe exigir registro ni incluir una llamada obligatoria a iniciar sesión. El PDF debe ser legible en móvil y apto para imprimir.

Los números y la disposición del PDF deben coincidir exactamente con el cartón almacenado y evaluado por el motor. Los reenvíos deben conservar ese mismo cartón. El identificador impreso no es una credencial para acceder a contactos ni modificar datos.

Fabuloso debe poder realizar el envío masivo mediante mensajes individuales con el PDF adjunto por email o como documento por WhatsApp, según el canal elegido para cada destinatario. El sistema debe registrar destinatario, cartón, intento, fecha y estado: pendiente, enviado al proveedor, entregado cuando exista confirmación, rebotado o fallido. No confundir aceptación por el proveedor con recepción o lectura del mensaje. Debe permitir reintentos y reenvíos controlados, sin regenerar cartones ni revelar contactos de otros jugadores.

La implementación de WhatsApp debe verificar disponibilidad y habilitación con el proveedor. No es obligatorio enviar por ambos canales: basta uno, y si se usan ambos deben remitir al mismo cartón y persona. Ante fallos, Fabuloso revisa los pendientes y gestiona el canal alternativo disponible. No se exige confirmación de lectura o respuesta al envío inicial del cartón. Esta entrega inicial se distingue del contacto por premio, que sí exige respuesta dentro de 60 segundos.

## 5. Función 2: llevar a cabo el bingo

### RF-07. Configurar una edición

Antes del inicio, el operador debe definir y congelar:

- Tabla de jugadores y cartones asignados.
- Universo de números y modalidad de extracción.
- Figuras ganadoras, sus máscaras de casillas y sus premios.
- Modalidad de rondas, orden si corresponde y reglas de reinicio.
- Tratamiento de empates, redondeo y posibilidad de ganar varias figuras.

El sistema no debe permitir iniciar si falta una regla necesaria para adjudicar premios. Las configuraciones deben quedar versionadas para poder reconstruir los resultados.

### RF-08. Usar figuras configurables

Cada figura se representa como una máscara de casillas del cartón. Se completa cuando han salido todos los números de sus casillas exigidas; el centro libre cuenta como satisfecho si pertenece al dibujo. Otras casillas marcadas fuera de la figura no invalidan el resultado.

El sistema debe mostrar la figura activa y distinguir casillas acertadas y pendientes. Las máscaras de referencia del anexo necesitan validación visual antes de considerarse definitivas.

### RF-09. Controlar el estado del juego

El sistema debe ofrecer estados explícitos: preparación, listo, en juego, pausado y finalizado. Una edición solo pasa a listo después de validar configuración, cartones y conciliación completa con la lista definitiva de Polla. El inicio debe ser una acción expresa del operador.

Debe permitir iniciar, pausar, reanudar y finalizar; reiniciar marcas solo al abrir una nueva ronda según la configuración. Una pausa no borra cartones, números ni resultados.

### RF-10. Registrar números oficiales

Cada número debe quedar registrado con edición, ronda, secuencia, fecha/hora y origen u operador. Deben rechazarse números duplicados en la misma ronda, fuera del rango o ingresados en un estado no permitido.

La implementación debe definir si la extracción es digital o si el operador registra números de un bolillero físico. Debe admitir como mínimo una de estas modalidades de extremo a extremo para el piloto. Si es digital, usar un mecanismo aleatorio adecuado y sin reposición. Si es manual, mostrar claramente la entrada antes de confirmarla y registrar incidencias sin borrar el historial.

Dos acciones concurrentes o reintentos no deben generar una extracción duplicada. Ante reinicio del servidor, el sistema debe recuperar la misma secuencia y el mismo estado.

### RF-11. Separar el juego del video

La secuencia del servidor es la oficial. La transmisión de YouTube acompaña el juego, pero no determina cuándo gana alguien. Todos los cartones habilitados se evalúan, incluso si sus titulares están desconectados o no tienen la página abierta.

## 6. Función 3: identificar ganadores en tiempo real

### RF-12. Evaluar todos los cartones

Después de cada extracción confirmada, el sistema debe calcular el avance de todos los cartones para las figuras activas. Debe identificar el conjunto completo de quienes completan por primera vez una figura en esa extracción.

Completar la figura genera un resultado detectado y pendiente de respuesta, no un premio confirmado. No puede adjudicar el premio al primer registro procesado. Una vez adjudicado un pozo, quienes completen la figura en extracciones posteriores no se agregan como ganadores de ese pozo.

### RF-13. Mostrar resultados al operador

La consola privada debe mostrar:

| Información | Contenido mínimo |
| --- | --- |
| Juego | Edición, ronda, estado, figura activa, número actual y secuencia. |
| Avance | Cartones próximos a completar la figura y números faltantes. |
| Ganadores | Identificador de jugador y cartón, nombre si existe, email y teléfono. |
| Evidencia | Figura, máscara y versión, números del cartón y extracción que completó el patrón. |
| Premio | Pozo, cantidad de ganadores, importe de cada uno y estado de confirmación. |

Al detectar uno o más ganadores, el sistema debe emitir una alerta visible y sonora en la consola de Fabuloso, identificando la figura y el conjunto completo de ganadores. Debe permitir reconocer la alerta y consultarla después; un reintento no debe generar un premio o una alerta nueva duplicada. El avance de cartones puede consultarse sin emitir alertas por cada acierto: las alertas de juego se disparan cuando existe un ganador. Los errores técnicos y fallos de envío se muestran por separado como incidencias operativas. No se requieren notificaciones automáticas de aciertos o premios a los jugadores en este piloto. Cualquier salida pública para el programa debe excluir email, teléfono y otros datos privados.

### RF-14. Repartir empates

Quienes completen primero una figura con la misma bolilla quedan empatados para el reparto en partes iguales, sujeto a que respondan dentro del minuto. El tratamiento de las partes descartadas debe fijarse según RF-17. El sistema debe calcular y registrar cada parte antes de confirmar la adjudicación.

Si el pozo no se divide en pesos enteros, la política debe estar definida previamente. Propuesta pendiente de confirmación: asignar la parte entera a todos y distribuir los pesos residuales, uno por persona, mediante un sorteo uniforme y auditable entre los empatados. La diferencia máxima es un peso. No usar el orden de procesamiento o de conexión.

### RF-15. Confirmar y exportar

El operador debe poder revisar la evidencia y confirmar el premio de quienes respondan dentro del plazo, sin elegir arbitrariamente a un subconjunto de candidatos. La respuesta oportuna es requisito de confirmación. La confirmación y sus reintentos no deben duplicar adjudicaciones.

El sistema debe exportar un reporte de ganadores con contactos, cartón, figura, evidencia y monto asignado. Debe distinguir resultado detectado, confirmado y premio entregado; la entrega puede registrarse manualmente por el equipo. El pago se realiza fuera de Bingo.

### RF-16. Contacto en vivo y plazo de un minuto

Cuando el sistema detecta uno o más cartones que completan una figura, alerta al equipo de Fabuloso y muestra el registro de envío que los vincula con sus destinatarios. Fabuloso contacta a cada persona por el email o WhatsApp registrado para informarle que tiene un premio pendiente de confirmación y preguntarle si está presente.

Cada persona dispone de **60 segundos para responder**. El sistema debe mostrar un temporizador individual, registrar el contacto y permitir al operador marcar la respuesta recibida por el canal registrado. No requiere login, cuenta, formulario ni acceso a la plataforma del jugador.

Para implementar la regla se propone contar desde que Fabuloso confirma el envío del aviso de premio, no desde la detección de la figura ni desde su anuncio en YouTube. El instante de inicio debe quedar explícito en las reglas y ser confirmado antes del piloto. Un envío que falla técnicamente no debe registrarse como contacto realizado; se muestra como incidencia para el operador.

El sistema debe conservar `contacto_iniciado_en`, `vence_en`, `respuesta_recibida_en`, canal, destinatario, operador y resultado. La respuesta debe haberse recibido antes o en el vencimiento; si el operador la registra después, debe consignar su hora de recepción y evidencia. No debe convertir arbitrariamente una respuesta tardía en oportuna.

Estados mínimos: **detectado**, **contactando**, **esperando respuesta**, **confirmado por respuesta oportuna**, **descartado por falta de respuesta**, **entregado**. Confirmación y descarte deben ser mutuamente excluyentes, persistentes y seguros frente a reintentos. Un reinicio no reinicia el minuto.

**Si no responde dentro del minuto, “va al agua”: pierde ese premio.** Fabuloso continúa el bingo. La falta de respuesta no deja un premio reservado para reclamar después. El resultado y el intento de contacto quedan en el historial, pero no aparecen en la lista de premios por entregar. La pérdida se refiere a ese premio; no se presume la exclusión de la persona de todas las figuras posteriores.

El contacto posterior se utiliza únicamente para coordinar la entrega a quienes sí respondieron a tiempo, no para recuperar un premio descartado. El sistema debe permitir consultar y exportar ambos grupos por separado.

### RF-17. Continuación y empates con respuesta obligatoria

Todos los cartones que completan una figura en la misma extracción deben detectarse juntos; cada destinatario dispone de su propio minuto desde el contacto registrado. El operador no puede elegir arbitrariamente a quién contactar. Deben conservarse los resultados y plazos individuales.

La regla de reparto entre empatados permanece, pero antes del piloto debe definirse qué pasa con la parte de quienes no contestan: redistribuir entre quienes sí respondieron o mantenerla disponible para una nueva adjudicación. Si nadie responde, debe definirse si el pozo se vuelve a disputar en la misma figura o si se pasa a la siguiente, y qué ocurre con el monto no entregado. **“Seguir el juego” no especifica por sí solo cuál de esas alternativas se aplica.** El sistema debe exigir esa configuración y registrar el destino del dinero, sin inventar la decisión durante el evento.

También debe definirse si se pausa la extracción durante el minuto de contacto. Si continúa, el sistema debe preservar los candidatos surgidos en ese intervalo para aplicar la regla acordada, sin perderlos ni adjudicar dos veces el mismo pozo. El presupuesto máximo sigue siendo $400.000.

## 7. Configuración del caso Fabuloso

| Figura | Pozo CLP |
| --- | ---: |
| F | $50.000 |
| A | $50.000 |
| B | $50.000 |
| U | $50.000 |
| L | $50.000 |
| S | $50.000 |
| O, una sola figura | $100.000 |
| Total | $400.000 |

Son siete pozos, no necesariamente siete personas premiadas. La O reúne el premio mayor y no se repite.

La modalidad de juego sigue pendiente:

- **Rondas independientes:** conservar cartones, devolver todas las bolillas y reiniciar las marcas, manteniendo el centro libre. Permite dejar O para el final; orden propuesto F, A, B, U, L, S, O.
- **Una extracción con todas las figuras activas:** cada pozo se adjudica cuando alguien completa su figura. Varias figuras pueden adjudicarse en una extracción, y O no necesariamente sale al final.

La activación secuencial de figuras con marcas acumuladas requiere resolver expresamente las figuras ya completas al habilitarlas. No debe adoptarse por defecto. También falta confirmar si una persona puede ganar varias figuras. El anexo permite esa repetición para sus cálculos.

## 8. Requisitos no funcionales

| ID | Requisito verificable |
| --- | --- |
| RNF-01 | Procesar al menos 3.000 jugadores y cartones por edición. Medir además un escenario de 10.000 como sensibilidad. |
| RNF-02 | Objetivo inicial: actualización p95 de ganadores en la consola menor a 2 segundos desde la confirmación del número, bajo la carga acordada. La carga corresponde a 3.000 cartones evaluados y la consola de operadores; no se requieren 3.000 sesiones de jugadores, ya que estos siguen el programa por YouTube. No incluir latencia de YouTube. |
| RNF-03 | Recuperar cartones, números y resultados después de un reinicio, sin adjudicaciones duplicadas ni pérdida de eventos confirmados. |
| RNF-04 | Autenticación y permisos para el personal de Fabuloso en operación, importación, exportación y consulta de contactos. No existen cuentas ni sesiones de jugadores en el piloto. |
| RNF-05 | Historial auditable de importaciones, cambios de configuración, emisión, extracciones y adjudicaciones. No registrar secretos o credenciales en logs. |
| RNF-06 | PDF del cartón legible en móvil y al imprimir; consola interna clara para operar en vivo. |

Las metas de rendimiento deben comprobarse con infraestructura, carga y metodología documentadas; no constituyen capacidades demostradas del repositorio.

## 9. Pruebas de aceptación

| ID | Escenario | Resultado esperado |
| --- | --- | --- |
| PA-01 | Importar 3.000 jugadores válidos | Se incorporan 3.000 jugadores y se emite un cartón por persona. |
| PA-02 | Reimportar el mismo archivo | No aparecen jugadores, cartones o envíos duplicados. |
| PA-03 | Archivo con errores y contactos compartidos | Se identifican filas y motivos; no se fusionan personas silenciosamente. |
| PA-04 | Revisar cartones | 24 números distintos, centro libre, identificador, titular y ausencia de disposiciones completas duplicadas. |
| PA-05 | Reabrir un cartón y reiniciar ronda | Los números no cambian; el centro permanece marcado. |
| PA-06 | Completar una figura conocida | Se detecta al jugador en la extracción exacta, con evidencia y contactos en consola. |
| PA-07 | Varios cartones completan simultáneamente | Se detecta a todos y se reparte el pozo sin excederlo. |
| PA-08 | Marcas fuera de la figura o centro libre | El cómputo aplica correctamente la máscara y el centro libre. |
| PA-09 | Jugador sin cuenta ni sesión en Bingo | Recibe el PDF, su cartón se evalúa y puede ganar sin ingresar a ninguna plataforma. |
| PA-10 | Doble envío de una acción o concurrencia | No se duplica la extracción ni la adjudicación. |
| PA-11 | Caída y recuperación | La secuencia y los resultados se reconstruyen sin cambios. |
| PA-12 | Consultar con permisos insuficientes | Se deniega el acceso a contactos ajenos y funciones del operador. |
| PA-13 | Finalizar y exportar | Reporte de ganadores y reparto consistente con las evidencias y los siete pozos. |
| PA-14 | Prueba de carga | Se informa si se cumplen RNF-01 y RNF-02, con mediciones reproducibles. |
| PA-15 | Conciliar la lista definitiva de Polla | Cada participante único tiene cartón; no hay omisiones ni jugadores ajenos a la lista. |
| PA-16 | Registro con error o envío fallido | No se descarta a la persona; se registra y gestiona la incidencia. Un fallo de envío no invalida su cartón. |
| PA-17 | Intentar iniciar con participantes sin cartón | El sistema impide pasar a listo e informa las diferencias que Fabuloso debe resolver. |
| PA-18 | Generar y enviar PDFs | Cada PDF coincide con el cartón del motor, se adjunta individualmente al correo correcto y no requiere login. |
| PA-19 | Detectar ganador y reintentar procesamiento | Fabuloso recibe una alerta con todos los ganadores; no se duplican alerta ni adjudicación. |
| PA-20 | Candidato no responde dentro de 60 segundos | Queda descartado para ese premio, con evidencia del plazo; no aparece como premio pendiente de entrega. |
| PA-21 | Respuesta dentro del minuto | Se confirma el premio y se conserva evidencia del contacto, respuesta y entrega pendiente. |
| PA-22 | Copia o reenvío del PDF | El sistema mantiene como vínculo el destinatario registrado del envío original. |
| PA-23 | Varios candidatos y plazos distintos | Cada uno conserva su minuto y resultado; se aplica la regla configurada para las partes descartadas. |
| PA-24 | Reinicio durante el minuto o respuesta tardía | El plazo original no se reinicia; la respuesta tardía no confirma el premio. |

## 10. Uso de este documento con el repositorio

Este documento define los requisitos que debe cumplir el sistema Bingo del equipo de Fabuloso, bajo responsabilidad de Fabuloso. Codex debe inspeccionar el repositorio y producir una matriz de cumplimiento por requisito: existe, parcial o falta, con evidencia de archivos y pruebas. No debe confundir una interfaz con una operación completa.

Debe proponer las adaptaciones mínimas para cumplir las tres funciones principales, identificar dependencias y entregar un plan verificable. Puede crear pruebas locales con datos sintéticos. No debe enviar mensajes reales, pagar premios ni desplegar en producción durante esa evaluación.

Antes del piloto deben resolverse: rango de números y restricciones por columna, máscaras definitivas, modalidad de rondas y extracción, repetición de ganadores, redondeo, configuración del envío por email o WhatsApp, inicio exacto del minuto y continuación/reparto tras descartes según RF-17. La experiencia del jugador ya está definida: PDF y YouTube, sin registro ni login. La evaluación puede avanzar sin esas respuestas usando supuestos explícitos y configurables.

El anexo conserva el análisis probabilístico como referencia de diseño. No constituye una especificación de la variante de bingo ni sustituye las pruebas del motor real.

## Anexo A. Probabilidades preliminares para 3.000 participantes

### Alcance del cálculo

**Actualización de alcance:** las cifras de este anexo calculan completar figuras y resultar candidato, antes de aplicar la nueva regla de respuesta en 60 segundos. No estiman la probabilidad final de cobrar ni incluyen descartes o readjudicaciones. Es necesario conocer la probabilidad de respuesta y la regla RF-17 para calcular esos resultados.

Estos son cálculos combinatorios del diseño propuesto, no resultados observados en el repositorio ni una simulación del software. Fecha: 16 de noviembre de 2026. Se han utilizado estos supuestos:

- 3.000 personas con un cartón cada una, todas habilitadas durante la figura.
- Cartón 5 × 5 con 24 números distintos tomados uniformemente del 1 al 75 y asignados aleatoriamente a las casillas no centrales. Sin restricciones por columna. La casilla central es libre y está satisfecha desde el inicio.
- Cartones generados independientemente. Rechazar duplicados completos tiene un efecto despreciable para este volumen, pero el cálculo no incorpora ese condicionamiento.
- Bolillas uniformes, sin reposición dentro de una ronda. Todos los números exigidos por la figura deben salir; la casilla libre no exige bolilla; las marcas exteriores no invalidan la letra.
- El pozo se adjudica en la primera extracción en la que alguien completa esa figura. Todos los que la completan en esa extracción comparten el pozo.

**No trasladar estas cifras sin revisión a cartones convencionales con rangos por columna, otra ubicación o cantidad de casillas libres, otro número de bolillas, varias tarjetas por persona o figuras diferentes.** Una vez fijados los cartones reales, las probabilidades pueden diferir de este promedio sobre cartones aleatorios.

### Máscaras de referencia reproducibles

Las filas siguientes son datos de las máscaras, no una propuesta gráfica definitiva: `1` identifica una casilla necesaria, `0` una casilla no exigida. El centro sigue apareciendo como `1` cuando pertenece al dibujo, pero se descuenta del número de aciertos necesarios porque es libre. Cada cadena representa una fila de izquierda a derecha, y las cinco cadenas se ordenan de arriba abajo. Codex debe representarlas gráficamente y validar legibilidad.

```json
{
  "F": [
    "11111",
    "10000",
    "11110",
    "10000",
    "10000"
  ],
  "A": [
    "01110",
    "10001",
    "11111",
    "10001",
    "10001"
  ],
  "B": [
    "11110",
    "10001",
    "11110",
    "10001",
    "11110"
  ],
  "U": [
    "10001",
    "10001",
    "10001",
    "10001",
    "11111"
  ],
  "L": [
    "10000",
    "10000",
    "10000",
    "10000",
    "11111"
  ],
  "S": [
    "11111",
    "10000",
    "11111",
    "00001",
    "11111"
  ],
  "O": [
    "11111",
    "10001",
    "10001",
    "10001",
    "11111"
  ]
}
```

### ¿Cuándo habrá alguien que complete cada letra?

“Probabilidad a la bolilla 40” significa que **al menos una de las 3.000 personas** ya habría completado la figura al extraer 40 números desde cero. No es la probabilidad individual ni la de ganar exactamente en esa bolilla.

| Letra | Números exigidos (descontando centro libre) | A la bolilla 30 | A la bolilla 40 | A la bolilla 50 | Mediana de primera adjudicación | Percentiles 10–90 de la primera adjudicación |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| F | 11 | 3,29% | 75,74% | >99,99% | 38 bolillas | 33–42 bolillas |
| A | 13 | 0,28% | 24,81% | 99,98% | 43 bolillas | 38–46 bolillas |
| B | 15 | 0,02% | 5,16% | 94,83% | 47 bolillas | 42–50 bolillas |
| U | 13 | 0,28% | 24,81% | 99,98% | 43 bolillas | 38–46 bolillas |
| L | 9 | 28,95% | 99,86% | >99,99% | 33 bolillas | 27–37 bolillas |
| S | 16 | <0,01% | 2,18% | 82,24% | 48 bolillas | 44–51 bolillas |
| O | 16 | <0,01% | 2,18% | 82,24% | 48 bolillas | 44–51 bolillas |

Los percentiles describen variación entre partidas, no incertidumbre estadística de una muestra. Si se extraen los 75 números, todos completan todas las figuras: lo relevante para los premios es quién llega primero. S y O tienen las mismas probabilidades marginales en este modelo porque exigen 16 números cada una. A y U también coinciden, con 13 números; no son el mismo patrón ni necesariamente las ganan las mismas personas.

### Empates en la primera adjudicación

| Figura | Probabilidad de empate entre dos o más | Promedio de ganadores del pozo | Probabilidad individual de obtener una parte del pozo |
| --- | ---: | ---: | ---: |
| F | 14,4% | 1,174 | 0,0391% |
| A | 15,4% | 1,189 | 0,0396% |
| B | 16,5% | 1,208 | 0,0403% |
| U | 15,4% | 1,189 | 0,0396% |
| L | 13,6% | 1,162 | 0,0387% |
| S | 17,1% | 1,217 | 0,0406% |
| O | 17,1% | 1,217 | 0,0406% |

Las probabilidades individuales promedian cartones generados al azar y cuentan tanto ganar solo como compartir. No significan una garantía para un cartón fijo. Como referencia, ganar una parte de una figura se sitúa cerca de una posibilidad en 2.460–2.580 bajo estos supuestos.

El reparto resulta relevante: alrededor de **una de cada seis o siete rondas** tendría varios ganadores. No se debe inferir la probabilidad de empate en todo el programa multiplicando estas probabilidades como si las figuras fueran independientes.

En el escenario anterior sin descartes por falta de respuesta, y suponiendo que se distribuyen íntegramente todos los pozos, por simetría el importe esperado por persona es $50.000 / 3.000 = **$16,67 por figura ordinaria**, y $100.000 / 3.000 = **$33,33 para la O**. Sumando los siete pozos: **$133,33 por participante**. Este cálculo no incorpora la nueva condición de respuesta en un minuto. Es un promedio matemático del escenario sin descartes, no el premio habitual, la rentabilidad de la jugada de Polla ni una estimación de la probabilidad de ganar alguna de las siete figuras.

### Implicaciones para el programa

- La L se completa antes porque exige 9 números. La S exige 17 casillas, pero una es libre: necesita 16 números, igual que la O. F, A y B también se benefician del centro libre; U, L y O no lo incluyen en sus máscaras y no cambian. **Un premio mayor para O no la convierte en la figura más difícil.** Si se quiere reservar el cierre para O, las rondas separadas permiten hacerlo.
- En siete rondas separadas, la suma de las extracciones medias es aproximadamente **297 bolillas**. A una bolilla cada 5 segundos son **24,7 minutos** de extracción; a una cada 8 segundos, **39,6 minutos**. Faltan presentaciones, pausas, validación y anuncios. Son estimaciones bajo ritmos propuestos, no duración comprometida.
- Con todas las figuras activas sobre una única extracción habrá menos bolillas totales, pero el orden y la duración conjunta deben simularse con sus dependencias. Los cálculos marginales anteriores no prueban que O sea la última ni permiten sumar tiempos para esa modalidad.

### Fórmulas y verificación para Codex

Sea `m` el número de casillas numeradas exigidas por la figura: cantidad de unos de su máscara menos uno si incluye el centro libre, `k` la cantidad de números extraídos y `N = 3000`.

- Probabilidad individual de haber completado al llegar a `k`: `F(k) = C(k,m) / C(75,m)` para `k >= m`; cero en otro caso.
- Probabilidad de al menos un cartón completo: `1 - (1 - F(k))^N`.
- Definir `d(k) = F(k) - F(k-1)`.
- Probabilidad de un único ganador en la primera adjudicación: suma para `k=1..75` de `N × d(k) × (1 - F(k))^(N-1)`.
- Probabilidad de empate en la primera adjudicación: uno menos esa suma.
- Número esperado de ganadores en la primera adjudicación: suma de `N × d(k) × (1 - F(k-1))^(N-1)`.
- Extracciones esperadas hasta el primer ganador: suma para `k=0..74` de `(1 - F(k))^N`.

La expresión con potencia N es válida aquí porque, condicionado a las bolillas extraídas, los cartones se generan independientemente y de forma uniforme, y la probabilidad de completar depende solo de k. No asumirla para otras reglas de generación ni para analizar conjuntamente distintas letras del mismo cartón.

Codex debe reproducir estos cálculos y contrastarlos con simulaciones del generador y motor reales, incluyendo las máscaras definitivas, las reglas de continuidad y el reparto de pesos residuales. Entregar código, semillas cuando corresponda, supuestos y resultados. Mantener separados los cálculos teóricos y la evidencia del repositorio.
