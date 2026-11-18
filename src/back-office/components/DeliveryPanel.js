import React, { useEffect, useRef, useState } from 'react';
import { request, newId } from '../pilot-api';
const states = {
  pending: 'Pendiente',
  processing: 'Procesando',
  uncertain: 'Resultado incierto',
  provider_accepted: 'Aceptado por el proveedor',
  delivered: 'Entrega confirmada',
  bounced: 'Rebotado',
  failed: 'Fallido'
};
const scenarios = {
  accepted: 'Aceptación sin confirmar entrega',
  delivered: 'Entrega confirmada simulada',
  bounced: 'Rebote simulado',
  transient_failure: 'Fallo temporal y recuperación',
  temporary_outage: 'Fallo temporal persistente (agota reintentos)',
  permanent_failure: 'Fallo permanente',
  timeout_before_accept: 'Timeout antes de aceptar',
  timeout_after_accept: 'Timeout después de aceptar',
  unknown: 'Incertidumbre que requiere aclaración'
};
export default function DeliveryPanel({ edition, token, permissions, onChanged }) {
  const [summary, setSummary] = useState(null),
    [jobs, setJobs] = useState([]),
    [offset, setOffset] = useState(0);
  const [channel, setChannel] = useState('email'),
    [simulation, setSimulation] = useState('accepted');
  const [filter, setFilter] = useState(''),
    [busy, setBusy] = useState(false),
    [processing, setProcessing] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [action, setAction] = useState(null),
    [reason, setReason] = useState(''),
    [eventStatus, setEventStatus] = useState('delivered');
  const [history, setHistory] = useState(null);
  const mounted = useRef(false),
    continuing = useRef(false),
    errorRef = useRef(null);
  const canManage = permissions.includes('deliveries:manage');
  const root = `/editions/${edition._id}/deliveries`;
  async function refresh(page = offset, selected = filter) {
    const next = await request(root + '/summary', token);
    const list = await request(
      `${root}?limit=25&offset=${page}${selected ? `&state=${selected}` : ''}`,
      token
    );
    if (mounted.current) {
      setSummary(next);
      setJobs(list);
      setOffset(page);
    }
    return next;
  }
  async function run(work) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProcessing(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    run(() => refresh(0));
    return () => {
      mounted.current = false;
      continuing.current = false;
    };
  }, [edition._id, edition.version]);
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);
  const mutate = (path, body, version = summary.version) =>
    request(root + path, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': `delivery-${newId()}` },
      body: JSON.stringify({ expectedVersion: version, ...body })
    });
  async function queue() {
    let version = summary.version,
      remaining;
    do {
      const result = await mutate('/enqueue', { channel, simulation, limit: 100 }, version);
      version = result.version;
      remaining = result.remaining;
    } while (remaining && mounted.current);
    if (mounted.current) {
      await refresh(0);
      await onChanged();
      setNotice('Cola guardada. Ningún mensaje real fue enviado.');
    }
  }
  async function process() {
    continuing.current = true;
    setProcessing(true);
    do {
      const result = await request(root + '/process', token, {
        method: 'POST',
        body: JSON.stringify({ limit: 25 })
      });
      const next = await refresh();
      if (!(next.counts.pending || next.counts.processing)) break;
      if (continuing.current && mounted.current)
        await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs));
    } while (continuing.current && mounted.current);
    continuing.current = false;
    if (mounted.current)
      setNotice('Procesamiento simulado guardado. Revisa los resultados inciertos y las incidencias.');
  }
  async function perform() {
    const job = action.job;
    if (action.kind === 'reconcile') {
      await request(`${root}/${job._id}/reconcile`, token, { method: 'POST', body: '{}' });
    } else if (action.kind === 'event') {
      await mutate(`/${job._id}/mock-event`, {
        eventKey: `mock-${newId()}`,
        providerKey: job.providerKey,
        status: eventStatus
      });
    } else {
      await mutate(`/${job._id}/${action.kind}`, {
        reason,
        simulation,
        ...(action.kind === 'resend' ? { channel } : {})
      });
    }
    await refresh();
    await onChanged();
    setAction(null);
    setReason('');
    setNotice('Operación simulada registrada. Se conservan el cartón y el PDF originales.');
  }
  return (
    <section aria-label="Entrega simulada de PDF" aria-busy={busy}>
      <h2>Entrega de PDFs · simulación</h2>
      <p>
        <strong>Proveedor exclusivamente simulado. No envía emails ni documentos de WhatsApp reales.</strong>
      </p>
      <p>
        Aceptado por el proveedor no significa entregado ni leído. Un fallo no elimina al participante ni su
        cartón.
      </p>
      {error && (
        <div ref={errorRef} role="alert" tabIndex={-1}>
          <p>{error}</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!summary ? (
        <p role="status">Cargando entregas…</p>
      ) : (
        <React.Fragment>
          <p role="status">
            {summary.initialQueued} entregas iniciales en cola · {summary.unqueued} participantes sin encolar.
          </p>
          <ul>
            {Object.entries(states).map(([key, label]) => (
              <li key={key}>
                {label}: {summary.counts[key] || 0}
              </li>
            ))}
          </ul>
          {canManage && (
            <React.Fragment>
              <label>
                Canal simulado
                <select
                  aria-label="Canal simulado"
                  value={channel}
                  disabled={busy}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="email">Email simulado</option>
                  <option value="whatsapp">WhatsApp simulado</option>
                </select>
              </label>
              <label>
                Comportamiento del proveedor simulado
                <select
                  aria-label="Comportamiento del proveedor simulado"
                  disabled={busy}
                  value={simulation}
                  onChange={(e) => setSimulation(e.target.value)}
                >
                  {Object.entries(scenarios).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {!edition.listClosedAt && (
                <p>Cierra primero la lista conciliada con sus cartones y PDFs completos.</p>
              )}
              <button
                disabled={busy || !edition.listClosedAt || !summary.unqueued}
                onClick={() => run(queue)}
              >
                Encolar PDFs pendientes
              </button>
              <button disabled={busy || !Object.keys(summary.counts).length} onClick={() => run(process)}>
                Procesar cola simulada
              </button>
              {processing && (
                <button
                  onClick={() => {
                    continuing.current = false;
                    setNotice('Se detendrá después del lote en curso.');
                  }}
                >
                  Pausar procesamiento simulado
                </button>
              )}
              <p>
                También puedes ejecutar el procesador local para que continúe sin mantener esta pantalla
                abierta.
              </p>
            </React.Fragment>
          )}
          <button disabled={busy} onClick={() => run(() => refresh())}>
            Actualizar entregas
          </button>
          <label>
            Filtrar entregas
            <select
              aria-label="Filtrar entregas"
              value={filter}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value;
                setFilter(value);
                run(() => refresh(0, value));
              }}
            >
              <option value="">Todos los estados</option>
              {Object.entries(states).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="pilot-table">
            <table>
              <caption>Entregas individuales · página {Math.floor(offset / 25) + 1}</caption>
              <thead>
                <tr>
                  <th>Cartón y tipo</th>
                  <th>Destinatario registrado</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job._id}>
                    <td>
                      {job.cardId}
                      <br />
                      {job.kind === 'initial' ? 'Inicial' : 'Reenvío explícito'}
                    </td>
                    <td>
                      {job.recipient}
                      <br />
                      {job.channel === 'email' ? 'Email' : 'WhatsApp'} · simulado
                    </td>
                    <td>
                      {states[job.state]}
                      <br />
                      Intentos: {job.attemptCount}
                      {job.errorCode && <p>Incidencia: {job.errorCode}</p>}
                    </td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const attempts = await request(`${root}/${job._id}/attempts`, token),
                              detail = await request(`${root}/${job._id}`, token);
                            setHistory({ job, attempts, detail });
                          })
                        }
                      >
                        Ver historial {job._id}
                      </button>
                      {canManage && (
                        <React.Fragment>
                          {['uncertain', 'provider_accepted', 'processing'].includes(job.state) && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                setAction({ kind: 'reconcile', job });
                                setReason('');
                              }}
                            >
                              Reconciliar {job._id}
                            </button>
                          )}
                          {['failed', 'bounced'].includes(job.state) && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                setAction({ kind: 'retry', job });
                                setReason('');
                              }}
                            >
                              Reintentar {job._id}
                            </button>
                          )}
                          {['failed', 'bounced', 'provider_accepted', 'delivered'].includes(job.state) && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                setAction({ kind: 'resend', job });
                                setReason('');
                              }}
                            >
                              Reenviar {job._id}
                            </button>
                          )}
                          {job.providerKey && job.state !== 'processing' && (
                            <button disabled={busy} onClick={() => setAction({ kind: 'event', job })}>
                              Simular confirmación {job._id}
                            </button>
                          )}
                        </React.Fragment>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || offset === 0}
            onClick={() => run(() => refresh(Math.max(0, offset - 25)))}
          >
            Entregas anteriores
          </button>
          <button disabled={busy || jobs.length < 25} onClick={() => run(() => refresh(offset + 25))}>
            Más entregas
          </button>
          {action && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(perform);
              }}
            >
              <h3>
                {action.kind === 'resend'
                  ? 'Reenvío explícito del mismo PDF'
                  : action.kind === 'retry'
                    ? 'Nuevo intento con el mismo destinatario'
                    : action.kind === 'event'
                      ? 'Confirmación del proveedor simulado'
                      : 'Reconciliar el resultado incierto'}
              </h3>
              <p>
                Entrega {action.job._id} · cartón {action.job.cardId}. Solo se usan los contactos registrados
                de esa persona.
              </p>
              {['retry', 'resend'].includes(action.kind) && (
                <label>
                  Motivo del reenvío o reintento
                  <input
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              {action.kind === 'resend' && (
                <p>
                  Canal seleccionado: {channel === 'email' ? 'Email' : 'WhatsApp'}. Se conservará el intento
                  anterior.
                </p>
              )}
              {action.kind === 'event' && (
                <label>
                  Resultado simulado
                  <select
                    aria-label="Resultado simulado"
                    value={eventStatus}
                    onChange={(e) => setEventStatus(e.target.value)}
                  >
                    <option value="delivered">Entrega confirmada</option>
                    <option value="bounced">Rebotado</option>
                    <option value="provider_accepted">Aceptado sin confirmar entrega</option>
                    <option value="not_accepted">No aceptado (solo si no existe aceptación)</option>
                  </select>
                </label>
              )}
              <button disabled={busy}>Registrar operación simulada</button>
              <button type="button" disabled={busy} onClick={() => setAction(null)}>
                Cancelar operación
              </button>
            </form>
          )}
          {history && (
            <aside aria-label="Historial de entrega">
              <h3>Historial de {history.job._id}</h3>
              {history.detail.reason && <p>Motivo: {history.detail.reason}</p>}
              <ul>
                {history.attempts.map((attempt) => (
                  <li key={attempt._id}>
                    Intento {attempt.attempt} · {states[attempt.state]} · {attempt.recipient} ·{' '}
                    {attempt.attemptedAt}
                    {attempt.errorCode && ` · ${attempt.errorCode}`}
                  </li>
                ))}
              </ul>
              <button onClick={() => setHistory(null)}>Cerrar historial</button>
            </aside>
          )}
        </React.Fragment>
      )}
    </section>
  );
}
