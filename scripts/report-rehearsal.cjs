// Render the recorded measurements; never replace failures with theoretical timings.
const fs = require('node:fs');
const path = require('node:path');
const { stats } = require('./rehearsal/random.cjs');
const input = process.argv[2] || 'docs/evidencias/etapa8/ensayo.json';
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
if (
  data.status !== 'passed-functional-checks' ||
  !data.integral ||
  !data.backup ||
  ![3000, 10000].every((n) => data.loads.some((l) => l.cards === n))
)
  throw new Error(
    'A completed integral run with both 3000 and 10000 cards is required; smoke or partial results are not final acceptance.'
  );
const n = (x) =>
  x === null || x === undefined || !Number.isFinite(Number(x))
    ? '—'
    : Number(x).toLocaleString('es-CL', { maximumFractionDigits: 1 });
const pct = (x) => (100 * x).toFixed(2) + '%';
const sec = (x) => n(x / 1000) + ' s';
const lines = [],
  line = (x) => lines.push(x || '');
line('# Etapa 8: ensayo integral, carga y recuperación');
line();
line('Fecha de ejecución: ' + data.startedAt + '. Estado del laboratorio: `' + data.status + '`.');
line();
line(
  '**El ensayo técnico no habilita el piloto.** Fabuloso debe cerrar las reglas, el proveedor, la infraestructura y el ensayo humano. No se enviaron mensajes ni se ejecutaron abonos reales. Las constancias de abono del libro pertenecen exclusivamente a la base ficticia del laboratorio.'
);
line();
line(
  'La evidencia completa, semillas, muestras, hashes de fuentes, tiempos y manifiesto del respaldo están en [ensayo.json](evidencias/etapa8/' +
    path.basename(input) +
    '). El [guion operativo y de recuperación](ETAPA_8_GUION_Y_RECUPERACION.md) explica cómo repetirlo y qué debe ensayar el equipo.'
);
line();
line('## Entorno y metodología');
line();
line(
  `Node ${data.environment.node}, MongoDB ${data.environment.mongodb}, ${data.environment.chrome}; ${data.environment.platform}/${data.environment.arch}, ${data.environment.cpu}, ${data.environment.logicalCpus} CPU lógicas y ${n(data.environment.totalMemoryBytes / 1024 ** 3)} GiB de memoria física.`
);
line();
line(
  'Una réplica local de un nodo, API Express, MongoDB y Chrome comparten el equipo. Se usaron dos credenciales de operador y dos pestañas con los componentes reales de consola, estilos compilados y llamadas HTTP reales. La consola operativa está en primer plano; se desactiva la limitación de temporizadores de pestañas en segundo plano para el segundo lector. No se simulan miles de sesiones de jugadores. No había otra suite de carga ejecutándose durante la corrida registrada.'
);
line();
line(
  'Cada volumen tiene cartones completos distintos, PDFs persistidos y verificados por SHA-256, importación/reimportación y lista conciliada. El generador real recibe aleatoriedad sembrada solo por la dependencia interna del laboratorio. Se usan las máscaras de referencia del brief, 1–75 sin restricciones por columna, siete figuras simultáneas, repetición permitida y extracción manual de bolillas sin reposición. Estas reglas están confirmadas para la edición ficticia y no aprueban las del evento.'
);
line();
line(
  'Se registra el intervalo desde el clic de confirmación real hasta el DOM con la nueva versión, número y resumen completo de candidatos, seguido de dos oportunidades de render (`requestAnimationFrame`) en la consola principal. No es una medida de píxeles en una pantalla física. La segunda consola usa su polling normal de partida; las alertas conservan su polling propio. Se guardan todas las muestras; el p95 es el valor de rango más próximo, `ceil(0,95 × N)`.'
);
line();
line(
  'Se distingue la actualización general de las extracciones con candidatos nuevos, incluidas reservas. Se verifica por un cálculo independiente de posiciones/bolillas el primer grupo completo de cada figura. Una corrida por volumen, en loopback y con Chrome headless, no prueba una red remota, variación entre jornadas ni el peor caso de 70.000 candidaturas en una sola bolilla.'
);
line();
line('## Carga con consola real');
line();
line(
  '| Cartones | Extracciones | Principal p95 (todas) | Principal p95 con candidatos | Segunda consola p95 | Alertas p95 | Máximo principal |'
);
line('| --- | --- | --- | --- | --- | --- | --- |');
const failures = [];
for (const load of data.loads) {
  const candidates = stats(
    load.samples.filter((s) => s.candidateCount > 0).map((s) => s.domAndPaintOpportunityMs)
  );
  line(
    `| ${n(load.cards)} | ${load.samples.length} | ${n(load.primaryConsole.p95Ms)} ms | ${n(candidates.p95Ms)} ms (${candidates.samples} muestras) | ${n(load.peerConsole.p95Ms)} ms | ${n(load.persistentAlerts.p95Ms)} ms (${load.persistentAlerts.samples} muestras) | ${n(load.primaryConsole.maxMs)} ms |`
  );
  for (const [name, metric] of [
    ['principal', load.primaryConsole],
    ['principal con candidatos', candidates],
    ['segunda consola', load.peerConsole],
    ['alertas', load.persistentAlerts]
  ])
    if (metric.p95Ms !== null && metric.p95Ms >= 2000)
      failures.push(`${n(load.cards)} cartones: ${name}, p95 ${n(metric.p95Ms)} ms`);
}
line();
line(
  failures.length
    ? '**RNF-02 no se cumple en todos los recorridos medidos.** Pendientes de rendimiento: ' +
        failures.join('; ') +
        '. No se sustituye ese resultado por la latencia HTTP o la del evaluador puro.'
    : 'Los p95 disponibles quedaron por debajo de 2.000 ms en esta corrida local. Es evidencia acotada al entorno medido; la capacidad y red del evento siguen pendientes de aceptación.'
);
line();
if (data.loads.some((l) => l.persistentAlerts.p95Ms > 1800)) {
  line(
    'Las alertas persistentes quedaron muy cerca del límite de dos segundos: el polling de dos segundos deja poco margen. Debe comprobarse este recorrido en la infraestructura final; el resultado local no acredita margen de capacidad para red y equipos remotos.'
  );
  line();
}
line('Primeras detecciones y empates efectivamente verificados:');
line();
line('| Cartones | Figura | Primera extracción | Candidatos en ese empate |');
line('| --- | --- | --- | --- |');
for (const load of data.loads)
  for (const f of load.firstCandidates)
    line(
      `| ${n(load.cards)} | ${f.figure} | ${f.firstSequence ?? 'sin detectar en la ventana'} | ${f.primaryCandidates} |`
    );
