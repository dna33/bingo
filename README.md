# Bingo Bigul

Famous Bingo game built with [JavaScript](https://www.javascript.com/). It has a back office app built with [React](https://reactjs.org/) and uses [MongoDB](https://www.mongodb.com/) for database.

![Main login screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/main-login-screen.png)
![Lobby screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/lobby-screen.png)
![Start screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/start-screen.png)
![Game screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/game-screen.png)
![Back office login screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/back-office-login-screen.png)
![Back office screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/back-office-screen.png)
![Back office edit screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/back-office-edit-screen.png)
![Discoverer screen](https://github.com/mihailgaberov/bingo/blob/master/screenshots/discoverer-screen.png)

### Stargazers

[![Stargazers repo roster for @mihailgaberov/bingo](https://reporoster.com/stars/mihailgaberov/bingo)](https://github.com/mihailgaberov/bingo/stargazers)

### Forkers

[![Forkers repo roster for @mihailgaberov/bingo](https://reporoster.com/forks/mihailgaberov/bingo)](https://github.com/mihailgaberov/bingo/network/members)

## Desarrollo local (etapa 0)

Las URLs de consola/API y los orígenes CORS se configuran mediante variables de
entorno; consultar [configuración de red y resultados de T-01](docs/T_01_CONFIGURACION_URLS_CORS.md).
`npm run build` genera el archivo público `build/runtime-config.js`;
`npm run config:client` permite regenerarlo sin recompilar los bundles.
Los valores de desarrollo se encuentran en `.env.example`. La habilitación del
entorno final, HTTPS y acceso desde los equipos del evento sigue pendiente.

Entorno comprobado: Node **22.16.0**, npm **11.17.0**, MongoDB **7.0.14**.
Node 26 no es compatible con la cadena JWT instalada. `.nvmrc` fija el entorno
verificado; no se ha migrado el proyecto completo a nuevas tecnologías.

```shell
nvm install
nvm use
npm ci --ignore-scripts
npm run build
npm test
npm run test:api
```

No hace falta Gulp global. `npm ci --ignore-scripts` instala desde el lockfile sin
scripts de terceros; Sass es JavaScript y las pruebas descargan MongoDB cuando
lo necesitan. La primera instalación requiere acceso al registro npm. La primera
prueba de API descarga MongoDB 7.0.14, requiere red y puertos locales; después
reutiliza el binario temporal. No usa ni borra la base de desarrollo.

Para arrancar con una base local propia, iniciar MongoDB en otro terminal:

```shell
mongod --dbpath /ruta/a/un/directorio/local/de/datos --bind_ip 127.0.0.1 --replSet bingo-rs
```

Inicializar el replica set una sola vez en esa base nueva y esperar a que sea PRIMARY:

```shell
mongosh --eval 'rs.initiate({_id:"bingo-rs",members:[{_id:0,host:"127.0.0.1:27017"}]})'
mongosh --eval 'rs.status()'
```

Desde la etapa 1 el servidor requiere transacciones: un MongoDB standalone es
rechazado. Las pruebas crean su propio replica set temporal automáticamente.

Copiar `.env.example` a `.env`, ajustar `DB_URI` y `DB_SECRET` (secreto de firma
JWT, no contraseña de MongoDB), y ejecutar en terminales separados:

```shell
npm start
```

```shell
npm run dev
```

API: `http://127.0.0.1:8888/health`. Interfaz:
`http://localhost:8000`; administración: `http://localhost:8000/back-office.html`.
El servidor espera una conexión válida a MongoDB antes de escuchar. Si falla,
termina con código distinto de cero. `PORT` permite cambiar el puerto de API,
pero el cliente heredado tiene URLs fijas en `src/API/api-consts.js`.

`npm run build` termina sin abrir servidores ni watchers. `npm run dev` compila
y permanece observando cambios. `npx gulp fe` y `npx gulp bo` conservan alias de
desarrollo y compilan ambas interfaces. Detener cada proceso con Ctrl+C.

Otros controles:

```shell
npm run lint
npm run test:frontend
npm run test:back-office
npm run test:all
```

Consultar [resultados y límites de la etapa 0](docs/ETAPA_0_RESULTADOS.md) y
[reglas pendientes del piloto](config/piloto.borrador.json). El JSON es un
registro de acuerdos, todavía no lo consume el motor. El juego actual sigue
siendo el heredado: estas correcciones no implementan el piloto.

## Importación de participantes (etapa 2)

Abrir `http://localhost:8000/back-office.html` con API y MongoDB activos. El acceso
inicial ya no depende de poder consultar los usuarios del juego heredado.

1. Iniciar sesión con una cuenta de personal provisionada. El administrador crea
   la edición; `administrator` e `importer` pueden incorporar listas y resolverlas.
2. Seleccionar la edición y cargar el CSV UTF-8 junto con su versión o referencia
   de Polla. Encabezados: `email,telefono` y opcionalmente `jugador_id,nombre`.
3. Revisar la previsualización. Las filas inválidas o con conflictos requieren
   resolución y respaldo de Polla; los contactos compartidos no fusionan personas.
4. Incorporar la versión revisada y comprobar la conciliación. Una reimportación
   no elimina a personas ausentes ni crea duplicados. Las bajas son explícitas y
   deben estar respaldadas por Polla.

Los archivos originales y las decisiones se conservan bajo permisos. El límite
por archivo es 5 MiB y 50.000 filas; excederlo rechaza el lote completo, sin elegir
participantes. El auditor puede consultar importaciones, sin modificarlas.
El cierre se bloquea si falta algún cartón o PDF; su emisión ya está disponible
en la sección de cartones. No se generan cuentas de jugadores ni se envían mensajes.

El CRUD anterior sigue en `back-office.html?legacy=1` para el administrador.
Consultar [API, criterios y pruebas de etapa 2](docs/ETAPA_2_RESULTADOS.md).

## Cartones permanentes y PDF (etapa 3)

En la misma consola, un administrador confirma rango de números, variante,
título y fecha/hora cuando estén definidos, con referencia del acuerdo. No hay
una variante por defecto: se admiten distribución libre (al menos 24 números)
y B/I/N/G/O de 1–75. Estas reglas y datos impresos quedan fijos al emitir el
primer lote. Las decisiones globales del brief siguen pendientes; las pruebas
usan configuraciones sintéticas explícitas.

Con la lista incorporada y sin diferencias de identidad, un administrador o
importador puede elegir **Emitir cartones pendientes**. La consola procesa lotes
de 50 y permite pausar al terminar el lote en curso. Reanudar conserva todos los
cartones ya emitidos. Cada cartón y PDF se confirman juntos en MongoDB; no hace
falta configurar almacenamiento de archivos externo.

El personal puede descargar el PDF guardado. Si falta el artefacto, su recuperación
usa la ficha original y verifica su huella, sin volver a sortear números. El código
impreso no es una credencial. Los participantes no necesitan cuenta ni login:
la entrega ya puede ensayarse con el proveedor simulado de la etapa 4.

Ver [resultados y API de etapa 3](docs/ETAPA_3_RESULTADOS.md) y
[PDF de demostración](docs/examples/carton-demostracion.pdf). Para reproducir ese
ejemplo sin base de datos ni emisión real:

```shell
node scripts/preview-card.cjs /tmp/carton-demostracion.pdf
```

## Entrega masiva simulada (etapa 4)

La sección **Entrega de PDFs · simulación** usa exclusivamente un proveedor local
simulado, sin SMTP, API de email ni conexión a WhatsApp. No necesita credenciales
de mensajería y no envía mensajes reales, aunque la base contenga contactos.

Cerrar primero la lista conciliada con sus cartones y PDFs. Administrador e
importador pueden encolar los pendientes, elegir canal y escenario simulado,
procesar la cola, reconciliar incidencias y pedir reintentos/reenvíos con motivo.
Operador y auditor pueden consultar el historial; viewer no accede a destinatarios.
La aceptación del proveedor se muestra separada de la entrega confirmada.

Para procesar en segundo plano sin mantener la consola abierta, con la misma
base replica set y Node 22:

```shell
npm run deliveries:worker
```

Para una sola pasada sobre el trabajo actualmente disponible:

```shell
npm run deliveries:worker -- --once
```

La cola y los intentos sobreviven al reinicio. Se limita a una nueva solicitud
por 100 ms por edición, compartido entre procesos; los fallos temporales tienen
backoff y hasta tres intentos automáticos. Un resultado incierto se reconcilia
antes de volver a enviar. Reimportar o encolar otra vez no duplica la entrega
inicial. El canal alternativo y el reenvío explícito conservan el mismo PDF y
participante y dejan un registro nuevo vinculado al anterior.

Ver [estados, API, límites y pruebas de etapa 4](docs/ETAPA_4_RESULTADOS.md).
La integración real con email/WhatsApp y sus habilitaciones siguen pendientes.

## Partida oficial en el servidor (etapa 5)

La sección **Partida oficial** de `back-office.html` controla el piloto. La
interfaz del juego heredado en `index.html` no registra bolillas ni premios del
piloto.

1. Completar importación, emisión y cierre de la lista. Los fallos de entrega no
   eliminan cartones ni condicionan su evaluación.
2. Un administrador confirma las siete máscaras, modalidades, orden y políticas.
   Los dibujos precargados son referencias que deben revisarse; no son una
   aprobación automática de las reglas pendientes del brief.
3. El operador valida y pasa a **listo**. Se comprueban datos y PDFs y se congela
   una copia de todos los cartones habilitados.
4. Iniciar expresamente la partida. El bolillero físico exige revisar el número
   antes de confirmarlo. La modalidad digital elige en el servidor, sin reposición.
5. La consola consulta el estado oficial cada segundo y muestra avance,
   secuencia y todos los candidatos de la primera bolilla ganadora, paginados.
   Las completaciones posteriores se conservan como reserva separada.
6. Pausar/reanudar según reglas, abrir la siguiente ronda independiente o
   finalizar con motivo, conservando todo el historial.

Se pueden usar rondas independientes o figuras simultáneas. La combinación de
figuras simultáneas sin permitir varias figuras por persona se bloquea hasta
resolver su prioridad; no se inventa un desempate entre figuras. Si se configura
pausa por contacto, detectar candidatos pausa la partida y no puede eludirse
reanudando sin resolverlos. El reparto se valida en la etapa 7:
**detectado no equivale a premio adjudicado**. El flujo de contacto de la etapa 6
se describe abajo.

Ver [reglas admitidas, pruebas y mediciones de etapa 5](docs/ETAPA_5_RESULTADOS.md).

## Alertas y contacto individual (etapa 6)

En la consola de partida, las alertas conservan todos los candidatos por figura y
extracción hasta reconocimiento explícito. La consulta se dispara al conocer una
nueva versión oficial de la partida y mantiene una actualización periódica de respaldo.
Las lecturas son consistentes por versión y las señales en curso se agrupan. **Habilitar y probar sonido** activa un
tono repetido mientras haya alertas pendientes; silenciar no las reconoce. El
historial permite consultar reconocidas. Al actualizar una base de la etapa 5 con
candidatos existentes, usa **Recuperar alertas de candidaturas existentes**.

Para cada candidato primario:

1. Consulta su contacto y las trazas de envío del mismo cartón.
2. Registra canal y evidencia del intento; realiza el aviso fuera de la aplicación.
3. Registra fallo o confirma aviso exitoso. Solo el éxito inicia **60 segundos en
   el servidor**, distintos para cada candidato; reintentar no renueva el plazo.
4. Registra la hora acreditada de recepción y evidencia. El límite exacto es válido;
   una respuesta realmente tardía queda descartada. Puedes acreditar una respuesta
   oportuna registrada después del vencimiento.
5. Si no respondió, revisa el canal y registra el descarte después de vencer. Un
   vencido pendiente de revisión sigue bloqueando el avance cuando las reglas lo exigen.

Reconocer una alerta no inicia contacto ni confirma un premio. La aplicación no
manda mensajes de premio. La adjudicación monetaria y el registro de entrega se implementan en la etapa 7, descrita abajo. Ver [resultados, API y límites](docs/ETAPA_6_RESULTADOS.md).

La comprobación opcional `node scripts/check-stage6-browser.cjs` usa Chrome local
y datos sintéticos para verificar audio real de Web Audio, repetición, reconocimiento,
silencio posterior y contador. El volumen del parlante y el navegador del evento
requieren el ensayo operativo.

## Reparto y abonos en polla.cl (etapa 7)

La consola distingue respuesta oportuna, adjudicación y abono en la cuenta de Polla.
El abono se realiza fuera de Bingo; aquí se valida el reparto y se conserva su constancia.

1. Resolver todos los contactos del grupo, incluidos vencidos pendientes de revisión.
2. Verificar con Polla la cuenta de cada confirmado y registrar evidencia de pertenencia.
   El identificador importado no se toma automáticamente como una cuenta verificada.
3. Preparar el reparto, revisar cuentas, montos y destino del remanente, y aprobar la
   propuesta exacta. Los pesos residuales se sortean una sola vez y quedan reproducibles.
4. Aplicar la continuación configurada: redistribuir, disputar saldo con reservas por
   extracción, continuar bolillas o conservar saldo no asignado cuando corresponda.
5. Registrar un abono externo ya realizado, por el monto completo y la misma cuenta,
   con referencia individual única, fecha y evidencia. Esto marca la entrega del premio.
6. Consultar/exportar adjudicados, pendientes de abono, abonados y descartados por separado.

El libro mantiene $400.000 entre adjudicado, disponible y no asignado; lo abonado
es parte de lo adjudicado. No se puede avanzar de figura ni finalizar con un
reparto pendiente. La recuperación de una ronda antigua detenida requiere revisión,
motivo y reapertura en pausa. No se recrean cartones ni se reinician los contactos.

Ver [reglas, API, pruebas y límites de etapa 7](docs/ETAPA_7_RESULTADOS.md).

## Ensayo integral y recuperación (etapa 8)

El laboratorio crea bases locales propias y usa datos ficticios, el proveedor
simulado y referencias de abono sin dinero real. Incluye 3.000 y 10.000 cartones
únicos con PDF, dos consolas Chrome contra HTTP/MongoDB reales, 60 extracciones
por volumen, restauración BSON a otra réplica y continuación de contactos con
sus vencimientos originales. No admite una URI de producción.

```shell
nvm use
npm run build
npm run rehearse:pilot -- --cards=3000,10000 --draws=60 --trials=300 --output=docs/evidencias/etapa8/ensayo.json
node scripts/report-rehearsal.cjs docs/evidencias/etapa8/ensayo.json > docs/ETAPA_8_RESULTADOS.md
```

Requiere Chrome instalado (`CHROME_BIN` permite otra ruta) y el MongoDB local
de pruebas. En macOS se puede anteponer `caffeinate -i` al comando Node para evitar
que la suspensión por inactividad invalide los tiempos. Las copias BSON y CSV de
entrada quedan en un directorio temporal privado indicado en el JSON; no se
publican ni se restauran sobre bases existentes.

Ver [resultados y pendientes](docs/ETAPA_8_RESULTADOS.md),
[guion operativo y recuperación](docs/ETAPA_8_GUION_Y_RECUPERACION.md) y
[evidencia reproducible](docs/evidencias/etapa8/ensayo.json).
El ensayo automatizado no habilita el evento: la decisión operativa sigue en Fabuloso.
Consultar el [checklist final de habilitación](docs/CHECKLIST_HABILITACION_PILOTO.md),
con pendientes técnicos, decisiones de Fabuloso y validaciones del proveedor.

La [optimización posterior de alertas](docs/OPTIMIZACION_ALERTAS_RESULTADOS.md)
repite la carga con las mismas semillas y compara el retraso de las alertas,
incluida la segunda consola. Su evidencia se guarda separada de la medición original.

## Personal de Fabuloso (etapa 1)

Se cerró el registro público de administradores. Las cuentas antiguas no reciben
permisos automáticamente y deben provisionarse expresamente. Usar Node 22 y una
base MongoDB con replica set, configurar `.env` y ejecutar:

```shell
npm run staff:provision < /ruta/protegida/personal.json
```

La entrada JSON contiene `email`, `name`, `password` (mínimo 12 caracteres),
`roles` y opcionalmente `active`. Roles disponibles: `administrator`, `operator`,
`importer`, `viewer`, `auditor`. La contraseña entra por stdin, no por argumentos.
Reprovisionar cambia credenciales/roles y revoca los tokens anteriores. No se
crearon cuentas reales ni se migraron automáticamente las existentes.

Consultar [operación, endpoints y resultados de etapa 1](docs/ETAPA_1_RESULTADOS.md).
Los tokens anteriores dejan de ser válidos; iniciar sesión otra vez por
`POST /bingo-api/loginAdmin`. La consola heredada de CRUD requiere el rol
`administrator`; los demás roles tienen acceso limitado a la API del piloto.
La consola ya incluye importación y conciliación; las pantallas del juego en vivo siguen pendientes.

MIT License

Copyright (c) 2016 - present Mihail Gaberov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
