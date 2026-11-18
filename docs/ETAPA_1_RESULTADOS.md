# Etapa 1: persistencia, permisos y trazabilidad

Fecha: 16 de noviembre de 2026. Se implementó la infraestructura de la etapa 1 sobre Express y Mongoose existentes. No se implementaron importación CSV, generación masiva, PDF, mensajes ni el motor de figuras del piloto.

## Componentes entregados

| Archivo o módulo | Función |
| --- | --- |
| `bingo-api/pilot/models.js` | Modelos e índices de edición, configuración histórica, importación y filas, participante, cartón, ronda, extracción, candidatura, adjudicación, envío, recibo de comando y auditoría. |
| `bingo-api/pilot/commands.js` | Ejecución transaccional, control de versión, idempotencia y auditoría sin payload arbitrario. |
| `bingo-api/pilot/persistence.js` | Creación y configuración de ediciones y frontera interna de persistencia de extracciones evaluadas. |
| `bingo-api/pilot/auth.js` y `permissions.js` | Identidad de personal consultada en la base y autorización por permisos. |
| `bingo-api/pilot/routes.js` | API privada de ediciones, lecturas acotadas, contactos, exportación base y auditoría. |
| `bingo-api/pilot/staff.js` y `scripts/provision-staff.cjs` | Provisión local explícita y auditada de cuentas del personal. |
| `api-tests/pilot.test.cjs` | Integración con MongoDB real temporal, incluyendo concurrencia e interrupción de proceso. |

### Datos e invariantes

Los participantes no son cuentas de acceso. Email y teléfono son campos privados y no tienen índice único: distintas personas pueden compartirlos. Su clave interna por edición, identificador externo cuando existe y fila de origen sí tienen restricciones de unicidad apropiadas. La resolución de identidad y la conciliación quedan para la etapa 2.

Los cartones tienen índices únicos por edición/participante, edición/disposición y código. La huella SHA-256 se calcula desde las casillas en el modelo, no se confía en un hash suministrado por el llamador. Se valida la grilla de 25 posiciones con 24 enteros positivos distintos y centro `null`; el universo específico se definirá después. La disposición, propietario y edición del cartón son inmutables. Los archivos originales de importación también se conservan con huella calculada desde sus bytes y sin selección por defecto.

Las rondas son únicas por edición/ordinal; las extracciones, por ronda/número y ronda/secuencia. También hay índices para versión de importación, fila dentro de una importación, candidatura por figura/cartón/ronda, operación de adjudicación y candidato adjudicado, intento de envío y clave de comando. Los modelos guardan vencimientos y respuesta de candidaturas, pero todavía no ejecutan la regla de 60 segundos ni RF-17.

MongoDB no proporciona claves foráneas: estos modelos no habilitan CRUD arbitrario sobre referencias. Las futuras etapas deben validar pertenencia y conciliación en servicios transaccionales. La frontera de extracción ya comprueba que ronda y cartones pertenezcan a la edición.

### Transacciones, concurrencia y recuperación

Todos los comandos mutantes del piloto implementados pasan por una transacción con confirmación `majority`. El comando lleva `expectedVersion` y una clave de idempotencia; el incremento condicional de versión de edición serializa las escrituras incluso entre procesos. No se utiliza un candado en memoria de Node.

El recibo persistido incluye actor, acción, huella del contenido y resultado. Repetir la misma operación devuelve ese resultado sin ejecutar de nuevo el trabajo; reutilizar la clave con otro contenido o actor produce conflicto. Un comando obsoleto se rechaza y no altera datos. Cada configuración aprobada como borrador de persistencia genera además una instantánea histórica; no se confunde ese almacenamiento con aprobar las reglas del evento.

`recordEvaluatedDraw` guarda extracción, todos sus candidatos, secuencia de ronda, versión de edición, recibo y auditoría en la misma transacción. Un fallo revierte el conjunto completo; otra extracción no puede avanzar sobre un estado parcialmente evaluado. **Es una frontera interna, sin endpoint público de extracción.** Exige un evaluador autoritativo; las pruebas usan uno sintético. El motor real, sus máscaras y reglas se implementan en la etapa 5. Ese evaluador no debe enviar mensajes ni realizar otros efectos externos dentro de una transacción, porque MongoDB puede repetir su callback.

No se inventó una regla de reparto ni una confirmación de premios: existen los modelos de adjudicación y contacto, pero sus transiciones y presupuesto se implementarán en las etapas 6 y 7.

### Permisos efectivos