line();
line('## Preparación y entrega simulada');
line();
line(
  '| Participantes | Importar y aplicar | Emitir cartones/PDF persistidos | Bytes PDF | Encolar | Procesar proveedor simulado | Jobs iniciales / entregados simulados |'
);
line('| --- | --- | --- | --- | --- | --- | --- |');
for (const load of data.loads)
  line(
    `| ${n(load.cards)} | ${sec(load.preparation.importMs)} | ${sec(load.preparation.generationMs)} | ${n(load.preparation.pdfBytes)} | ${sec(load.delivery.queuedMs)} | ${sec(load.delivery.workerMs)} | ${load.delivery.initialJobs} / ${load.delivery.counts.delivered} |`
  );
line();
line(
  'El tiempo de emisión incluye una comprobación intermedia de bloqueo antes de completar todos los cartones. Cada PDF conserva su titular y hash; se compara el contenido de una muestra parseada y se verifican los hashes de todos.'
);
line();
line(
  'El proveedor es el adaptador simulado existente, sin cliente SMTP, correo o WhatsApp. Su reloj de trabajador se adelanta para no esperar entre jobs. Estos tiempos no acreditan caudal ni entrega de un proveedor real. Con el espaciado configurado de 100 ms, solo el piso de espaciado sería aproximadamente ' +
    data.loads.map((l) => `${n(l.cards)}: ${sec(l.delivery.minimumConfiguredPacingMs)}`).join('; ') +
    ', antes de red, límites y reintentos reales.'
);
line();
line('## Recuperación del respaldo');
line();
if (data.backup) {
  const backup = data.backup;
  line(
    `Se detuvieron todos los escritores, se copiaron ${backup.collections.length} colecciones en BSON comprimido (${n(backup.bytes)} bytes) desde un snapshot transaccional y se apagó la réplica de origen. Se restauró en otra réplica/base vacía y se arrancó otro proceso de server.js.`
  );
  line();
  line('| Medición | Resultado |');
  line('| --- | --- |');
  for (const [name, value] of [
    ['Copia con escritores detenidos', backup.backupMs],
    ['Restauración de archivos e índices', backup.restoreMs],
    ['Arranque del nuevo servidor', backup.serverRestartMs],
    ['Procedimiento de recuperación, incluida réplica nueva y verificación', backup.restoreProcedureMs],
    ['Indisponibilidad completa del laboratorio, incluida copia', backup.fullLabOutageMs]
  ])
    line(`| ${name} | ${sec(value)} |`);
  line();
  line(
    'Coincidieron los hashes BSON de todas las colecciones, cantidades, índices, bytes de PDFs y asignaciones. Se reintentó una extracción con su recibo original antes y después de restaurar: no se duplicó. Ambos contactos seguían esperando respuesta con los mismos `contactStartedAt` y `expiresAt`, distintos entre sí. El reloj no se reinició.'
  );
  line();
  line(
    'Tras esperar al vencimiento original, se acreditó una recepción oportuna registrada después y se descartó otra realmente tardía. La prueba continuó el remanente, reinició rondas conservando PDFs y completó los siete pozos. Los tiempos son del laboratorio; no constituyen RPO/RTO acordados de producción ni demuestran recuperación de escrituras posteriores al respaldo. La copia es lógica, con mantenimiento y sin escritores; no es un respaldo continuo o un ensayo de un proveedor cloud.'
  );
} else line('No se ejecutó recuperación en esta modalidad.');
line();
line('## Flujo integral y aceptación');
line();
line(
  'El circuito financiero de seis personas usa una máscara mínima controlada (primera casilla numerada más centro libre) para forzar empates, reservas y respuestas distintas de forma reproducible. No es una partida de las siete letras del anexo. La carga con 3.000/10.000 cartones sí utiliza las siete máscaras de referencia reales; ambas evidencias se mantienen separadas.'
);
line();
if (data.integral)
  line(
    `La edición integral tiene ${data.integral.participants} personas ficticias, ${data.integral.independentRounds} rondas, ${data.integral.prizes} premios sintéticos y ${data.integral.discarded} candidatura descartada. El libro asignó y marcó como abonados ${n(data.integral.simulatedRecordedCreditsClp)} CLP **solo en la simulación**; abonos externos ejecutados: ${data.integral.actualCreditsExecuted}. Exportación comprobada, pendientes de abono vacíos y descartados separados.`
  );
