# T-03 — Adaptador de mensajería real

Implementado y verificado localmente el 18 de noviembre de 2026. La integración técnica de email y WhatsApp está disponible; T-03 sigue abierto hasta contar con credenciales reales, plantilla de WhatsApp aprobada por Meta, hosting HTTPS del webhook y las validaciones de proveedor P-01 a P-06 fuera de sandbox. No hubo envíos reales ni abonos en este trabajo.

## Qué se implementó

Hasta ahora toda la entrega pasaba por un único proveedor simulado (`bingo-api/pilot/mock-provider.js`). Se agregó un seam de selección de proveedor por canal (`bingo-api/pilot/provider-registry.js`), configurado por `bingo-api/config/provider.js`, que por defecto sigue resolviendo al proveedor simulado en ambos canales si no se configura nada nuevo. Con las variables adecuadas, cada canal puede usar en su lugar un adaptador real:

- **Email:** `bingo-api/pilot/providers/smtp-provider.js`, SMTP genérico vía `nodemailer` — no está atado a un proveedor concreto (sirve para SES, Postmark, Gmail, un relay propio, etc., mientras ofrezcan credenciales SMTP).
- **WhatsApp:** `bingo-api/pilot/providers/whatsapp-cloud-provider.js`, contra la API Cloud oficial de Meta directamente (REST + token vía `node-fetch`, sin un BSP intermediario como Twilio).

Ambos adaptadores implementan el mismo contrato `send(message, job)`/`lookup(job)` que ya usaba el simulador, y escriben un recibo local propio (`bingo-api/pilot/providers/provider-receipts.js`, colecciones `PilotSmtpReceipt`/`PilotWhatsAppReceipt`) de forma sincrónica dentro de `send()`, antes de retornar. Esto es necesario porque ni SMTP ni la API de Meta aceptan una clave de idempotencia propia del cliente ni ofrecen una consulta de estado por identificador arbitrario: sin ese recibo local, una caída entre el envío real y el registro en `deliveries.js` dejaría el trabajo en estado incierto para siempre.

## Modo sandbox (P-01)

Cada canal tiene su propia bandera de sandbox (`SMTP_SANDBOX_MODE`, `WHATSAPP_SANDBOX_MODE`), ambas en `true` por defecto:

- **SMTP en sandbox** usa el transporte `jsonTransport` de `nodemailer`: nunca abre un socket real, sin importar qué credenciales haya configuradas.
- **WhatsApp en sandbox** nunca llama a `fetch`: valida el mensaje, escribe un recibo sintético (`sandbox-<uuid>`) y retorna. No hay ninguna ruta de código hacia la red real salvo que se desactive explícitamente el sandbox de ese canal.

Esto cumple el requisito de P-01 de un modo de prueba que estructuralmente no puede alcanzar a participantes reales, no solo "en desarrollo no se llama a esto por casualidad".

## Limitaciones permanentes, no pendientes de "arreglar después"

- **SMTP real no puede confirmar `delivered` ni `bounced`.** El protocolo SMTP solo da una respuesta inmediata del relay (`250 OK` o un rechazo); `lookup()` únicamente puede devolver `provider_accepted`. Confirmar entrega o rebote real requeriría un buzón de rebotes (DSN) monitoreado o un webhook propietario del proveedor SMTP elegido — exactamente la integración específica de vendor que la elección de SMTP genérico buscó evitar. Queda fuera de alcance de T-03.
- **WhatsApp exige una plantilla pre-aprobada por Meta.** Como todo envío lo inicia Fabuloso (no el participante), no existe una ruta de mensaje libre: `send()` siempre usa `template`. El nombre/idioma de la plantilla y sus parámetros (`WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`) son un placeholder hasta que exista una plantilla real aprobada en la cuenta de WhatsApp Business de Fabuloso; la función que construye esos parámetros está aislada en el adaptador para poder ajustarla sin tocar el resto.
- El estado de entrega de WhatsApp (`delivered`/`read`/`failed`) solo llega por el webhook asíncrono de Meta (`bingo-api/pilot/whatsapp-webhook-routes.js`), nunca por consulta/polling — la Cloud API no ofrece esa consulta.

## Webhook de estado de WhatsApp

`GET /bingo-api/webhooks/whatsapp` responde al *handshake* de verificación de Meta (`hub.challenge` si `hub.verify_token` coincide). `POST /bingo-api/webhooks/whatsapp` verifica `X-Hub-Signature-256` (HMAC-SHA256 sobre el cuerpo crudo, comparación de tiempo constante) antes de actualizar el recibo correspondiente por `wamid`. Ambas rutas devuelven 404 de inmediato si `DELIVERY_WHATSAPP_PROVIDER` no es `meta_cloud_api`. El router se monta antes de `bodyParser.json()` en `server.js` para preservar los bytes exactos que firma Meta, y no pasa por autenticación de staff: la firma HMAC es la única credencial de Meta.

