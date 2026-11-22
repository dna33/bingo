# Brief para Codex: reemitir el PDF de cartones ya emitidos con la plantilla de marca Fabuloso

Preparado el 21 de noviembre de 2026, a partir de una revisión en vivo del entorno local (commits `cf7f965` y `44bf0bb` en `origin/master`).

## 1. Qué pasó y por qué los boletos no salen con el diseño nuevo

Se rediseñó el PDF del cartón (`bingo-api/pilot/card-pdf.js`, `TEMPLATE_VERSION = 4`: tipografía Lilita One, paleta de marca, pie de página reubicado, texto de instrucciones reescrito) y, por separado, la identidad visual del back-office y del juego heredado (`index.html`). Ambos cambios están en el código y en `origin/master`.

El problema es que **la plantilla de un cartón se fija de forma inmutable al momento de emitirlo, no al momento de descargarlo o enviarlo**:

- Cada `Card` guarda un campo `presentation` (`bingo-api/pilot/models.js:80`, `immutable: true`) que incluye `templateVersion: TEMPLATE_VERSION` tomado en el instante de `issueBatch()` (`bingo-api/pilot/cards.js:198-206`).
- `renderCardPdf()` (`bingo-api/pilot/card-pdf.js:134-137`) exige que `presentation.templateVersion === TEMPLATE_VERSION` vigente; si no coincide, **lanza un error en vez de regenerar con la plantilla nueva**.
- `recoverPdf()` (`bingo-api/pilot/cards.js:248-262`) solo vuelve a renderizar cuando el PDF está físicamente perdido en MongoDB (no existe el documento `CardPdf`). Si el PDF ya existe —aunque sea de una plantilla vieja— lo deja intacto y lo sigue sirviendo tal cual.

Resultado observable: cualquier cartón emitido **antes** de este rediseño conserva para siempre su PDF con la plantilla anterior, y hoy no existe ninguna acción en el sistema para actualizarlo. Enviar o descargar ese cartón siempre entrega el diseño viejo.

Esto no afecta a cartones que se emitan de ahora en adelante (esos ya salen con `TEMPLATE_VERSION = 4`); el problema es específicamente con el stock ya emitido.

## 2. Objetivo de esta tarea

Agregar una forma explícita y auditable de volver a renderizar el PDF de un cartón ya emitido con la plantilla de marca vigente, **sin tocar los números del cartón ni los demás datos que garantizan su validez para el juego**.

## 3. Qué NO debe cambiar (garantías a preservar)

- `card.cells` (los 24 números + centro libre) nunca cambia. Es la identidad del cartón frente al participante y frente al motor de juego (`bingo-api/pilot/game-engine.js` evalúa sobre `cells`, no sobre el PDF). Cualquier implementación debe tocar solo el artefacto visual (`CardPdf`/`card.pdf`), nunca `cells`, `layoutHash` ni `generation`.
- El `sha256` del PDF se usa para verificar integridad en varios lugares (`pdf_integrity` en `cards.js`, reconciliación, comparación `card.pdf.sha256` vs `CardPdf.sha256`). Al regenerar hay que actualizar ese hash de forma consistente en **ambos** lugares, igual que hace hoy `storePdf()` al emitir por primera vez.
- Los datos impresos que sí pertenecen a `presentation` (`title`, `eventDate`, `eventTime`, `timeZone`) son los que el operador confirmó al configurar los cartones y están bloqueados por `card_settings_locked`. Esta tarea no reabre esa configuración: solo cambia la plantilla (`templateVersion`) manteniendo el resto de `presentation` igual.

## 4. Diseño propuesto

1. En `bingo-api/pilot/cards.js`, agregar una función `reissuePdf(command)` (ruta nueva, no modificar `recoverPdf` para no mezclar los dos casos de uso) que:
   - Cargue el cartón con `cardFor(edition._id, command.input.cardId, session)`.
   - Si `card.presentation.templateVersion === TEMPLATE_VERSION`, no hace nada y devuelve `{ cardId: card.id, version: edition.version, updated: false }`.
   - Si no coincide, renderiza el PDF con la plantilla actual reusando los mismos datos de `presentation` salvo `templateVersion` (que pasa a ser el vigente), recalcula el `sha256`, reemplaza el documento `CardPdf` existente (mismo `cardId`/`editionId`) y actualiza `card.pdf` con el nuevo hash.
   - El campo `presentation` está marcado `immutable: true` en el schema. Quitar esa marca únicamente si se agrega una guarda explícita en el código que impida cambiar cualquier campo de `presentation` que no sea `templateVersion` (nunca `title`, `eventDate`, `eventTime`, `timeZone`, `issuedAt`), para no debilitar la garantía de que los datos impresos quedan fijos al emitir.
   - Registrar un evento de auditoría distinto a `card.pdf_recovered` (por ejemplo `card.pdf_reissued`), para poder distinguir en el historial "se perdió el PDF y se reconstruyó" de "se volvió a generar el mismo cartón con una plantilla nueva".
2. Exponer una ruta nueva en `bingo-api/pilot/card-routes.js`, con el mismo patrón que `/cards/:cardId/pdf/recover` (permiso `cards:issue`), por ejemplo:
   ```
   POST /bingo-api/pilot/editions/:editionId/cards/:cardId/pdf/reissue
   ```
   Recordar actualizar también el regex de `router.use` al inicio del archivo (línea 10), que hoy solo deja pasar `pdf(?:\/recover)?$` — hay que agregar `reissue`.