line();
line('| Aceptación | Evidencia del ensayo | Estado / límite |');
line('| --- | --- | --- |');
const cases = [
  ['PA-01', 'Importaciones completas de ambos volúmenes, un cartón por persona', 'Cumple en laboratorio'],
  [
    'PA-02',
    'Reimportación del mismo archivo y repetición del encolado sin duplicados',
    'Cumple en laboratorio'
  ],
  [
    'PA-03',
    'CSV inválido y contactos compartidos visibles; aplicación bloqueada; decisiones explícitas',
    'Cumple en laboratorio'
  ],
  [
    'PA-04',
    '24 números, centro libre, titulares, unicidad y hashes de todos los PDFs',
    'Cumple en laboratorio; muestra visual humana pendiente'
  ],
  ['PA-05', 'Siete rondas con bolillas reiniciadas y PDFs/cartones sin cambios', 'Cumple en laboratorio'],
  [
    'PA-06',
    'Empate conocido y oracle independiente del primer grupo por figura; contacto privado HTTP',
    'Cumple técnico; operación humana pendiente'
  ],
  ['PA-07', 'Todos los empatados y reparto de remanente sin exceder $400.000', 'Cumple en laboratorio'],
  [
    'PA-08',
    'Máscara con centro libre, marcas exteriores y comparación de posiciones exigidas',
    'Cumple en laboratorio'
  ],
  [
    'PA-09',
    'Cero cuentas/sesiones de jugador; PDF y evaluación del servidor',
    'Cumple técnico; recepción real no probada'
  ],
  [
    'PA-10',
    'Dos operadores, una escritura; recibo reintentado también tras restaurar',
    'Cumple en laboratorio'
  ],
  [
    'PA-11',
    'Otra réplica y otro proceso; contenido, índices, secuencia y plazos conservados',
    'Cumple local; infraestructura/respaldos reales pendientes'
  ],
  [
    'PA-12',
    'Viewer/importador sin contactos o premios; roles de personal y edición comprobados',
    'Cumple técnico'
  ],
  [
    'PA-13',
    'Siete pozos, una O, exportación y suma de dinero sintético consistente',
    'Cumple técnico; referencias y abonos reales no ensayados'
  ],
  [
    'PA-14',
    'Muestras de consola y alertas para ambos volúmenes, sin sesiones masivas de jugador',
    failures.length
      ? 'Parcial: revisar los p95 que no cumplen'
      : 'Cumple local; red e infraestructura final pendientes'
  ],
  [
    'PA-15',
    'Lista cerrada conciliada, sin omisiones ni jugadores extras en ambos volúmenes',
    'Cumple con lista ficticia; lista oficial pendiente'
  ],
  [
    'PA-16',
    'Fallo permanente y reenvío del mismo cartón sin perder elegibilidad',
    'Cumple con proveedor simulado'
  ],
  ['PA-17', 'Preparación bloqueada antes de completar cartones y cierre', 'Cumple técnico'],
  [
    'PA-18',
    'PDFs individuales, bytes, destinatarios y receipts del adaptador simulado',
    'Parcial: proveedor/entrega real pendientes'
  ],
  [
    'PA-19',
    'Alerta y grupo no duplicados al reintentar; DOM real medido',
    'Cumple técnico; sonido físico pendiente'
  ],
  [
    'PA-20',
    'Respuesta realmente posterior al minuto descartada y ausente de pendientes',
    'Cumple técnico; revisión de ausencia y límite exacto también en regresión'
  ],
  [
    'PA-21',
    'Recepción oportuna acreditada tarde, cuenta ficticia, premio y constancia sintética',
    'Cumple técnico; abono real fuera de alcance'
  ],
  ['PA-22', 'Reenvío por otro canal, mismo titular y mismo hash de PDF', 'Cumple técnico'],
  [
    'PA-23',
    'Plazos distintos y redisputa del remanente con grupo completo de reservas',
    'Cumple técnico; dotación humana por acordar'
  ],
  [
    'PA-24',
    'Restauración durante espera, vencimiento original y respuesta tardía sin premio',
    'Cumple en laboratorio'
  ]
];
for (const c of cases) line('| ' + c.join(' | ') + ' |');
line();
line(
  'La matriz distingue comprobaciones automáticas del trabajo humano y del proveedor. No afirma que se haya ensayado una transmisión o que todas las políticas del brief estén aprobadas. La regresión de las etapas anteriores conserva otras alternativas de continuación, límite exacto de respuesta, descartes revisados, fallos y permisos.'
);
line();
const verificationPath = path.join(path.dirname(input), 'verificacion.json');
if (fs.existsSync(verificationPath)) {
  const v = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
  line('## Regresión y comprobaciones');
  line();
  line('| Comprobación | Resultado |');
  line('| --- | --- |');
  line(
    '| API | ' +
      v.api.passed +
      ' pruebas aprobadas; ' +
      v.api.failed +
      ' fallidas; ' +
      n(v.api.durationMs / 1000) +
      ' segundos |'
  );
  line('| Interfaz | ' + v.interface.passed + ' pruebas aprobadas en ' + v.interface.suites + ' suites |');
  line('| Compilación | Correcta |');
  line(
    '| Lint | ' +
      v.lint.errors +
      ' errores; ' +
      v.lint.warnings +
      ' advertencias heredadas de longitud de línea |'
  );
  line();
  line(
    'Resumen y hashes de las ejecuciones en [verificacion.json](evidencias/etapa8/verificacion.json) y [verificacion.txt](evidencias/etapa8/verificacion.txt). Las pruebas nuevas cubren restauración BSON, integridad, tipos e índices y reproducibilidad del anexo. La sintaxis de los scripts y git diff --check también se verificaron.'
  );
  line();
}
line('## Anexo: cálculo y simulación reproducibles');
line();
if (data.annex) {
  const a = data.annex;
  line(
    `Semilla ${a.seed}, ${a.trials} partidas de ${n(a.cards)} cartones; máscaras de referencia y generador real. El orden fijo 1–75 es equivalente por simetría para cartones uniformes sin restricciones. Se mantiene el mismo cartón para las siete figuras, conservando su dependencia. Se verificaron ${a.checks.engineProgressComparisons} comparaciones con el evaluador real en los límites de completación. No se simularon respuestas ni cobros.`
  );
  line();
  line(
    '| Figura | Números exigidos | P(alguien a 40), teoría | A 40, simulación | Empate, teoría | Empate, simulación | Media de primera extracción: teoría / simulación |'
  );
  line('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, r] of Object.entries(a.rows))
    line(
      `| ${name} | ${r.theory.required} | ${pct(r.theory.at40)} | ${pct(r.simulation.at40)} | ${pct(r.theory.tieProbability)} | ${pct(r.simulation.tieProbability)} | ${n(r.theory.expectedDraws)} / ${n(r.simulation.meanFirstDraw)} |`
    );
  line();
  line(
    `La suma teórica de las siete rondas independientes es ${n(a.independentRoundsExpectedDraws)} bolillas, consistente con las aproximadamente 297 del brief. En la simulación simultánea, la última primera detección ocurrió en promedio a ${n(a.meanSimultaneousLastDraw)} bolillas; O fue última, incluidos empates de orden, en ${pct(a.OLastIncludingTies)} de las partidas. No se presume que O cierre el programa.`
  );
  line();
  line(
    'Las diferencias de frecuencia son variación Monte Carlo: con 300 partidas el error estándar puede acercarse a 2,9 puntos porcentuales en una probabilidad de 50%; no es una validación de cuatro decimales. Las fórmulas, quantiles y errores estándar están en JSON. La coincidencia marginal S/O o A/U no implica independencia entre letras. La simulación no estima probabilidad de cobrar ni incorpora RF-17, contacto o dinero; el ensayo integral verifica esos flujos por separado.'
  );
}
line();
line(
  'Por simetría, sin descartes y repartiendo íntegramente los pozos, el importe esperado por persona sería $16,67 por figura ordinaria, $33,33 para O y $133,33 sumando siete pozos con 3.000 participantes. Esto reproduce la referencia matemática del brief; no estima el cobro con respuesta obligatoria ni un beneficio de la jugada.'
);
line();
line('## Cambios necesarios y pendientes');
line();
line(
  'Se añadió un laboratorio repetible con datos sembrados, observación de DOM en Chrome, validación de primeros candidatos, copia/restauración BSON y reporte. Las pruebas de respaldo rechazan origen sin pausa declarada, archivos corruptos y destino no vacío, y verifican tipos e índices únicos. El ensayo detectó además que los códigos seguros de error de contacto/premios no llegaban a la consola: se incorporaron a la lista permitida del servidor y una prueba HTTP verifica la explicación de respuesta pendiente. No se cambió la selección criptográfica de bolillas del evento.'
);
line();
line('Pendientes para habilitación:');
line();
for (const pending of [
  'Fabuloso: aprobar rango, restricciones, máscaras, modalidades y todas las políticas pendientes; revisión expresa de reservas y agotamiento.',
  'Fabuloso: nombrar responsables y suplentes; ensayar contactos simultáneos, sonido físico, vista pública de la transmisión y registro de incidencias.',
  'Proveedor: habilitar remitente/canal, verificar límites, adjuntos, reintentos y entrega real en pruebas autorizadas.',
  'Infraestructura: entorno final, red, carga concurrente acordada, almacenamiento y métricas de consola real.',
  'Recuperación: custodia/cifrado/retención, secretos externos y RPO/RTO; restaurar desde otro equipo y con la herramienta productiva elegida.',
  'Premios: acordar referencias reales de cuenta y comprobante, controles operativos y firma del revisor; no se realizaron abonos reales.',
  ...failures.map((f) => 'Rendimiento: resolver y repetir el escenario ' + f + '.')
])
  line('- ' + pending);
line();
line(
  '**Decisión:** ensayo técnico documentado; piloto no habilitado automáticamente. La autorización operativa corresponde a Fabuloso tras resolver los pendientes.'
);
console.log(lines.join('\n'));
