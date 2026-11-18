# Guion de ensayo y recuperación del piloto

Este guion acompaña el laboratorio sintético de la etapa 8. No autoriza envíos, abonos ni despliegue. Las personas responsables y los acuerdos de infraestructura deben ser confirmados por Fabuloso.

## Ejecutar el laboratorio

Requisitos: Node 22, dependencias del proyecto, binario MongoDB 7.0.14 para `mongodb-memory-server` y Chrome local. No se necesita una cuenta de jugador ni un proveedor de mensajes. La instalación de Chrome usada por defecto es la de macOS; `CHROME_BIN` permite indicar otra ubicación. El programa no recibe una URI de base de datos: crea sus propias réplicas locales.

```shell
nvm use
npm run build
npm run rehearse:pilot -- --cards=3000,10000 --draws=60 --trials=300 --output=docs/evidencias/etapa8/ensayo.json
```

En macOS, para evitar que una suspensión por inactividad invalide los tiempos:

```shell
caffeinate -i node scripts/rehearse-pilot.cjs --cards=3000,10000 --draws=60 --trials=300 --output=docs/evidencias/etapa8/ensayo.json
```

El inhibidor solo dura mientras se ejecuta el proceso y no cambia ajustes persistentes. Para verificar primero la instalación, usar `--cards=12 --draws=3 --trials=3 --output=/tmp/bingo-smoke.json`. Para una calibración sin el circuito de recuperación y contacto, añadir `--mode=load`. Esas corridas pequeñas no acreditan capacidad de 3.000 o 10.000 cartones.

El laboratorio guarda su JSON de resultados en la ruta indicada y los CSV/BSON sintéticos en un directorio temporal propio, indicado por `labDirectory`. Los archivos BSON y sus manifiestos se crean con permisos privados; no deben publicarse ni confundirse con un respaldo de producción. Los perfiles temporales de Chrome se eliminan al terminar. Se detienen únicamente las réplicas y procesos que creó el propio programa.

Las semillas reproducen los cartones de laboratorio y las bolillas manuales del ensayo. No se añaden semillas públicas a las extracciones digitales del evento. Los bytes de PDF y los identificadores pueden cambiar entre ejecuciones por sus fechas e identificadores de emisión; su estabilidad se verifica dentro de cada edición y al restaurar.

## Roles que deben ensayar personas reales

| Rol | Responsabilidad durante el ensayo | Responsable |
| --- | --- | --- |
| Dirección operativa | Confirmar reglas, ordenar inicio/pausa/continuación y autorizar el cierre | Por designar por Fabuloso |
| Operador principal | Revisar y confirmar cada número; reconocer alertas sin adjudicar por anticipado | Por designar |
| Operador de respaldo | Leer el mismo estado, asumir control ante caída y evitar repetir la extracción | Por designar |
| Coordinación de contactos | Distribuir todos los empatados y comprobar canal, aviso, plazo y recepción | Por designar |
| Revisor de premios | Verificar cuentas, resolver contactos, revisar propuesta y remanente antes de adjudicar | Por designar |
| Responsable de abonos | Ejecutar el abono fuera de Bingo y registrar comprobante individual correcto | Por designar; sin abonos reales en este ensayo |
| Responsable de infraestructura | Custodiar respaldo y secretos, restaurar, verificar integridad y registrar tiempos | Por designar |
| Auditor | Revisar reportes, descartes, comprobantes y conciliación de los siete pozos | Por designar |

Los roles pueden combinarse si Fabuloso define permisos y supervisión adecuados. Deben nombrarse suplentes y probar la dotación para contactar empatados; una prueba rápida del motor no demuestra capacidad humana de contacto.

## Recorrido manual con lista ficticia