3. En `bingo-api/pilot/routes.js:66-74` (`GET /editions/:editionId/cards`), incluir `presentation.templateVersion` en el `.select(...)` y devolver un campo `templateCurrent: card.presentation?.templateVersion === TEMPLATE_VERSION` junto a `pdfAvailable`, para que el back-office sepa qué cartones están desactualizados sin tener que adivinarlo.
4. En `src/back-office/components/CardPanel.js`, junto al botón "Descargar PDF {code}" de cada cartón (línea ~289-293), si `templateCurrent === false` mostrar un botón adicional "Actualizar al diseño vigente" que llame al endpoint nuevo (mismo patrón que el botón "Recuperar PDF" en líneas 296-309) y luego `refresh()` + `onChanged()`. Aclarar en el texto de ayuda que **no cambia los números del cartón, solo el diseño impreso** (coherente con el texto ya existente en la línea 266-269: "Descargar o recuperar el PDF mantiene sus números; no envía ningún mensaje").
5. Dado que una edición puede tener cientos o miles de cartones, agregar también una acción por lote (mismo patrón que `issueBatch`, con `limit`/`remaining`) para no obligar al operador a actualizar cartón por cartón: por ejemplo un botón "Actualizar todos los PDFs al diseño vigente" que procese hasta un límite por llamada e informe cuántos quedaron pendientes.

## 5. Decisiones que debe tomar el equipo de Fabuloso antes de implementar (no asumir)

- ¿Se permite reemitir el PDF visual de un cartón cuya entrega (`Delivery`) ya está en `delivered` o `provider_accepted`? Si sí: ¿hay que encolar automáticamente un nuevo envío, o el PDF actualizado solo queda disponible para descarga manual y un reenvío posterior lo decide el operador explícitamente?
- ¿Aplica en cualquier estado de la edición (`preparation`, `ready`, `playing`, `finished`), o solo antes de iniciar el juego? Como el cambio no toca `cells`, en principio es seguro en cualquier estado, pero conviene que quede confirmado explícitamente antes de habilitarlo en producción.
- ¿La actualización debe ser siempre una acción manual del operador (recomendado, con el mensaje aclaratorio de la sección 4.4), o se quiere además un aviso automático ("hay N cartones con diseño desactualizado") cuando se detecta que `TEMPLATE_VERSION` subió?

## 6. Pruebas a agregar

- `api-tests/cards.test.cjs`: cartón con `presentation.templateVersion` menor al vigente → reemitir cambia el hash del PDF pero conserva `cells` sin modificar; cartón ya al día → `updated: false` sin tocar nada; permisos (`cards:issue` requerido, igual que `recover`); se registra `card.pdf_reissued` en la auditoría.
- `back-office-tests/__tests__/CardPanel.test.js`: el botón "Actualizar al diseño vigente" solo aparece cuando `templateCurrent === false`; la llamada va al endpoint correcto; la lista se refresca después.

## 7. Verificación

- `npm test`, `npm run test:api` y `npm run lint` sin regresiones sobre lo existente.
- Prueba manual: tomar un cartón de una edición de prueba emitida antes del rediseño (hay varias en el entorno local, por ejemplo "Prueba Viernes" o "Bingo de prueba 3 cartones"), reemitir su PDF y confirmar visualmente que ahora usa Lilita One, la paleta de marca y el pie de página corregido, y que los 24 números impresos son idénticos a los que tenía antes.

## 8. Fuera de alcance de esta tarea

- Cambiar el contenido de `presentation` (título, fecha, hora, zona horaria): eso sigue siendo responsabilidad de la configuración de cartones ya existente (`card-settings`), no de esta reemisión.
- Tocar el motor de juego o la evaluación de ganadores: no se relaciona con `cells` en absoluto.
- Decidir reglas de reenvío automático tras actualizar el PDF (ver sección 5): se deja para que el equipo de Fabuloso lo resuelva antes de habilitarlo con participantes reales.

---

## Nota aparte: el estilo de marca en el back-office/juego sí está aplicado

Esto se investigó en vivo y **no es una tarea pendiente de código**. `src/back-office/` y `index.html` ya tienen la identidad Fabuloso aplicada (commit `44bf0bb`, en `origin/master`). Se verificó pidiendo la página con `fetch(location.href, { cache: 'no-store' })` y comparando contra lo que mostraba la pestaña abierta: el servidor entrega el HTML correcto (`<title>Bingo Fabuloso</title>`, estilos de marca), pero la pestaña ya abierta seguía mostrando una versión **cacheada por el navegador** de antes del cambio (`document.title` reportaba el título viejo "Welcome to Bingo Bigul" hasta forzar una recarga sin caché).

Antes de tratar esto como una tarea nueva para Codex: cerrar la pestaña y volver a abrir la consola/el juego, o forzar una recarga completa (Cmd/Ctrl+Shift+R), o probar en una ventana de incógnito. Si después de eso algo sigue sin verse con la marca Fabuloso, anotar la URL exacta, el entorno (local vs. un despliegue remoto) y una captura de pantalla — en ese caso sí habría algo nuevo que investigar, por ejemplo un despliegue que no se haya actualizado con los últimos commits.
