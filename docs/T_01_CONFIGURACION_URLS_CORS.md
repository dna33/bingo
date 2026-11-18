# T-01 — URLs y orígenes del entorno

Implementado y verificado localmente el 18 de noviembre de 2026. La configuración técnica está disponible; T-01 sigue abierto para la aceptación del entorno final y de los equipos del evento. No hubo despliegue, envíos ni abonos reales.

## Configuración

Las variables se leen del entorno del proceso o de `.env`, sin sobrescribir variables ya definidas en el entorno. [.env.example](../.env.example) conserva los valores de desarrollo local.

| Variable | Significado | Valor cuando se omite |
| --- | --- | --- |
| `CONSOLE_URL` | URL absoluta del directorio público de la consola, sin `back-office.html`; admite subdirectorios | `http://localhost:8000` |
| `API_BASE_URL` | URL absoluta de la raíz pública de la API, incluido `/bingo-api` o el prefijo equivalente del proxy | `http://localhost:8888/bingo-api` |
| `CORS_ALLOWED_ORIGINS` | Orígenes exactos autorizados, separados por comas: protocolo, dominio y puerto, sin rutas | Origen de `CONSOLE_URL` |
| `HOST` | Dirección de escucha interna de Express | `127.0.0.1` |
| `PORT` | Puerto interno de Express | `8888` |

Ejemplo ilustrativo con dominios reservados, sin publicar ningún servicio:

```dotenv
CONSOLE_URL=https://consola.example.invalid/evento
API_BASE_URL=https://api.example.invalid/bingo-api
CORS_ALLOWED_ORIGINS=https://consola.example.invalid,https://soporte.example.invalid:8443
HOST=127.0.0.1
PORT=8888
```

La consola se abriría en `https://consola.example.invalid/evento/back-office.html`. Si ambas aplicaciones comparten dominio, configurar, por ejemplo, `CONSOLE_URL=https://evento.example.invalid/consola` y `API_BASE_URL=https://evento.example.invalid/bingo-api`. CORS contiene el origen `https://evento.example.invalid`, sin `/consola`.

Las URLs públicas no cambian las rutas internas: Express sigue atendiendo `/bingo-api` y `/health`. Si se usa un prefijo público adicional, el proxy debe quitarlo antes de pasar la petición a Express. `HOST=0.0.0.0` permite escuchar en todas las interfaces cuando la infraestructura lo requiera; cambiar la URL pública por sí solo no cambia dónde escucha el servidor. El servidor de desarrollo de Gulp sigue usando el puerto 8000.

## Archivo público y uso

`npm run build` genera `build/runtime-config.js` antes de compilar los tres bundles. Los HTML de consola, juego legacy y descubridor cargan ese archivo antes de su aplicación. Contiene únicamente:

```js
window.BINGO_CONFIG = {
  consoleUrl: 'https://consola.example.invalid/evento',
  apiBaseUrl: 'https://api.example.invalid/bingo-api'
};
```

Para preparar o cambiar la configuración pública sin recompilar los bundles:

```shell
nvm use
npm run config:client
```

El comando vuelve a leer las variables y reemplaza el archivo generado. Después de cambiar la configuración, hay que recargar la consola; las constantes se resuelven al iniciar la aplicación. El servidor debe reiniciarse para tomar cambios de CORS o dirección de escucha. No se ejecutó ningún reinicio del entorno final en este trabajo.

El cliente construye todas las rutas de API a partir de esa raíz: login, operaciones del piloto, descargas de PDFs y reportes, y endpoints legacy. `config.json`, usado por el juego legacy, se resuelve dentro de `CONSOLE_URL`; no contiene esta configuración de red. La raíz del piloto se define explícitamente y no se obtiene reemplazando texto dentro del dominio o prefijo del login.

El archivo generado no contiene `DB_URI`, `DB_SECRET`, la lista de CORS ni otras variables del proceso. No se añade ninguna dependencia. Si falta `BINGO_CONFIG` o es inválida, el cliente detiene su inicialización con un error; no intenta conectarse silenciosamente a localhost.

## Validación y CORS

- Se admiten URLs absolutas HTTP/HTTPS, normalizando barras finales. Se rechazan credenciales dentro de la URL, query, fragmentos, esquemas distintos y comodines. Una consola HTTPS exige API HTTPS para evitar contenido mixto.
- Una variable definida pero vacía es inválida. Los valores locales se usan solamente cuando las variables se omiten. Una configuración inválida impide el arranque antes de conectar MongoDB y falla también en la generación del archivo público; los mensajes del CLI no imprimen credenciales ni URLs sensibles.
- CORS compara orígenes exactos, sin comodines, subdominios implícitos ni confianza en el encabezado `Host`. El puerto y el protocolo forman parte del origen. Se eliminan duplicados y espacios de la lista; `null`, elementos vacíos o rutas son inválidos.
- Un origen autorizado recibe `Access-Control-Allow-Origin` con su valor exacto y `Vary: Origin`, también en errores de autenticación. Un origen no autorizado recibe 403 antes de ejecutar la operación, sin cabecera de autorización CORS.
- Los preflight válidos reciben 204 sin exigir JWT. Se permiten GET, HEAD, POST, PUT, DELETE y OPTIONS, con `Content-Type`, `Authorization` e `Idempotency-Key`; un método o encabezado solicitado no permitido recibe 403. La respuesta varía también por los encabezados de preflight.
- No se habilitan cookies mediante `Access-Control-Allow-Credentials`. Se conserva la autenticación Bearer y la autorización por permisos. Las peticiones sin `Origin`, como CLI o servicios, pueden llegar al servidor, pero siguen sujetas a autenticación y permisos; CORS no sustituye esos controles.