1. Acordar un entorno de ensayo aislado, sin proveedor real, con cuentas `.invalid` y referencias de cuenta claramente ficticias. Revisar las siete máscaras, rango, restricciones por columna, modalidades, repetición, residuos, descarte, falta total de respuestas y pausa. Registrar que se trata de configuración de ensayo.
2. Importar CSV con válidos, inválidos, duplicados y contactos compartidos. Comprobar motivos, resolver con respaldo ficticio y reimportar. Comparar lista única, titulares, cartones y PDFs. Intentar pasar a listo antes de completar cartones: debe bloquearse.
3. Generar los PDFs, verificar muestras visuales y hashes, cerrar conciliación. Encolar solo con el proveedor simulado y provocar un fallo permanente y un reenvío. Confirmar que el reenvío mantiene persona y cartón y que el fallo no excluye al jugador.
4. Abrir dos consolas de personal. Habilitar y escuchar el sonido en el equipo del evento; probar silencio local, reconocimiento compartido, historial y recarga. No mostrar contactos o cuentas en la salida pública de la transmisión.
5. Confirmar números conocidos. Comparar ambas consolas y evidencia; disparar dos acciones con la misma versión y reintentar una respuesta incierta. Comprobar una sola extracción y el conjunto completo de empatados.
6. Para dos candidatos, fallar un aviso y luego registrar éxito. Iniciar el segundo después del primero. Verificar vencimientos distintos, detener el servidor y restaurar el respaldo siguiendo el apartado siguiente.
7. Acreditar una respuesta recibida antes del vencimiento pero registrada después; registrar otra realmente tardía. No modificar las horas para hacer pasar la tardía. El límite exacto es válido. Resolver todos los contactos antes del reparto.
8. Verificar referencias ficticias de cuenta, preparar reparto y revisar todo el grupo. Corregir una cuenta antes de aprobar y comprobar que la vista anterior no puede aprobar otra propuesta. Confirmar que no se vuelve a sortear el residuo.
9. Ensayar redistribución, redisputa de remanente, reservas por extracción, nadie responde y agotamiento de elegibles con revisión excepcional. Antes de otra figura, cerrar el pozo actual. Conservar cartones y PDFs al reiniciar bolillas.
10. Recorrer los siete pozos, incluida una sola O. Registrar únicamente constancias sintéticas de abono y reintentarlas; el dinero asignado no debe superar $400.000. Comparar adjudicado, disponible, no asignado, abonado y pendiente.
11. Exportar respuestas oportunas, adjudicados, pendientes, abonados y descartados por separado. Verificar cuentas/titulares, evidencia y permisos. Probar fórmulas de planilla en datos sintéticos y comprobar su neutralización en CSV.
12. Registrar diferencias, operadores, equipo, versión, tiempos, decisión de habilitación y firmas. La corrida automática no sustituye estas firmas.

## Respaldo y restauración verificados en laboratorio

El laboratorio usa una copia **lógica BSON comprimida**, implementada en `scripts/rehearsal/backup.cjs`, porque no depende de tener instalados `mongodump`/`mongorestore`. No es un volcado oficial de esas herramientas ni una política de respaldo continuo.

Procedimiento demostrado:

1. Pausar la partida. Detener API, consolas de ensayo y trabajadores: no debe quedar ningún escritor. La opción `writersStopped` del programa declara esa condición; no congela por sí misma una aplicación externa.
2. Crear un directorio privado nuevo. Leer todas las colecciones desde una transacción con `readConcern: snapshot`. Conservar BSON original, binarios de PDFs, ObjectIds, fechas, recibos de idempotencia, auditoría, contactos, propuestas y abonos sintéticos.
3. Conservar metadatos de índices y un manifiesto con cantidad de documentos, hash SHA-256 del BSON y hash/tamaño de cada archivo comprimido. Los índices se leen con los escritores detenidos. Verificar los archivos antes de considerarlos recuperables.
4. Desconectar y apagar la réplica de origen del laboratorio. Crear otra réplica y una base vacía. No restaurar sobre una base existente: el programa lo rechaza y no ejecuta `drop`.
5. Validar todos los hashes antes de insertar. Restaurar tipos BSON y reconstruir índices, incluidas restricciones únicas. Comparar contenido BSON, cantidades e índices de todas las colecciones, además de hashes de PDF y asignaciones.
6. Arrancar un proceso nuevo de `server.js` contra la copia. En el laboratorio se conserva el secreto JWT sintético correspondiente. Verificar salud, versión de edición, estado pausado, secuencia, alertas y plazos. Reintentar una acción anterior con su clave original: debe devolver el recibo previo sin duplicar.
7. Comparar `contactStartedAt` y `expiresAt` con el registro previo. El minuto no se reinicia. Si venció durante la caída, conciliar la recepción real antes de adjudicar o descartar.
8. Registrar tiempos de copia, restauración, arranque y disponibilidad. Habilitar consolas/trabajadores solo después de revisar integridad. La partida permanece pausada hasta la decisión operativa.

El procedimiento conserva el estado al punto de la copia. No demuestra recuperación de cambios posteriores, réplica remota, cifrado/custodia de un respaldo real, restauración en la infraestructura de Polla/Fabuloso o recuperación de secretos externos. En producción deben acordarse almacenamiento protegido, retención, responsable, acceso a `DB_SECRET` y credenciales, herramienta de respaldo, RPO, RTO y recuperación desde otro equipo. Un respaldo de base no reemplaza esa custodia.

## Decisión de habilitación

Fabuloso debe registrar nombre, fecha y evidencia para: reglas definitivas; proveedor habilitado y capacidad real; infraestructura y navegador; dotación de contactos; custodia y recuperación; reportes y referencias reales de cuentas; procedimiento de incidencias y privacidad de transmisión.

Si una métrica local supera el objetivo de dos segundos, conservar el resultado y tratarla como bloqueo de rendimiento bajo ese escenario. No sustituirlo por el tiempo del evaluador puro o por HTTP sin consola. Una prueba local aprobada tampoco acredita por sí sola la red remota del evento.

No se envían mensajes, abonan premios o despliega el piloto como consecuencia de ejecutar este guion.