Los tokens de personal y jugadores tienen distinto tipo y audiencia, con emisor y algoritmo verificados. Los tokens antiguos, que no tienen estas propiedades, dejan de aceptarse. Cada petición de personal consulta cuenta activa, versión de credencial y roles actuales en la base. Reprovisionar revoca tokens previos; desactivar o eliminar la cuenta deniega la siguiente petición. No se confía en roles enviados en el cuerpo o dentro del token.

| Rol | Alcance del piloto |
| --- | --- |
| `administrator` | Lectura, configuración, contactos, importación, operación, confirmación, exportación y auditoría. También CRUD heredado. |
| `operator` | Lectura, contactos, operación y confirmación. |
| `importer` | Lectura, contactos e importación. |
| `viewer` | Lectura sin datos de contacto. |
| `auditor` | Lectura, contactos, exportación y auditoría. |

Los permisos de importación, operación y confirmación están definidos para las etapas posteriores; no crean endpoints funcionales que aún no existen. El alcance actual de las cuentas es global a las ediciones, no una asignación por edición. Las respuestas de lectura general usan listas explícitas de campos y no incluyen nombres privados, email, teléfono, contraseña, hash o sal. Las consultas de contactos y exportaciones requieren permisos separados y quedan auditadas antes de responder.

Se cerró `POST /bingo-api/registerAdmin` (404), se restringió el CRUD heredado al personal con permiso administrativo y se limitó la modificación de perfiles de jugadores a su propia identidad. Las cuentas antiguas no reciben roles ni activación automáticamente. Las credenciales nuevas de personal usan scrypt y comparación de tiempo constante; el verificador antiguo se conserva para cuentas heredadas activadas expresamente. El flujo del piloto no usa cuentas de jugadores.

### Auditoría

Los eventos registran identificador, edición cuando aplica, actor, acción, recurso, fecha y versión o clave de comando cuando corresponda. Se registran creación/configuración de edición, extracciones persistidas, provisión y login del personal, consultas de contactos, exportaciones y lecturas/mutaciones administrativas heredadas. Las mutaciones implementadas y su evento se confirman en la misma transacción; los fallos no generan eventos falsos de éxito.

El esquema no admite un payload libre en auditoría: no se copian cuerpos HTTP, contactos, contraseñas, JWT ni archivos CSV. Los errores públicos de validación o índice se resumen sin devolver valores privados. Las consultas y exportaciones repetidas generan eventos de acceso separados, mientras los reintentos del mismo comando mutante no duplican su evento.

La API solo permite agregar o leer eventos; los métodos de edición y borrado habituales del modelo se bloquean. Esto es una garantía de aplicación, no un registro físicamente inalterable frente a administradores de MongoDB o código que use directamente colecciones. La segregación de credenciales de base, retención y copias de seguridad operativas siguen siendo decisiones de infraestructura. Las futuras funciones de importación, emisión, envío y adjudicación deben reutilizar esta frontera para mantener RNF-05.

## API disponible

Prefijo `/bingo-api/pilot`. Todas estas rutas exigen token de personal. Listados paginados: `limit` entre 1 y 500 (100 por defecto), `offset` no negativo; no aceptan filtros MongoDB arbitrarios.

| Método y ruta relativa | Permiso |
| --- | --- |
| `GET /me` | Cuenta activa; devuelve permisos efectivos. |
| `POST /editions` | `editions:configure` |
| `GET /editions` y `GET /editions/:id` | `editions:read` |
| `POST /editions/:id/configuration` | `editions:configure` |
| `GET /editions/:id/configurations` | `editions:read` |
| `GET /editions/:id/participants` y `/cards` | `participants:read` |
| `GET /editions/:id/participants/:participantId/contact` | `contacts:read` |
| `GET /editions/:id/exports/participants` | `exports:read` y `contacts:read` |
| `GET /editions/:id/audit` y `GET /audit` | `audit:read` |

La exportación base es JSON paginado de participantes para verificar separación de permisos; no es todavía el reporte de ganadores de la etapa 7. La consola React heredada sigue siendo CRUD; las pantallas operativas del piloto no se construyeron en esta etapa.

Para crear una edición se envían `editionId` (ObjectId generado por el cliente) y `name`. Reintentar con el mismo identificador, nombre y creador conserva la edición. Para configurar se envía el header `Idempotency-Key` (8–100 caracteres alfanuméricos, guion o guion bajo), `expectedVersion` y `rules`. Solo se admiten campos de borrador expresamente listados en `validateRules`; la configuración solo puede cambiar durante preparación. No hay endpoint que permita saltar a listo sin conciliación. No incluir contactos ni secretos en claves de comandos.

## Arranque y provisión local

