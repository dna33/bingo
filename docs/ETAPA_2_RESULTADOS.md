# Etapa 2: importación CSV y conciliación

Fecha: 16 de noviembre de 2026. Estado: implementada y verificada en su alcance. La emisión automática de cartones pertenece a la etapa 3; mientras falten cartones, el sistema impide cerrar la lista. No se habilitó un inicio de juego que omita esa conciliación.

## Qué se implementó

- Recepción del CSV, conservación de sus bytes originales y huella SHA-256, versión interna y referencia de la lista recibida de Polla.
- Previsualización antes de incorporar participantes, con número de línea física de origen, valores originales, estado, motivos y datos corregidos cuando existen.
- Detección de duplicados exactos normalizados, cambios de contacto para una identidad conocida y contactos compartidos entre personas.
- Resoluciones explícitas con referencia de Polla, operador, fecha e historial de decisiones. Se conserva el original y no se descartan silenciosamente las filas inválidas.
- Incorporación transaccional de una versión revisada, reimportación sin duplicar personas y conservación de los cartones existentes.
- Altas por lista y cambios explícitos de actividad respaldados por Polla. Que alguien no aparezca en un archivo nuevo no produce una baja automática.
- Reporte de conciliación, control de diferencias y cierre de lista condicionado a participantes, trazabilidad y cartones completos.
- Panel React en `back-office.html`, con acceso por roles, carga, previsualización paginada, resolución, incorporación, conciliación y descarga del original.

## Flujo de operación

1. Un administrador crea la edición. Un administrador o importador selecciona esa edición y carga el CSV, indicando la versión o referencia de Polla.
2. El sistema guarda el archivo aceptado y muestra las filas. Todavía no crea participantes ni cuentas de jugadores. Los formatos de archivo imposibles de interpretar se rechazan con un motivo antes de incorporarse al registro de importaciones.
3. El operador revisa las filas inválidas y con conflictos y registra las aclaraciones de Polla. Una fila repetida no requiere crear otra persona.
4. Una vez resueltas todas las filas, el operador incorpora la versión. Los participantes, enlaces de origen, historial de contactos, aprobación y auditoría se guardan en una misma transacción.
5. La conciliación compara la versión aprobada con todos los participantes activos y los cartones almacenados. Las diferencias permanecen visibles hasta resolverse expresamente.
6. El cierre exige una lista no vacía, sin diferencias pendientes y un cartón por participante. Cierra participantes y cartones, pero no pone por sí solo la edición en estado listo: la configuración y operación del juego corresponden a etapas posteriores.

La consola de importación no depende de poder consultar antes los usuarios del juego heredado. El CRUD anterior se conserva en `back-office.html?legacy=1`, limitado al administrador.

## CSV y validación

Se admiten CSV UTF-8 separados por comas, con encabezados `email` y `telefono`; `jugador_id` y `nombre` son opcionales. Se aceptan BOM UTF-8, saltos LF/CRLF, campos entre comillas, comas dentro de campos y comillas escapadas. Se conserva el número físico de línea inicial de cada registro, incluso con campos multilínea.

Los encabezados se recortan y comparan en minúsculas. Se rechazan encabezados desconocidos o repetidos, una tabla sin participantes, UTF-8 inválido y sintaxis de comillas ambigua. Las filas con distinta cantidad de columnas se conservan como inválidas; las filas vacías intermedias tampoco se eliminan silenciosamente.

Email se recorta y pasa a minúsculas para detectar duplicados; se aplica una validación de formato básico, sin comprobar entregabilidad ni identidad. Teléfono permanece como texto: se retiran espacios, puntos, guiones y paréntesis, y se exige `+`, código de país y entre 8 y 15 dígitos en total. No se convierten números ni se inventa un país. Nombre e identificador tienen límites de longitud y no admiten caracteres de control. Los casos que no cumplen quedan pendientes de aclaración, no fuera del evento por descarte automático.

El límite técnico por archivo es 5 MiB y 50.000 filas. Si se supera, se rechaza el lote completo: no se toma una muestra ni se eligen los primeros participantes. El cuerpo HTTP permite 8 MiB para transportar ese archivo en base64. Estos límites no acreditan rendimiento para 50.000 personas.

## Identidad, duplicados y correcciones

Un identificador externo estable tiene prioridad para relacionar la fila con una persona conocida. Si coincide pero cambian contactos o nombre informado, la fila requiere resolución. Sin identificador, un par normalizado de contactos inequívoco permite reconocer duplicados de importación; no se presenta como prueba de identidad civil.

