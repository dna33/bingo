import GamePanel from './GamePanel';
import DeliveryPanel from './DeliveryPanel';
import CardPanel from './CardPanel';
import React, { useEffect, useRef, useState } from 'react';
import { request, login, newId, fileBase64, base } from '../pilot-api';
const labels = {
  preparation: 'Preparación',
  ready: 'Lista',
  playing: 'En juego',
  paused: 'Pausada',
  finished: 'Finalizada',
  staged: 'Pendiente de incorporación',
  applied: 'Incorporada',
  correct: 'Datos corregidos',
  separate: 'Persona distinta',
  link: 'Vínculo confirmado',
  exclude: 'Fila excluida',
  valid: 'Válida',
  invalid: 'Inválida',
  duplicate: 'Duplicada',
  conflict: 'Conflicto',
  resolved: 'Resuelta',
  email_format: 'Email ausente o inválido',
  phone_format: 'Teléfono inválido: incluye + y código de país',
  external_id_format: 'Identificador inválido',
  name_format: 'Nombre inválido',
  column_count: 'Cantidad de columnas incorrecta',
  shared_contact_requires_resolution: 'Contacto compartido: confirma identidad con Polla',
  identity_contacts_changed: 'El identificador coincide, pero cambiaron sus datos',
  contact_name_changed: 'Mismos contactos, nombre diferente',
  inactive_participant_requires_resolution: 'Participante inactivo: requiere vínculo explícito',
  external_id_already_used: 'El identificador ya pertenece a otra persona',
  external_id_mismatch: 'Los identificadores no coinciden',
  link_target_missing: 'No se encontró el participante para vincular'
};
function Resolution({ row, onSave, busy }) {
  const data = row.effective || {};
  const [kind, setKind] = useState('correct');
  const [reference, setReference] = useState('');
  const [target, setTarget] = useState((row.suggestedParticipantIds || [])[0] || '');
  const [values, setValues] = useState({
    email: data.email || '',
    telefono: data.phone || '',
    jugador_id: data.externalId || '',
    nombre: data.name || ''
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          kind,
          pollaReference: reference,
          ...(kind === 'exclude' ? {} : { corrected: values }),
          ...(kind === 'link' ? { participantId: target } : {})
        });
      }}
    >
      <h3>Resolver fila {row.rowNumber}</h3>

      <label>
        Tratamiento
        <select aria-label="Tratamiento" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="correct">Corregir datos según Polla</option>
          <option value="separate">Mantener como persona distinta</option>

          <option value="link">Vincular con participante existente</option>
          <option value="exclude">Excluir fila con respaldo de Polla</option>
        </select>
      </label>
      {kind !== 'exclude' &&
        Object.keys(values).map((key) => (
          <label key={key}>
            {key}
            <input
              required={key === 'email' || key === 'telefono'}
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </label>
        ))}
      {kind === 'link' && (
        <label>
          Identificador interno del participante
          <input required value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      )}

      <label>
        Referencia o aclaración de Polla
        <input required maxLength={1000} value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>

      <p>
        Excluir una fila no da de baja a un participante existente. Sus cambios de actividad se registran por
        separado.
      </p>

      <button disabled={busy}>Guardar resolución</button>
    </form>
  );
}
export default function PilotConsole() {
  const [token, setToken] = useState(localStorage.getItem('admin-token'));
  const [staff, setStaff] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editions, setEditions] = useState([]);
  const [edition, setEdition] = useState(null);
  const [name, setName] = useState('');
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [file, setFile] = useState(null);
  const [source, setSource] = useState('');
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState(null);
  const [activityId, setActivityId] = useState('');
  const [activityRef, setActivityRef] = useState('');
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const errorRef = useRef(null);
  const can = (permission) => staff && staff.permissions.includes(permission);
  async function run(work) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);
  async function session(value) {
    const me = await request('/me', value);
    const list = await request('/editions?limit=500', value);
    setStaff(me);
    setEditions(list);
  }
  useEffect(() => {
    if (token) run(() => session(token));
  }, []);
  async function refresh(id, importId, page = 0) {
    const root = `/editions/${id}`;
    setEdition(await request(root, token));
    if (can('imports:read') && can('contacts:read')) {
      setFiles(await request(root + '/imports', token));
      setReport(await request(root + '/reconciliation', token));
      if (importId)
        setPreview(await request(root + `/imports/${importId}/preview?limit=50&offset=${page}`, token));
    }
    setOffset(page);
  }
  async function mutate(path, body, importId) {
    await request(`/editions/${edition._id}${path}`, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': `console-${newId()}` },
      body: JSON.stringify({ expectedVersion: edition.version, ...body })
    });
    await refresh(edition._id, importId);
    setResolving(null);
    setNotice('Operación registrada.');
  }
  function logout() {
    localStorage.removeItem('admin-token');
    setToken(null);
    setStaff(null);
    setEdition(null);
    setPreview(null);
    setReport(null);
    setFiles([]);
    setPassword('');
    setError('');
  }
  async function downloadOriginal() {
    const response = await fetch(`${base}/editions/${edition._id}/imports/${preview.importId}/original`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('No se pudo recuperar el archivo original.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = preview.filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  const editable =
    can('imports:write') &&
    edition &&
    !edition.listClosedAt &&
    !(report && report.listClosed) &&
    edition.state === 'preparation';
  return (
    <main className="pilot-console" aria-busy={busy}>
      <header>
        <h1>Bingo Fabuloso · Participantes</h1>
        {token && (
          <button onClick={logout} disabled={busy}>
            Cerrar sesión
          </button>
        )}
      </header>
      {error && (
        <div ref={errorRef} role="alert" tabIndex={-1}>
          <h2>No se pudo completar la operación</h2>
          <p>{error}</p>
        </div>
      )}
      {busy && <p role="status">Procesando…</p>}
      {notice && <p role="status">{notice}</p>}
      {!staff ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const value = await login(email, password);
              await session(value);
              localStorage.setItem('admin-token', value);
              setToken(value);
              setPassword('');
            });
          }}
        >
          <h2>Acceso del equipo de Fabuloso</h2>

          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button disabled={busy}>Iniciar sesión</button>
        </form>
      ) : (
        <React.Fragment>
          <section>
            <h2>Edición</h2>

            <label>
              Selecciona una edición
              <select
                aria-label="Selecciona una edición"
                value={edition ? edition._id : ''}
                disabled={busy}
                onChange={(e) => {
                  const id = e.target.value;
                  setPreview(null);
                  setReport(null);
                  setFiles([]);
                  setResolving(null);
                  if (id) run(() => refresh(id));
                  else setEdition(null);
                }}
              >
                <option value="">Seleccionar…</option>
                {editions.map((e) => (
                  <option key={e._id} value={e._id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            {can('editions:configure') && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const editionId = newId();
                    await request('/editions', token, {
                      method: 'POST',
                      body: JSON.stringify({ editionId, name })
                    });
                    setEditions(await request('/editions?limit=500', token));
                    await refresh(editionId);
                    setName('');
                  });
                }}
              >
                <label>
                  Nombre de nueva edición
                  <input required maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
                </label>

                <button disabled={busy}>Crear edición</button>
              </form>
            )}
            {can('legacy:manage') && (
              <p>
                <a href="back-office.html?legacy=1">Administración heredada de usuarios</a>
              </p>
            )}
          </section>
          {edition && (
            <React.Fragment>
              <p>
                Estado: {labels[edition.state]}. Versión operativa: {edition.version}.
              </p>

              <button
                disabled={busy}
                onClick={() => run(() => refresh(edition._id, preview && preview.importId, offset))}
              >
                Actualizar datos
              </button>
              {can('deliveries:read') && can('contacts:read') && (
                <DeliveryPanel
                  key={`delivery-${edition._id}`}
                  edition={edition}
                  token={token}
                  permissions={staff.permissions}
                  onChanged={() => refresh(edition._id, preview && preview.importId, offset)}
                />
              )}
              <GamePanel
                key={`game-${edition._id}`}
                edition={edition}
                token={token}
                permissions={staff.permissions}
                onChanged={() => refresh(edition._id, preview && preview.importId, offset)}
              />
              <CardPanel
                key={edition._id}
                edition={edition}
                token={token}
                permissions={staff.permissions}
                onChanged={() => refresh(edition._id, preview && preview.importId, offset)}
              />
              {!can('imports:read') || !can('contacts:read') ? (
                <p>Tu rol no permite consultar archivos con datos personales.</p>
              ) : (
                <React.Fragment>
                  <section>
                    <h2>Recibir lista de Polla</h2>

                    <p>
                      CSV UTF-8 separado por comas. Encabezados email y telefono; jugador_id y nombre son
                      opcionales. Máximo 5 MiB por archivo.
                    </p>
                    {editable && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          run(async () => {
                            if (!file || file.size > 5 * 1024 * 1024)
                              throw new Error('Selecciona un CSV de hasta 5 MiB.');
                            const result = await request(`/editions/${edition._id}/imports`, token, {
                              method: 'POST',
                              headers: { 'Idempotency-Key': `upload-${newId()}` },
                              body: JSON.stringify({
                                expectedVersion: edition.version,
                                filename: file.name,
                                sourceReference: source,
                                contentBase64: await fileBase64(file)
                              })
                            });
                            await refresh(edition._id, result.importId);
                            setNotice(
                              result.reused
                                ? 'El archivo ya estaba registrado. Se conservó la importación original.'
                                : 'Archivo recibido. Revisa las filas antes de incorporar.'
                            );
                          });
                        }}
                      >
                        <label>
                          Archivo CSV
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            required
                            onChange={(e) => setFile(e.target.files[0])}
                          />
                        </label>

                        <label>
                          Versión o referencia de Polla
                          <input
                            required
                            maxLength={1000}
                            value={source}
                            onChange={(e) => setSource(e.target.value)}
                          />
                        </label>

                        <button disabled={busy}>Cargar y previsualizar</button>
                      </form>
                    )}

                    <label>
                      Versiones recibidas
                      <select
                        aria-label="Versiones recibidas"
                        value={preview ? preview.importId : ''}
                        disabled={busy}
                        onChange={(e) => {
                          const value = e.target.value;
                          setResolving(null);
                          if (value) run(() => refresh(edition._id, value));
                          else setPreview(null);
                        }}
                      >
                        <option value="">Seleccionar…</option>
                        {files.map((f) => (
                          <option key={f._id} value={f._id}>
                            Versión {f.version} · {f.filename} · {labels[f.status]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </section>
                  {preview && (
                    <section>
                      <h2>Previsualización · versión {preview.importVersion}</h2>

                      <p>
                        {preview.summary.rows} filas · {preview.summary.valid} válidas ·{' '}
                        {preview.summary.invalid} inválidas · {preview.summary.duplicates} duplicadas ·{' '}
                        {preview.summary.conflicts} con conflictos · {preview.summary.resolved} resueltas.
                      </p>

                      <button disabled={busy} onClick={() => run(downloadOriginal)}>
                        Descargar original
                      </button>

                      <div className="pilot-table">
                        <table>
                          <caption>
                            Filas {offset + 1} a {Math.min(offset + 50, preview.summary.rows)}. Las filas
                            inválidas no se descartan.
                          </caption>

                          <thead>
                            <tr>
                              <th>Fila CSV</th>
                              <th>Email y teléfono originales</th>
                              <th>Estado y motivos</th>
                              <th>Resolución</th>
                            </tr>
                          </thead>

                          <tbody>
                            {preview.rows.map((row) => (
                              <tr key={row.id}>
                                <td>{row.rowNumber}</td>
                                <td>
                                  {row.values.email}
                                  <br />
                                  {row.values.telefono}
                                </td>

                                <td>
                                  {labels[row.status]}
                                  {row.outcome === 'excluded' && ' · Excluida con respaldo'}
                                  <ul>
                                    {row.issues.map((issue) => (
                                      <li key={issue}>{labels[issue] || issue}</li>
                                    ))}
                                  </ul>
                                  {row.targetId && <small>Participante: {row.targetId}</small>}
                                </td>

                                <td>
                                  {row.decision && (
                                    <p>
                                      {labels[row.decision.kind]} · {row.decision.pollaReference}
                                    </p>
                                  )}
                                  {editable && preview.state === 'staged' && (
                                    <button
                                      disabled={busy}
                                      onClick={() => setResolving(resolving === row.id ? null : row.id)}
                                    >
                                      Resolver fila {row.rowNumber}
                                    </button>
                                  )}
                                  {resolving === row.id && (
                                    <Resolution
                                      key={row.id}
                                      row={row}
                                      busy={busy}
                                      onSave={(decision) =>
                                        run(() =>
                                          mutate(
                                            `/imports/${preview.importId}/rows/${row.id}/resolve`,
                                            { decision },
                                            preview.importId
                                          )
                                        )
                                      }
                                    />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <button
                        disabled={busy || offset === 0}
                        onClick={() =>
                          run(() => refresh(edition._id, preview.importId, Math.max(0, offset - 50)))
                        }
                      >
                        Anterior
                      </button>

                      <button
                        disabled={busy || offset + 50 >= preview.summary.rows}
                        onClick={() => run(() => refresh(edition._id, preview.importId, offset + 50))}
                      >
                        Siguiente
                      </button>
                      {editable && preview.state === 'staged' && (
                        <button
                          disabled={busy || preview.summary.invalid > 0 || preview.summary.conflicts > 0}
                          onClick={() =>
                            run(() => mutate(`/imports/${preview.importId}/apply`, {}, preview.importId))
                          }
                        >
                          Incorporar esta versión
                        </button>
                      )}
                    </section>
                  )}
                  {report && (
                    <section>
                      <h2>Conciliación de la lista aprobada</h2>

                      <p>
                        {report.approvedImportId
                          ? `Versión ${report.importVersion} · ${report.sourceReference}`
                          : 'Todavía no hay una lista incorporada.'}
                      </p>

                      <p>
                        {report.uniqueParticipants} participantes únicos · {report.activeParticipants} activos
                        · {report.issuedCards} cartones · {report.excludedRows} filas excluidas con respaldo.
                      </p>

                      <ul>
                        <li>Filas sin resolver: {report.unresolvedRows.length}</li>
                        <li>Participantes faltantes: {report.missingParticipantIds.length}</li>

                        <li>Activos ajenos a esta versión: {report.extraParticipantIds.length}</li>
                        <li>Sin cartón: {report.withoutCardIds.length}</li>
                        <li>Sin PDF: {(report.withoutPdfIds || []).length}</li>

                        <li>
                          Problemas de trazabilidad:{' '}
                          {report.untraceableParticipantIds.length + report.inconsistentCardIds.length}
                        </li>
                        <li>Versiones nuevas pendientes: {report.pendingFiles}</li>
                      </ul>
                      {report.extraParticipantIds.length > 0 && (
                        <p>IDs activos que no figuran en la lista: {report.extraParticipantIds.join(', ')}</p>
                      )}
                      {report.listClosed ? (
                        <p>Lista cerrada. Los participantes y cartones quedan congelados.</p>
                      ) : (
                        <p>El cierre exige conciliación completa y un cartón con PDF por participante.</p>
                      )}
                      {editable && (
                        <React.Fragment>
                          <button
                            disabled={busy || !report.canClose}
                            onClick={() =>
                              run(() => mutate('/participants/close', {}, preview && preview.importId))
                            }
                          >
                            Cerrar lista conciliada
                          </button>

                          <details>
                            <summary>Alta o baja respaldada por Polla</summary>
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                run(() =>
                                  mutate(
                                    `/participants/${activityId}/activity`,
                                    { active, pollaReference: activityRef },
                                    preview && preview.importId
                                  )
                                );
                              }}
                            >
                              <label>
                                Identificador interno
                                <input
                                  required
                                  value={activityId}
                                  onChange={(e) => setActivityId(e.target.value)}
                                />
                              </label>

                              <label>
                                Actividad
                                <select
                                  aria-label="Actividad"
                                  value={String(active)}
                                  onChange={(e) => setActive(e.target.value === 'true')}
                                >
                                  <option value="false">Dar de baja</option>
                                  <option value="true">Reactivar</option>
                                </select>
                              </label>

                              <label>
                                Respaldo de Polla
                                <input
                                  required
                                  value={activityRef}
                                  onChange={(e) => setActivityRef(e.target.value)}
                                />
                              </label>
                              <button disabled={busy}>Registrar cambio de actividad</button>
                            </form>
                          </details>
                        </React.Fragment>
                      )}
                    </section>
                  )}
                </React.Fragment>
              )}
            </React.Fragment>
          )}
        </React.Fragment>
      )}
    </main>
  );
}
