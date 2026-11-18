const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const baselineFile = process.argv[2] || 'docs/evidencias/etapa8/ensayo.json';
const optimizedFile = process.argv[3] || 'docs/evidencias/alertas/ensayo-optimizado.json';
const before = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const after = JSON.parse(fs.readFileSync(optimizedFile, 'utf8'));
assert.equal(before.status, 'passed-functional-checks');
assert.equal(after.status, 'passed-functional-checks');
assert.equal(after.syntheticOnly, true);
assert.equal(after.realMessagesSent, 0);
assert.equal(after.realCreditsExecuted, 0);
for (const field of [
  'node',
  'mongodb',
  'chrome',
  'cpu',
  'platform',
  'arch',
  'logicalCpus',
  'totalMemoryBytes'
])
  assert.equal(after.environment[field], before.environment[field], 'Environment changed: ' + field);
for (const file of [
  'bingo-api/pilot/game-engine.js',
  'bingo-api/pilot/card-generator.js',
  'scripts/rehearsal/annex.cjs'
])
  assert.equal(after.sourceFiles[file], before.sourceFiles[file], 'Comparison model changed: ' + file);
const rows = [3000, 10000].map((cards) => {
  const old = before.loads.find((l) => l.cards === cards),
    next = after.loads.find((l) => l.cards === cards);
  assert.ok(old && next, 'Both measured card volumes are required');
  assert.deepEqual(next.numbers, old.numbers, 'The ball sequence must be comparable');
  assert.equal(next.seed, old.seed);
  assert.equal(next.preparation.seed, old.preparation.seed);
  assert.deepEqual(next.firstCandidates, old.firstCandidates, 'Detected ties must stay unchanged');
  assert.equal(next.preparation.layoutSha256, old.preparation.layoutSha256);
  assert.equal(next.preparation.csvSha256, old.preparation.csvSha256);
  assert.equal(next.samples.length, 60);
  assert.equal(next.persistentAlerts.samples, old.persistentAlerts.samples);
  assert.equal(next.delivery.counts.delivered, cards);
  assert.equal(next.delivery.initialJobs, cards);
  assert.ok(next.peerPersistentAlerts, 'Peer alert latency must be recorded');
  const original = old.persistentAlerts.p95Ms,
    current = next.persistentAlerts.p95Ms;
  return {
    cards,
    samples: next.persistentAlerts.samples,
    old: original,
    current,
    improvement: (100 * (original - current)) / original,
    margin: 2000 - current,
    peer: next.peerPersistentAlerts.p95Ms,
    peerMax: next.peerPersistentAlerts.maxMs,
    max: next.persistentAlerts.maxMs,
    principal: next.primaryConsole.p95Ms,
    peerConsole: next.peerConsole.p95Ms,
    meetsGoal: current < 2000 && next.peerPersistentAlerts.p95Ms < 2000
  };
});
const n = (value) => Number(value).toLocaleString('es-CL', { maximumFractionDigits: 1 });
const lines = [],
  line = (text) => lines.push(text || '');
