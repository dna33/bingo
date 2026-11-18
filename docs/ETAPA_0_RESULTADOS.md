# Etapa 0: estabilización y resultados

Fecha: 16 de noviembre de 2026. Estado: base técnica verificada para continuar a la etapa 1. Las decisiones del evento siguen pendientes; el repo todavía no implementa el piloto.

## Entorno reproducible

| Elemento | Versión comprobada |
| --- | --- |
| Plataforma | macOS, ARM64 |
| Node | 22.16.0, fijada en `.nvmrc` |
| npm | 11.17.0 |
| Express | 4.22.0 |
| Mongoose | 8.9.5 |
| MongoDB para pruebas | 7.0.14, instancia temporal real |
| Jest CLI / entorno DOM | 29.6.1 / 29.7.0 |
| Sass | 1.83.4 |
| dotenv | 16.6.1 |

El equipo tenía Node 26.4.0 y no tenía `mongod` en PATH. Node 26 falla al cargar la dependencia transitiva `buffer-equal-constant-time` de JWT porque accede a `SlowBuffer.prototype`. Para esta etapa se fijó Node 22 en vez de introducir un parche de compatibilidad en dependencias. No se sustituyó el Node global: se descargó uno aislado en `/private/tmp/bingo-node22` para verificar. `package.json` limita el entorno soportado a Node 22 y el servidor explica el requisito al arrancar con otra versión. No se acreditan otros sistemas operativos o versiones de Node.

La instalación necesita acceso a npm si los paquetes no están en caché. La primera prueba de API necesita descargar MongoDB; las siguientes reutilizan su binario temporal. Los procesos de prueba necesitan permiso para escuchar en puertos locales. En este entorno se usó ejecución autorizada fuera del sandbox para red y puertos; los errores iniciales de DNS/permisos no eran defectos de la aplicación.

## Línea base observada

- No existían scripts npm para iniciar, compilar o ejecutar pruebas.
- `npm ci --ignore-scripts` pudo instalar el lockfile original al habilitar acceso al registro. El intento offline con una caché nueva falló por paquetes ausentes.
- Jest sin DOM: **20 suites fallidas, siete aprobadas; 70 pruebas fallidas y 49 aprobadas**.
- Al proporcionar DOM quedaron tres suites fallidas, con cuatro pruebas afectadas por `spyOn` global inexistente y expectativas sobre temporizadores que ya no son mocks en Jest moderno.
- El servidor falló con `SetOptionError` por `useCreateIndex`. La conexión usaba además opciones obsoletas y controladores con callbacks que Mongoose 8 no admite.
- Gulp no tenía una tarea de compilación aislada: mezclaba pruebas, watchers y servidor; varias tareas llamaban a `done()` antes de terminar. Faltaba configurar el compilador de `gulp-sass`.
- El generador heredado podía devolver menos de cinco números por columna y excluía el primero de cada rango. Las pruebas existentes dependían del azar.

## Cambios realizados

### Instalación y herramientas

Se añadieron scripts npm para build, desarrollo, pruebas separadas y conjuntas, lint y arranque. Express y Mongoose pasaron a dependencias de ejecución. Se añadieron Sass, el entorno jsdom de Jest y MongoDB temporal para integración. Se actualizó dotenv y el lockfile, sin efectuar una migración general de React, Express o Mongoose.

El procedimiento comprobado usa `npm ci --ignore-scripts`: instala el lockfile sin ejecutar scripts de paquetes. Las funciones usadas no requieren un compilador nativo ni esos scripts. MongoDB se descarga explícitamente al ejecutar la integración. La reinstalación final se verificó offline con la caché ya poblada: **1.679 paquetes instalados**.

### Compilación y desarrollo

Se separó `npm run build`, que termina, de `npm run dev`, que permanece observando cambios y sirviendo la interfaz. Las tareas esperan la escritura completa y propagan errores mediante streams/promesas. Se compilan las entradas SCSS principales para evitar concatenar también parciales por separado. Se mantienen los nombres de los recursos que referencian los HTML existentes y los alias `gulp fe` y `gulp bo`.

### API y base de datos

Se retiraron opciones obsoletas de conexión y se convirtieron consultas, conteos, borrados y guardados a promesas compatibles con Mongoose 8. Se añadió propagación de errores asíncronos hacia el middleware de Express 4, que ahora tiene la firma correcta de cuatro argumentos. Se conservó el campo `ok` que usa la consola para reconocer un borrado.

El servidor espera conexión antes de escuchar, ofrece `/health`, permite `PORT`, responde con JSON en errores de API y termina con código 1 si no puede iniciar. Se verificó apagado mediante SIGTERM. Las respuestas modificadas no devuelven hashes ni sales. `.env.example` diferencia la URI de MongoDB del secreto JWT y el README explica cómo arrancar.