## Configuración

Ver el bloque nuevo, completamente opcional, en [.env.example](../.env.example). Sin esas variables, ambos canales siguen en `mock`/sandbox `true`, igual que antes de este trabajo. `bingo-api/config/provider.js` valida con el mismo estilo "fail-fast" que `bingo-api/config/runtime.js`: una configuración inválida impide el arranque del servidor y del worker de entregas (`scripts/delivery-worker.cjs`), sin imprimir credenciales.

## Estado por canal en las respuestas de la consola

`processBatch()`, `GET /bingo-api/pilot/editions/:editionId/deliveries/summary` y el detalle de contacto de un candidato ya no responden con un `simulationOnly`/`simulationOnlyDelivery` fijo en `true`. Ahora incluyen `providers: { email: { provider, sandbox }, whatsapp: { provider, sandbox } }`, calculado desde la configuración real vigente. El mensaje de arranque de `scripts/delivery-worker.cjs` también refleja ese estado por canal.

## Pruebas y resultados

Entorno: Node 22.23.5, MongoDB temporal 7.0.14.

| Comprobación | Resultado |
| --- | --- |
| `npm test` | 163 pruebas aprobadas en 35 suites, sin cambios respecto a antes de este trabajo |
| `npm run test:api` | 158 pruebas aprobadas, ninguna omitida (142 ya existentes + 16 nuevas de configuración, seam, adaptadores y webhook) |
| `npm run build` | Correcto |

Pruebas nuevas, todas sin red real: [`provider-config.test.cjs`](../api-tests/provider-config.test.cjs) (validación de configuración), [`provider-registry.test.cjs`](../api-tests/provider-registry.test.cjs) (selección de proveedor por canal, mock por defecto), [`smtp-provider.test.cjs`](../api-tests/smtp-provider.test.cjs) (sandbox con `jsonTransport`, idempotencia, validación de destinatario/adjunto, mapeo de errores con `createTransport` inyectado), [`whatsapp-cloud-provider.test.cjs`](../api-tests/whatsapp-cloud-provider.test.cjs) (sandbox sin llamadas de red, flujo de subida de media + plantilla con `fetch` inyectado, mapeo de errores de la Graph API) y [`whatsapp-webhook-routes.test.cjs`](../api-tests/whatsapp-webhook-routes.test.cjs) (handshake, verificación de firma, actualización de recibo, 404 cuando el canal no está en modo real). Ningún test existente de `deliveries.test.cjs` ni de `DeliveryPanel.test.js` cambió de comportamiento; la única modificación a un test existente fue actualizar la aserción del mensaje de arranque del worker en `deliveries.test.cjs` para reflejar el nuevo formato `providers`, consistente con el cambio deliberado de ese mensaje.

## Fuera de alcance de este trabajo

- El selector de escenarios simulados y el texto "Proveedor exclusivamente simulado" de `src/back-office/components/DeliveryPanel.js` no cambiaron: es una decisión de UI aparte que no bloquea el backend.
- Buzón de rebotes/DSN para SMTP real.
- Credenciales reales, aprobación de plantilla de Meta, hosting HTTPS de producción para el webhook.

## Cierre pendiente de T-03

1. Confirmar con Fabuloso el proveedor/cuenta remitente real para cada canal (P-01), incluyendo si se habilita email, WhatsApp o ambos para el piloto.
2. Obtener y aprobar en Meta la plantilla de WhatsApp Business que se usará para el primer contacto (nombre, idioma, parámetros exactos del cartón/edición).
3. Publicar el webhook de WhatsApp en un endpoint HTTPS accesible por Meta y registrar su URL/verify token en la cuenta de WhatsApp Business.
4. Confirmar con el proveedor SMTP elegido sus cuotas y ritmo de envío reales (P-03); la pausa de 100ms compartida en `deliveries.js` sigue siendo un mutex de base de datos, no una garantía de proveedor.
5. Decidir y, si corresponde, implementar un mecanismo de confirmación de entrega/rebote para SMTP (buzón de rebotes monitoreado o webhook propio del proveedor elegido) si Fabuloso necesita ese nivel de evidencia más allá de `provider_accepted`.
6. Custodia de credenciales, contacto de soporte, escalamiento y freno de emergencia de envíos (P-06) — responsabilidad operativa de Fabuloso, no resuelta por este código.
7. Validar en sandbox real del proveedor elegido (no solo con `fetch`/transportes inyectados) antes de cualquier envío a participantes reales.

## Referencias

- [Checklist de habilitación del piloto](CHECKLIST_HABILITACION_PILOTO.md).
- [Configuración de URLs y CORS (T-01)](T_01_CONFIGURACION_URLS_CORS.md), formato replicado aquí.
- [Resultados de la Etapa 4 (entrega simulada)](ETAPA_4_RESULTADOS.md).