Compartir solo un contacto, aportar un identificador nuevo sobre contactos existentes o tener una coincidencia ambigua no fusiona personas automáticamente. Las opciones de resolución son:

| Decisión | Efecto |
| --- | --- |
| `correct` | Sustituye los datos efectivos de la fila según la aclaración, conservando el original. La validación se vuelve a ejecutar. |
| `separate` | Confirma que corresponde a una persona distinta pese a compartir contactos. No permite duplicar un identificador externo que ya pertenece a otra persona. |
| `link` | Vincula expresamente con un participante existente de la misma edición; puede corregir sus contactos o adjuntar un identificador que aún no tenía. |
| `exclude` | Excluye la fila con respaldo de Polla y conserva su registro. No elimina ni da de baja automáticamente a una persona ya incorporada. |

Todas requieren `pollaReference`. Las correcciones de contacto conservan el identificador interno y el cartón. Si se necesita cambiar ambos contactos sin identificador estable, el operador debe aportar el vínculo explícito: el sistema no puede deducir que se trata de la misma persona.

Una fila repetida posterior tampoco puede revertir silenciosamente una corrección anterior del mismo identificador: ese desacuerdo vuelve a aparecer como conflicto. Si una resolución no elimina realmente la ambigüedad, la incorporación sigue bloqueada.

La referencia de Polla es evidencia registrada por el equipo; no hay integración que autentique automáticamente esa aclaración. El procedimiento sigue bajo responsabilidad de Fabuloso.

## Reimportación y versiones

El mismo contenido binario reutiliza la importación original, aunque se cargue otra vez. No se duplican filas, participantes, cartones ni trabajos de envío. Un archivo diferente crea una versión nueva y vuelve a comparar sus filas con los participantes existentes. El archivo, sus filas y sus decisiones quedan vinculados a la edición.

La incorporación de un archivo ya aplicado no vuelve a sobrescribir contactos ni cambia la versión aprobada actual. Una importación aplicada no admite cambiar sus resoluciones: las correcciones posteriores se realizan mediante una versión nueva. Una versión pendiente más antigua no puede incorporarse si ya hay una más reciente.

Las operaciones usan `expectedVersion`, clave de idempotencia y transacciones de la etapa 1. Reintentar el mismo comando devuelve su recibo; una versión obsoleta o contenido distinto con la misma clave se rechaza. La aplicación recalcula las coincidencias contra la base dentro de la transacción, no confía solamente en una previsualización antigua.

Las personas ausentes del archivo nuevo permanecen activas y aparecen como diferencias. Una baja o reactivación necesita un comando explícito con referencia de Polla. No se borra el participante ni su cartón. Reincorporar un participante inactivo requiere resolver expresamente su vínculo.

## Conciliación y cierre

El reporte registra edición, versión del archivo aprobado, referencia y fecha de recepción, filas, excluidas, duplicados resueltos, participantes únicos, activos y cartones emitidos. Señala:

- Filas aprobadas sin una incorporación resuelta.
- Personas de la lista aprobada que faltan o están inactivas.
- Personas activas que no aparecen en esa lista.
- Participantes sin cartón.
- Participantes cuyo origen no puede reconstruirse y cartones con referencias inconsistentes.
- Versiones más recientes todavía pendientes de incorporar.

Una nueva versión aprobada sustituye la referencia de conciliación; versiones anteriores pendientes quedan superadas y no pueden aplicarse después. Sus archivos y filas permanecen conservados. El reporte de una importación ya aplicada conserva sus estados históricos, sin reclasificarlos retroactivamente por cambios posteriores.

Después del cierre no se permiten nuevas importaciones, resoluciones, incorporaciones ni cambios de actividad. Las acciones también se bloquean cuando la edición sale de preparación. Un reintento de una operación ya confirmada recupera su recibo sin modificar la lista cerrada.

En esta etapa los casos de cierre exitoso se prueban con cartones sintéticos guardados mediante la infraestructura existente. El panel explica por qué una lista real sin cartones todavía no puede cerrarse; no genera cartones de reemplazo para saltarse esa condición.

## API y permisos

Prefijo `/bingo-api/pilot/editions/:editionId`. Se mantiene la autenticación de personal. Administrador e importador tienen `imports:read`, `imports:write` y `contacts:read`. El auditor puede consultar archivos, filas y reportes, pero no modificarlos. Operador y viewer no reciben acceso a los archivos personales por tener únicamente lectura de edición.

