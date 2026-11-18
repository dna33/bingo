# Etapa 3: cartones permanentes y PDF individual

Fecha: 16 de noviembre de 2026. Estado: implementada y verificada. La entrega por email o WhatsApp corresponde a la etapa 4; no se enviaron mensajes ni se cambió la configuración pendiente del brief.

## Resultado

Cada participante activo de una lista incorporada y conciliada puede recibir un cartón permanente por edición. Su identificador, titular, origen, disposición, variante y ficha de emisión quedan guardados antes de usar el documento. El PDF se produce desde ese mismo cartón y se confirma en la misma transacción. Descargarlo, reimportar participantes, cambiar contactos o abrir otra ronda no vuelve a sortear sus números.

Se conserva un PDF por cartón en MongoDB, con bytes, referencia de almacenamiento, versión de plantilla y huella SHA-256. No se depende de archivos temporales para las descargas ni de un proveedor de mensajes para generar los cartones.

Ejemplo sintético revisable: [carton-demostracion.pdf](examples/carton-demostracion.pdf). No pertenece a una edición operativa y no representa una asignación real.

## Configuración explícita y generación

No se aplica una variante por defecto. Un administrador confirma el rango, distribución y datos impresos, registrando la referencia del acuerdo. Se implementaron:

| Variante | Regla |
| --- | --- |
| `unrestricted` | 24 números distintos, muestreados uniformemente del rango confirmado y dispuestos por filas, con centro libre. |
| `american75` | B: 1–15, I: 16–30, N: 31–45, G: 46–60, O: 61–75; cada columna se muestrea sin reposición y el centro es libre. |

El rango debe contener al menos 24 números, comenzar en 1 o superior y terminar en 1000 o inferior. B/I/N/G/O exige exactamente 1–75. El límite de 1000 mantiene el formato de cuatro dígitos legible y acota el generador; no selecciona ni excluye participantes.

La generación usa `crypto.randomInt` y muestreo sin reposición. Los contactos, nombre o posición de procesamiento de la persona no influyen en el sorteo. No se reutiliza el generador de navegador del juego heredado.

La disposición completa se compara con las ya emitidas en la edición mediante su huella y se protege además por el índice único existente. Una colisión se vuelve a sortear hasta 100 veces. Si no se logra una disposición nueva, el lote falla sin guardar un cartón repetido ni un resultado parcial.

La configuración de números se refleja en `Edition.rules` y su historial. La ficha de cada cartón guarda la versión confirmada que se utilizó. Al terminar la primera emisión se bloquean variante, título y datos impresos; la ruta genérica de configuración tampoco permite cambiar o eliminar esos números a posteriori. Si se cambia el borrador de variante antes de emitir, se invalida su confirmación y debe confirmarse nuevamente.

Las variantes de las pruebas son supuestos sintéticos. Fabuloso aún debe acordar la variante definitiva y las demás reglas del evento; no se actualizaron esos pendientes como si hubieran sido aprobados.

## Persistencia y reanudación

La emisión requiere:

- Edición en preparación y lista todavía abierta.
- Configuración de cartones confirmada.
- Versión de importación aprobada, no vacía, sin versiones nuevas pendientes.
- Participantes activos exactamente conciliados con esa versión, sin conflictos de identidad ni referencias de origen inconsistentes.

No se exige tener los cartones completos para iniciar su generación; esa diferencia se resuelve precisamente con la emisión. Cada petición procesa entre 1 y 100 pendientes, 50 por defecto. Cartones, PDFs, eventos de emisión, versión de edición y recibo del comando se confirman juntos en la transacción de la etapa 1.

El índice por edición/participante impide una segunda asignación. Los recibos y el control de versión impiden duplicados por reintento o concurrencia. Al reanudar se buscan los pendientes actuales y se conservan los ya confirmados. Si falla la generación del segundo PDF, por ejemplo, tampoco queda persistido el primero de ese lote; los lotes anteriores permanecen confirmados.

No se borran cartones al corregir contactos ni al dar de baja a alguien. Una incorporación posterior a la lista recibe únicamente el cartón que le falta, con la misma variante bloqueada para la edición. Los cartones de personas inactivas siguen formando parte del historial y no liberan su disposición para reutilizarla.

Los registros manuales antiguos sin ficha de emisión se señalan como incidencia `card_legacy`: el sistema no inventa una ficha ni reemplaza sus números. El repo anterior no persistía los cartones del navegador; no se ejecutó una migración de datos reales.

## PDF y recuperación