Esto no implementa todavía los permisos de la etapa 1: las rutas heredadas siguen sin separar adecuadamente roles y propiedad de datos, y el registro de administradores sigue público. El servidor es una base de desarrollo local, no un servicio aprobado para exposición pública.

### Pruebas y generador

Se configuró jsdom y se ajustaron los spies a Jest actual. Dos pruebas que programaban aserciones sin esperarlas ahora comprueban la suscripción y los listeners de forma síncrona. No se deshabilitaron suites para obtener el resultado.

El muestreo de columnas ahora usa una baraja parcial sin reposición y completa el tamaño solicitado, incluyendo los extremos del rango. Se agregaron regresiones con azar constante en ambos extremos y tamaño imposible. Esto corrige el juego heredado; todavía no es el generador oficial del piloto: mantiene `Math.random`, no asigna cartones persistentes y no garantiza unicidad entre cartones.

Las cinco pruebas nuevas de API usan MongoDB real temporal, datos sintéticos y HTTP local. No se conectan a la base del usuario ni contactan personas.

## Resultados finales

Todos los comandos de esta tabla se ejecutaron con Node 22.16.0 y terminaron sin procesos de prueba pendientes.

| Comprobación | Resultado |
| --- | --- |
| `npm ci --ignore-scripts --offline` con caché poblada | Exit 0; instalación limpia completada. La variante inicial con acceso al registro también se ejecutó. |
| `npm test` | Exit 0; **27 suites, 122 pruebas aprobadas**. |
| `npm run test:api` | Exit 0; **cinco pruebas aprobadas**, aproximadamente seis segundos con binario descargado. |
| `npm run build` | Exit 0; tres bundles JavaScript y dos CSS, con sus mapas. Aproximadamente 1,7 segundos en este equipo. |
| `npm run lint` | Exit 0; cero errores y seis advertencias heredadas de longitud de línea. |
| Compilación con SCSS inválido temporal | Exit 1, como corresponde; se restauró el archivo y se recompiló correctamente. |
| Arranque real de `server.js` con MongoDB temporal | HTTP 200 en `/health`; apagado SIGTERM con exit 0. Incluido en la integración. |
| Arranque sin MongoDB disponible | Exit 1 tras el timeout de selección de servidor; no imprime el secreto JWT. Incluido en la integración. |
| Servidor de desarrollo Gulp | HTTP 200 para `/`, `/back-office.html`, `/config.json`, ambos bundles principales y ambos CSS. Se detuvo después del smoke test. |
| `git diff --check` | Sin errores de espacios. |

Cobertura de la integración: health, API inexistente, JWT ausente/inválido, registro y duplicados, login válido/inválido, perfil sin secretos, actualización persistente de saldo y victorias, login de administrador, listado, alta, edición y borrado, validación y recurso inexistente, arranque y apagado del proceso, y fallo de conexión.

La prueba de desarrollo verificó respuestas HTTP y recursos no vacíos; no sustituye un recorrido visual interactivo en navegador. No se realizó prueba de carga ni se demostró capacidad para 3.000 cartones.

## Repetición local

```shell
nvm install
nvm use
npm ci --ignore-scripts
npm run build
npm test
npm run test:api
npm run lint
```

Para ejecutar API e interfaz con una base propia, seguir el README: iniciar MongoDB, copiar `.env.example` a `.env` y abrir `npm start` y `npm run dev` en terminales separados. No hacen falta MongoDB global ni `.env` para `npm run test:api`: crea su base temporal y suministra su secreto sintético. La descarga del binario usa un directorio temporal y puede configurarse con `MONGOMS_DOWNLOAD_DIR`.

## Acuerdos y pendientes

`config/piloto.borrador.json` registra versión, responsable propuesto, condiciones ya definidas por el brief y decisiones todavía nulas. **No lo consume el juego heredado ni representa una aprobación de las reglas.**

Fabuloso debe confirmar universo y columnas, máscaras, rondas y orden, extracción, repetición de ganadores, redondeo, canal/proveedor, inicio y evidencia del minuto, destino de partes descartadas, continuación si nadie responde, pausa durante contactos y dotación. Fabuloso con el equipo técnico debe cerrar infraestructura, recuperación y conservación de datos. La tabla de decisiones del plan indica en qué etapa bloquea cada una.

Quedan para las siguientes etapas los modelos del piloto, permisos efectivos, importación y conciliación, cartones persistentes, PDFs, envío, partida oficial, alertas, respuesta en 60 segundos y contabilidad de premios. Persisten advertencias de dependencias antiguas, Sass/Bootstrap y Browserslist. Esta etapa no es una auditoría de seguridad ni una actualización exhaustiva de dependencias.

No se enviaron mensajes, pagaron premios ni desplegó el sistema. No se modificó el brief. El lockfile ya tenía cambios al iniciar: se actualizó con npm para las dependencias necesarias y se comprobó con una reinstalación limpia.