## Pruebas y resultados

Entorno: Node 22.16.0, MongoDB temporal 7.0.14 para la regresión y Chrome 157.0.8103.51 para el recorrido de navegador.

| Comprobación | Resultado |
| --- | --- |
| `npm test` | 163 pruebas aprobadas en 35 suites; incluye 3 nuevas de URLs del cliente |
| `npm run test:api` | 119 pruebas aprobadas, ninguna omitida; 195,5 s; incluye 6 nuevas de configuración/CORS |
| `npm run build` | Correcto; genera la configuración y los tres bundles |
| `npm run lint` | Sin errores; seis advertencias heredadas de longitud de línea |
| `node scripts/check-network-browser.cjs` | Consola compilada visible desde un subdirectorio, API en otro puerto, `/health` 200 y operaciones protegidas/login incompleto 401 legibles mediante CORS |
| `node scripts/check-stage6-browser.cjs` | Correcto con la nueva configuración: AudioContext activo, dos osciladores reales, repetición antes del reconocimiento, silencio posterior y cuenta regresiva visible; no acredita audibilidad física |
| `git diff --check` | Sin errores de espacios |

Las pruebas nuevas de [API/configuración](../api-tests/network.test.cjs) verifican valores locales y finales, subdirectorios, múltiples orígenes/puertos, normalización, entradas inválidas, arranque fallido sin filtración de secretos, orden de scripts HTML, regeneración sin tocar bundles, preflight, rechazo de orígenes y autenticación conservada. Las [pruebas del cliente](../front-end-tests/__tests__/api-network.test.js) comprueban login, raíz del piloto y endpoints configurados, despliegue bajo un mismo origen y bloqueo ante configuración ausente o inválida.

La regresión API se ejecutó con el mismo runner secuencial del script npm, anteponiendo `caffeinate -i` en macOS para evitar suspensión del equipo. Las suites conservan sus comprobaciones de permisos, idempotencia, cartones, entregas simuladas, partida, contactos, presupuesto y restauración; no se utilizaron datos ni proveedores reales. Se mantienen las advertencias heredadas de Sass, Browserslist y `act()` de React durante build/pruebas.

El ensayo adicional de Chrome es reproducible después de `npm run build`:

```shell
node scripts/check-network-browser.cjs
```

Requiere Chrome instalado; `CHROME_BIN` permite otra ruta. Arranca dos servidores HTTP exclusivamente en loopback y puertos temporales, usa el HTML y bundle reales de la consola y la configuración generada en un directorio temporal, y los cierra al terminar. El navegador hace preflight real con JSON, Authorization e Idempotency-Key. No conecta MongoDB ni crea cuentas, participantes, entregas o premios. El login incompleto y el token inválido se rechazan. HTTP local comprueba la integración, sin acreditar TLS ni dominios definitivos.

Los ensayos existentes de las etapas 6 y 8 ahora utilizan `BINGO_CONFIG` explícita. El laboratorio integral autoriza solamente el origen loopback que acaba de reservar; ya no altera la constante de login para redirigir el cliente. Este cambio de configuración no repite la medición integral de latencias de 3.000/10.000 cartones ni reemplaza sus evidencias anteriores.

## Cierre pendiente de T-01

1. Confirmar URLs definitivas y lista de orígenes con Fabuloso, incluyendo protocolo y puertos; configurar ambos procesos con valores coherentes.
2. Preparar el hosting y proxy con certificados HTTPS válidos. La API continúa sirviendo HTTP interno; este trabajo no instala TLS ni publica servicios.
3. Servir únicamente los HTML, assets públicos necesarios y `build/runtime-config.js`. El servidor Gulp sirve la raíz del repositorio para desarrollo y no debe usarse para publicar el repo ni exponer `.env`, respaldos o código del servidor.
4. Definir revalidación o `Cache-Control: no-store` para el archivo público y los HTML, y probar que un cambio de configuración no queda retenido por cachés. Es una responsabilidad del hosting elegido.
5. Desde los equipos acordados, validar login de personal autorizado, denegaciones por rol, preflight, descarga de PDFs/reportes y reconexión, bajo HTTPS y con la lista final de orígenes. Adjuntar evidencia y responsable/revisor al checklist.

No se marca T-01 completo con estas pruebas locales. Continúan pendientes el despliegue autorizado y la aceptación operativa; este cambio no habilita mensajería real ni abonos en polla.cl.