La plantilla 1 produce una página A4 con texto seleccionable, grilla de 5 × 5 y centro `LIBRE` diferenciado. Incluye edición e identificador de cartón, fecha/hora cuando estén definidos y zona horaria. Si faltan, indica «por confirmar»; esas fechas no se rellenan después modificando documentos ya emitidos.

Las instrucciones explican PDF y YouTube, ausencia de registro/login/activación, detección automática, respuesta en 60 segundos al contacto por premio, centro libre y permanencia de la asignación al copiar o reenviar. No se fija en el PDF el inicio exacto del minuto, que sigue siendo una decisión pendiente de la etapa 6.

No se incluyen nombre del participante, email, teléfono, contraseña ni credencial de acceso. El código impreso sirve para trazabilidad y no habilita consulta de datos personales ni transfiere el premio.

Las fuentes PDF estándar soportan español y caracteres WinAnsi. El título se limita a 80 caracteres y rechaza explícitamente emojis o glifos no disponibles, en vez de perderlos silenciosamente. Puede especificarse un título latino de la edición sin cambiar su nombre interno. Los títulos largos se ajustan para no desbordar la página.

Una descarga devuelve los bytes almacenados y comprueba su huella contra la referencia del cartón. No genera un PDF nuevo por cada GET. Si falta el artefacto, una operación explícita de recuperación lo reconstruye desde la ficha inmutable y exige la misma huella. Con la plantilla y dependencias fijadas se verificó recuperación de bytes idénticos. Puede recuperarse después del cierre de lista porque no se cambia cartón, titular, números ni documento lógico.

Si el artefacto existe pero está corrupto, o una reconstrucción no coincide con la huella original, se devuelve `pdf_integrity`; no se sobrescribe la evidencia automáticamente. La restauración de una copia válida queda a cargo del procedimiento operativo. La plantilla y las dependencias fijadas deben conservarse para reproducir esta versión de documentos.

El reporte de conciliación ahora incluye `withoutPdfIds` y bloquea el cierre si falta la referencia de un PDF válido. El indicador de disponibilidad compara referencias y huellas registradas; la comprobación de los bytes completos se realiza al descargar o recuperar. El cierre no sustituye un procedimiento de verificación de respaldos.

## Consola y permisos

Se agregó la sección «Cartones permanentes y PDF» a la consola existente, siguiendo los controles y mensajes accesibles del panel de importación.

- El administrador confirma las reglas; los campos de rango y variante empiezan vacíos.
- Administrador e importador tienen `cards:issue` y pueden emitir pendientes o recuperar artefactos faltantes.
- La consola encadena lotes de 50 y muestra progreso. «Pausar tras este lote» conserva el último lote confirmado; reanudar continúa con su versión y los pendientes reales.
- El personal con `participants:read` puede listar los cartones y descargar sus PDFs, sin recibir datos de contacto en esa respuesta.
- El PDF se descarga con autenticación de personal, `application/pdf`, nombre de archivo seguro y política de caché privada sin almacenamiento. No se habilitó un portal del jugador ni acceso público mediante el código.

La variante bloqueada, fechas y cantidad de documentos se muestran para verificar la preparación del evento. Si un operador cambia la edición o se corta una petición, el estado confirmado sigue en el servidor y puede consultarse de nuevo; no se recupera desde memoria del navegador.

## API

Prefijo `/bingo-api/pilot/editions/:editionId`:

| Método y ruta | Permiso y efecto |
| --- | --- |
| `POST /card-settings` | `editions:configure`: confirma `settings`. |
| `GET /cards/summary` | `participants:read`: configuración pública al personal, conteos, pendientes y bloqueo. |
| `POST /cards/issue` | `cards:issue`: emite hasta `limit` pendientes. |
| `GET /cards` | `participants:read`: lista paginada, grilla y disponibilidad de PDF. |
| `GET /cards/:cardId/pdf` | `participants:read`: descarga almacenada, con `X-PDF-SHA256`. |
| `POST /cards/:cardId/pdf/recover` | `cards:issue`: reconstrucción controlada si falta el artefacto. |

Las mutaciones requieren `expectedVersion` e `Idempotency-Key`. El `cardId` se comprueba dentro de la edición y todas las rutas están detrás de autenticación de personal. Se auditan confirmación, emisión por cartón y lote, recuperación y descarga, sin copiar datos de contacto al log.

Ejemplo de `settings`, únicamente ilustrativo:

```json
{
  "minNumber": 1,
  "maxNumber": 75,
  "columnMode": "unrestricted",
  "title": "Una Mañana Fabulosa",
  "eventDate": "",
  "eventTime": "",
  "timeZone": "America/Santiago",
  "confirmationReference": "Referencia del acuerdo del equipo"
}
```