Ahora se requiere MongoDB con soporte de transacciones: replica set o mongos. El arranque rechaza explícitamente standalone y espera la creación de índices; no ignora conflictos con datos existentes. No se borran datos para resolverlos. Un replica set local de un nodo sirve para desarrollo y pruebas; no acredita alta disponibilidad de producción.

Consultar el README y `.env.example` para iniciar `mongod --replSet bingo-rs`, inicializarlo con `mongosh` y usar una URI con `replicaSet=bingo-rs`. Después, con Node 22:

```shell
npm run staff:provision < /ruta/protegida/personal.json
npm start
```

Entrada de provisión, usando valores propios fuera del repositorio:

```json
{
  "email": "operador@example.invalid",
  "name": "Operador de prueba",
  "password": "reemplazar-por-clave-propia",
  "roles": ["operator"],
  "active": true
}
```

La contraseña entra por stdin, nunca por argumentos. El comando imprime solo el identificador de cuenta y registra el evento de provisión. Reprovisionar exige credenciales y roles explícitos y revoca sesiones anteriores. `active: false` desactiva la cuenta. Este es un procedimiento local con acceso privilegiado a la base, no un endpoint remoto ni un alta de participantes. No se provisionó personal real durante esta tarea.

## Verificación y resultados

Entorno: macOS ARM64, Node 22.16.0, npm 11.17.0, Mongoose 8.9.5, MongoDB 7.0.14. Se reutilizaron dependencias instaladas: no se agregaron paquetes. Las pruebas de API crean replica sets temporales independientes con datos sintéticos y los detienen al finalizar.

| Control | Resultado |
| --- | --- |
| Integración `node --test api-tests/*.test.cjs` (`npm run test:api`) | 16 pruebas aprobadas: cinco de la base y once de etapa 1. |
| `npm test` | 27 suites, 122 pruebas aprobadas. |
| `npm run build` | Compilación correcta de las interfaces; termina sin watchers. |
| `npm run lint` | Cero errores; seis advertencias heredadas de longitud de línea. |
| `node --check` sobre backend, scripts y pruebas de API | Sin errores de sintaxis. |
| `git diff --check` | Sin errores de espacios. |

Escenarios comprobados:

- Registro público sin elevación, separación de tokens, cuenta no autenticada, permisos por rol y rechazo de modificación de otra identidad.
- Provisión explícita de cuentas heredadas, revocación por cambio de credenciales, desactivación y eliminación.
- Proyecciones privadas, rechazo de acceso cruzado mediante referencias de otra edición, auditoría de contactos/exportaciones y paginación acotada.
- Creación y configuración HTTP con historial, congelamiento, reintentos, contenido incompatible y versión obsoleta.
- Dos comandos distintos sobre la misma versión: solo uno avanza; dos reintentos iguales devuelven el mismo resultado. Otra identidad no puede reutilizar su recibo.
- Duplicados de participantes, cartones, bolillas, secuencias, adjudicaciones, archivos, filas y envíos rechazados; contactos compartidos permitidos; cartón inmutable y vencimiento almacenado sin recalcularlo.
- Error del evaluador y fallo después de insertar el primer candidato: no quedan bolillas, resultados o versiones parciales.
- Proceso separado detenido con SIGKILL mientras mantiene una transacción de extracción abierta: no se ve estado parcial; el mismo comando puede reintentarse una vez que MongoDB aborta la transacción. Reconectar y reintentar después del commit devuelve el recibo original sin duplicar la extracción.
- Auditoría no editable/borrable mediante los métodos protegidos; comando fallido sin evento de éxito.
- Provisión por el CLI real mediante stdin: éxito sin imprimir secretos y entrada inválida sin cambios parciales.
- MongoDB standalone rechazado, arranque y apagado del servidor y salida con error cuando la base no está disponible.

La prueba de caída reduce temporalmente la vida máxima de transacciones a tres segundos **solo en su base efímera** para que la limpieza del proceso muerto sea reproducible y rápida. No cambia ese parámetro en bases del usuario.

## Cierre y límites

RNF-03 queda cubierto en los comandos de infraestructura implementados con transacciones, recibos y prueba de interrupción; no se afirma todavía recuperación de un juego completo con el motor futuro. RNF-04 tiene autenticación y autorización efectivas en las rutas disponibles. RNF-05 tiene infraestructura y eventos reales para esas operaciones; deberá ampliarse al incorporar las etapas siguientes.

No se ejecutaron pruebas de carga, envío de mensajes, pagos, despliegues ni migraciones sobre bases reales. No se cerraron las decisiones pendientes del brief ni se implementaron reglas de reparto o respuesta. La próxima etapa es importar y conciliar participantes utilizando estos modelos y permisos; antes de emitir cartones definitivos aún deben aprobarse universo, columnas y máscaras.