line('# Optimización de alertas persistentes');
line();
line(
  'Comparación local del ' +
    after.startedAt +
    ' contra la medición de la etapa 8 del ' +
    before.startedAt +
    '.'
);
line();
line(
  'Las alertas ahora se consultan al recibir una nueva versión oficial de la partida. El operador que confirma una extracción las actualiza después de la confirmación; la segunda consola las solicita al recibir esa versión por su actualización normal de partida. Se conserva el polling de dos segundos como recuperación periódica.'
);
line();
line(
  'El servidor entrega filas, cantidad pendiente y versión desde un único snapshot MongoDB, con `private, no-store`. El cliente ignora snapshots anteriores a la versión conocida; agrupa nuevas señales durante una consulta y realiza una consulta posterior, sin perder el aviso. Cambiar de edición, credencial o página invalida las respuestas del contexto anterior. Un fallo conserva las alertas previas y muestra un error; no reconoce ni elimina registros.'
);
line();
line(
  'Con audio habilitado, un aviso nuevo suena al recibir el dato persistido; sigue repitiéndose cada cuatro segundos mientras haya pendientes. Se detectan también avisos nuevos cuando un reconocimiento simultáneo mantiene el mismo total pendiente. Pulsos separados por menos de 250 ms se agrupan para evitar superposición. El reconocimiento sigue siendo explícito y compartido; no inicia contacto ni confirma premios.'
);
line();
line('## Resultados');
line();
line(
  '| Cartones | Muestras con detecciones | Alerta principal p95 antes | Alerta principal p95 después | Reducción | Margen hasta 2.000 ms | Alerta segunda consola p95 |'
);
line('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows)
  line(
    `| ${n(r.cards)} | ${r.samples} | ${n(r.old)} ms | ${n(r.current)} ms | ${n(r.improvement)}% | ${n(r.margin)} ms | ${n(r.peer)} ms |`
  );
line();
line(
  '| Cartones | Máximo alerta principal | Máximo alerta segunda consola | p95 actualización de partida principal | p95 actualización de partida segunda consola |'
);
line('| --- | --- | --- | --- | --- |');
for (const r of rows)
  line(
    `| ${n(r.cards)} | ${n(r.max)} ms | ${n(r.peerMax)} ms | ${n(r.principal)} ms | ${n(r.peerConsole)} ms |`
  );
line();
line(
  rows.every((r) => r.meetsGoal)
    ? 'Los p95 de alertas de ambas consolas quedaron bajo dos segundos en esta corrida, con el margen indicado. Es evidencia local, no habilitación del evento.'
    : 'Algún recorrido de alertas no cumplió el objetivo local de dos segundos; debe resolverse antes de habilitar el piloto.'
);
line();
line(
  'La etapa 8 medía la alerta persistente solo en la consola principal; no se inventa un valor anterior para las alertas de la segunda consola. Su p95 posterior sí se midió contra el mismo clic de confirmación. La actualización de partida de la segunda consola conserva su intervalo de aproximadamente un segundo.'
);
line();
line('## Método y alcance');
line();
line(
  `Node ${after.environment.node}, MongoDB ${after.environment.mongodb}, ${after.environment.chrome}, ${after.environment.cpu}, ${n(after.environment.totalMemoryBytes / 1024 ** 3)} GiB. API, réplica de un nodo y Chrome comparten este equipo; HTTP en loopback, sin sesiones de jugadores.`
);
line();
line(
  'Se repitieron 3.000 y 10.000 participantes, emisión real de cartones y PDFs persistidos, encolado y procesamiento del proveedor simulado, dos consolas reales y 60 confirmaciones por volumen. Se conservaron las mismas semillas, CSV, disposiciones de cartón, secuencias de bolillas y máscaras de referencia del brief (siete figuras simultáneas). El comparador exige igualdad de los hashes de CSV y disposiciones, de las bolillas y de las primeras detecciones/empates.'
);
line();
line(
  'El cronómetro empieza antes del clic de confirmación real. La alerta termina al aparecer en el DOM el total de alertas persistidas que corresponde a esa extracción; cada cifra incluye las extracciones con candidatos nuevos, también reservas. La partida se mide por su nueva versión, número y candidatos, más dos oportunidades de render en la consola principal. Las mediciones corresponden a DOM/Chrome headless; no al parlante ni a píxeles de una pantalla física.'
);
line();
line(
  'Se usa el mismo criterio de p95 de rango más próximo, `ceil(0,95 × N)`. Una sola corrida por volumen describe este entorno. El avance del ensayo espera a las dos consolas y a las alertas: al acelerar las alertas también cambia el tiempo entre extracciones del circuito cerrado. No había otra suite de carga simultánea. La medición de la alerta segunda se añadió en esta repetición.'
);
line();
line(
  'Se ejecutó la modalidad `load`: no se volvió a ensayar la recuperación de respaldo ni el circuito financiero completo, que permanecen documentados en la etapa 8 y cubiertos por regresión. La breve simulación probabilística del comando no sustituye el anexo de 300 partidas de la etapa 8. No se alteró la aleatoriedad de las extracciones digitales del evento.'
);
line();
line(
  'Los tiempos del trabajador de entregas son del adaptador simulado y usan su reloj virtual, como en la medición anterior. No representan capacidad ni entrega de un proveedor real. Esta ejecución no realizó envíos ni abonos reales.'
);
line();
const verificationFile = path.join(path.dirname(optimizedFile), 'verificacion.json');
if (fs.existsSync(verificationFile)) {
  const v = JSON.parse(fs.readFileSync(verificationFile, 'utf8'));
  line('## Verificación');
  line();
  line(
    `API: **${v.api.passed} pruebas aprobadas**. Interfaz: **${v.interface.passed} pruebas aprobadas en ${v.interface.suites} suites**. Compilación correcta; lint sin errores y con ${v.lint.warnings} advertencias heredadas de longitud de línea.`
  );
  line();
  line(
    'Las pruebas nuevas cubren refresco inmediato por versión, señales agrupadas durante consultas, snapshots antiguos, respuestas tardías de otra edición, fallo con conservación de filas, recuperación periódica, ausencia de bucles de peticiones, sonido inmediato y sustitución de una alerta sin cambio en el contador. Una prueba HTTP concurrente verifica que reconocimiento, filas, cantidad y versión sean consistentes.'
  );
  line();
  line(
    'Chrome verificó Web Audio real en estado running, repetición antes del reconocimiento y silencio posterior. El disparo inmediato se verifica además con pruebas automatizadas del componente; no se presenta un p95 de sonido físico.'
  );
  line();
}
line('## Reproducción y evidencia');
line();
line('SHA-256 original: ' + createHash('sha256').update(fs.readFileSync(baselineFile)).digest('hex') + '.');
line(
  'SHA-256 optimizado: ' + createHash('sha256').update(fs.readFileSync(optimizedFile)).digest('hex') + '.'
);
line();
line('```shell');
line('nvm use');
line('npm test');
line('npm run test:api');
line('npm run build');
line('npm run lint');
line(
  'caffeinate -i node scripts/rehearse-pilot.cjs --cards=3000,10000 --draws=60 --trials=3 --mode=load --output=docs/evidencias/alertas/ensayo-optimizado.json'
);
line(
  'node scripts/compare-alert-rehearsals.cjs docs/evidencias/etapa8/ensayo.json docs/evidencias/alertas/ensayo-optimizado.json > docs/OPTIMIZACION_ALERTAS_RESULTADOS.md'
);
line('```');
line();
line(
  'En otros sistemas se omite caffeinate y se configura CHROME_BIN si hace falta. El laboratorio crea sus propias bases sintéticas y no acepta una URI de producción. Conserva las alertas persistidas y sus estados; la optimización cambia cuándo las consulta la consola, no la adjudicación o los plazos de contacto.'
);
line();
line('- [Medición original](evidencias/etapa8/ensayo.json).');
line(
  '- [Medición optimizada, semillas, muestras y hashes de fuentes](evidencias/alertas/ensayo-optimizado.json).'
);
line('- [Muestras CSV comparables](evidencias/alertas/latencias.csv).');
line('- [Verificación de pruebas, compilación, lint y audio](evidencias/alertas/verificacion.json).');
line();
line('## Pendientes');
line();
line(
  'Validar en la infraestructura y red finales el número acordado de consolas, navegadores, reconexión y audio del equipo. Siguen pendientes la aprobación de reglas por Fabuloso, la habilitación del proveedor, los responsables operativos y el ensayo humano de la etapa 8. Esta comparación no ejecuta ni autoriza el despliegue, envíos o abonos reales.'
);
console.log(lines.join('\n'));