## Pruebas y evidencia

Entorno: macOS ARM64, Node 22.16.0, npm 11.17.0 y MongoDB temporal 7.0.14 con replica set. Se agregó `pdf-lib` 1.17.1 como dependencia de ejecución y `pdf-parse` 1.1.1 como lector independiente de pruebas; versiones fijadas en el lockfile. El lector solo procesa los documentos propios de las pruebas.

| Verificación | Resultado |
| --- | --- |
| Suite de API, generador y PDF (`npm run test:api`) | **48 pruebas aprobadas**, incluidas las 31 anteriores. |
| Interfaz (`npm test`) | **29 suites y 130 pruebas aprobadas**. |
| Compilación (`npm run build`) | Correcta; termina sin watchers. |
| Lint (`npm run lint`) | Cero errores y seis advertencias heredadas de longitud de línea. |
| Sintaxis de backend, scripts y pruebas (`node --check`) | Correcta. |
| `git diff --check` | Sin errores de espacios. |

Casos principales:

- Variantes válidas, extremos del rango y centro libre; configuraciones imposibles rechazadas.
- Colisiones forzadas: reintento y fallo acotado sin duplicados ni guardados parciales.
- Lectura independiente del PDF real: sus 25 casillas extraídas coinciden exactamente, en orden por filas, con el cartón almacenado; existe un único centro `LIBRE`.
- Documento A4 de una página, instrucciones requeridas, fechas, título largo dentro de límites y ausencia de contactos.
- Render repetido de la misma ficha con bytes idénticos.
- Lotes, concurrencia y reintentos: un cartón y un PDF por persona, con recibos durables y sin reemitir los ya completos.
- Error del renderizador después del primer guardado: rollback de todo ese lote y reintento exitoso.
- Reconexión a la base, apertura de una ronda nueva y recuperación de un artefacto eliminado: números, titular y bytes originales conservados; recuperación permitida después del cierre.
- Reimportación, corrección de contactos y alta adicional: se conservan los documentos originales y solo se emite el faltante.
- Corrupción de bytes detectada y no sobrescrita; permisos HTTP y referencias cruzadas entre ediciones rechazadas.
- **3.000 participantes: 3.000 disposiciones distintas y 3.000 PDFs almacenados**, mediante 30 lotes de hasta 100; se verificaron todas las huellas, rangos y asignaciones, y se pudo cerrar la lista.
- Interfaz: confirmación explícita, avance de versiones entre lotes, pausa y reanudación y descarga de documento guardado sin disparar emisión.

La suite completa de API terminó en aproximadamente 38 segundos en este equipo. El caso de 3.000 documentos, en su primera ejecución, tomó aproximadamente 13 segundos, incluyendo sus operaciones de preparación; no es un SLA ni una prueba de 3.000 conexiones o del motor en vivo.

La prueba de recuperación detectó y permitió corregir una incompatibilidad de Mongoose al hidratar un arreglo inmutable con su valor predeterminado. Se eliminó ese valor por defecto; las restricciones sobre las casillas permanecen activas y sus regresiones siguen pasando.

Se renderizó el ejemplo con Poppler y se inspeccionó visualmente: grilla, centro y textos caben en una página A4 con contraste claro. No se realizó una impresión física ni una prueba en un dispositivo móvil real; la grilla es ampliable y las instrucciones son texto seleccionable en un lector PDF. Persisten advertencias heredadas de Browserslist/Sass y de algunas pruebas React del CRUD antiguo, sin fallos de suites.

Para reproducir el ejemplo sin emitir un cartón ni abrir una base:

```shell
node scripts/preview-card.cjs /tmp/carton-demostracion.pdf
```

## Alcance de cierre y pendientes

RF-04 y RF-05 cuentan con emisión persistente, unicidad y recuperación comprobada. RF-06 queda implementado en su parte de generación del PDF; el envío y su registro se construirán en la etapa 4. PA-04, la conservación documental de PA-05, la parte PDF de PA-18 y la permanencia de asignación de PA-22 tienen pruebas. El tratamiento del centro en máscaras y el reinicio operativo de marcas se verificarán con el motor real de la etapa 5, sin confundir conservar el dato `null` con haber implementado ese motor.

No se habilitó un reparto, extracción oficial, contacto de premio, proveedor de mensajes ni pago. No se provisionaron cuentas reales ni se desplegó el sistema. La próxima etapa es la entrega masiva trazable, consumiendo estos mismos PDFs sin volver a generar cartones.