| Método y ruta | Función |
| --- | --- |
| `GET /imports` | Lista versiones; paginación `limit` y `offset`. |
| `POST /imports` | Recibe `filename`, `sourceReference`, `contentBase64` y `expectedVersion`. |
| `GET /imports/:id/preview` | Resumen y filas; paginación de 1 a 500 filas. |
| `GET /imports/:id/original` | Descarga autorizada de los bytes originales. |
| `POST /imports/:id/rows/:rowId/resolve` | Guarda `decision` y su historial. |
| `POST /imports/:id/apply` | Incorpora la versión revisada. |
| `GET /reconciliation` | Reporte consistente de la lista aprobada. |
| `POST /participants/:id/activity` | Cambia `active` con `pollaReference`. |
| `POST /participants/close` | Cierra únicamente si la conciliación está completa. |

Las mutaciones requieren `Idempotency-Key` y `expectedVersion`. Los identificadores de archivo, fila y participante se verifican dentro de la edición; no se puede vincular una persona de otra edición. Las consultas de originales, previsualizaciones y conciliación quedan auditadas. Los contactos, bytes del archivo y referencias libres no se copian al log de auditoría.

Los errores públicos ofrecen códigos acotados como `csv_headers`, `csv_utf8`, `import_unresolved`, `import_superseded`, `list_frozen` y `reconciliation_incomplete`; el panel los traduce a instrucciones sin mostrar errores de MongoDB ni datos privados.

## Verificación

Entorno: Node 22.16.0, npm 11.17.0 y MongoDB temporal 7.0.14 con replica set. No se agregaron dependencias al proyecto. Se utilizó un formateador aislado en `/tmp` para los archivos nuevos.

| Control | Resultado final |
| --- | --- |
| API y parser, `node --test --test-concurrency=1 api-tests/*.test.cjs` (`npm run test:api`) | **31 pruebas aprobadas**: 16 anteriores y 15 de etapa 2. |
| `npm test` | **28 suites y 126 pruebas aprobadas**, con cuatro pruebas nuevas del panel. |
| `npm run build` | Compilación correcta de las interfaces. |
| `npm run lint` | Cero errores; las mismas seis advertencias heredadas de longitud de línea. |
| `node --check` en los módulos nuevos de backend | Sin errores de sintaxis. |
| `git diff --check` | Sin errores de espacios. |

Se comprobó una importación de 3.000 participantes válidos, conservación exacta del archivo, reimportación, normalización, duplicados dentro del archivo y entre versiones, contactos compartidos, filas inválidas, correcciones, vínculo explícito, preservación de cartón, bajas respaldadas, exclusiones, versiones superadas, congelamiento y concurrencia. También permisos, descarga, accesos cruzados entre ediciones y mensajes de error. Las pruebas del panel cubren login independiente del CRUD antiguo, carga, bloqueo de filas inválidas, resolución con respaldo, restricciones por rol y foco en los errores.

Una repetición con archivos de integración en paralelo falló por timeout al arrancar las instancias temporales de MongoDB, antes de ejecutar los casos de base de datos. Se cambió `test:api` para ejecutar los archivos en serie; las pruebas internas de concurrencia siguen activas. La repetición final pasó completa en aproximadamente 109 segundos en este entorno, con tiempos de arranque variables. No se presenta ese tiempo como benchmark del importador.

No se realizó un recorrido visual manual en navegador ni una prueba de carga de 10.000 participantes o del motor en vivo. Los controles de interfaz se verificaron con React/Jest y la compilación, y el servidor con HTTP y MongoDB reales temporales.

## Límites y siguiente paso

RF-01, RF-02 y RF-03 cuentan con implementación y pruebas del flujo de importación. RF-03A cuenta con reporte y bloqueo efectivo ante diferencias; la emisión de un cartón por persona se completará en la etapa 3. PA-01 queda comprobada para incorporación de 3.000 participantes, todavía sin emisión automática. PA-15 a PA-17 tienen pruebas de conciliación y bloqueo, incluido cierre exitoso con cartones sintéticos.

No se crearon cuentas de jugadores ni se enviaron mensajes. No se modificó el brief, no se desplegó el sistema ni se cambiaron bases reales. Siguen pendientes las decisiones del piloto sobre generación, figuras y operación; el próximo trabajo es generar cartones persistentes y PDFs desde la lista conciliada.
