import React, { useEffect, useState } from 'react';
import { request } from '../pilot-api';
const labels = {
  detected: 'Detectado',
  contacting: 'Contactando',
  awaiting_response: 'Esperando respuesta',
  confirmed: 'Confirmado por respuesta oportuna',
  discarded: 'Descartado',
  delivered: 'Entregado'
};
export function remainingSeconds(expiresAt, serverTime, elapsedMs = 0) {
  if (!expiresAt || !serverTime) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.parse(serverTime) - elapsedMs) / 1000));
}
export default function ContactWorkflow({ contact, root, token, permissions, busy, run, mutate, onContact }) {
  const [channel, setChannel] = useState(''),
    [evidence, setEvidence] = useState(''),
    [receivedAt, setReceivedAt] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(performance.now() - start), 250);
    return () => clearInterval(timer);
  }, [contact]);
  useEffect(() => {
    setChannel('');
    setEvidence('');
    setReceivedAt('');
    setReviewed(false);
  }, [contact.candidateId]);
  useEffect(() => {
    let active = true,
      pending = false;
    const timer = setInterval(async () => {
      if (pending || busy) return;
      pending = true;
      try {
        const next = await request(`${root}/candidates/${contact.candidateId}/contact`, token);
        if (active) onContact(next);
      } catch (failure) {
        // Keep the last server anchor; the stale indicator disables decisions.
      } finally {
        pending = false;
      }
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [root, contact.candidateId, token, busy]);
  const workflow = contact.workflow;
  if (!workflow) return null;
  const seconds = remainingSeconds(workflow.expiresAt, contact.serverTime, elapsed),
    stale = elapsed > 5000,
    canOperate = permissions.includes('game:operate'),
    canConfirm = permissions.includes('results:confirm'),
    resolved = ['confirmed', 'discarded', 'delivered'].includes(workflow.state),
    eligible = workflow.cohort === 'primary' && !resolved;
  async function action(path, body) {
    await mutate(`candidates/${contact.candidateId}/${path}`, body);
    onContact(await request(`${root}/candidates/${contact.candidateId}/contact`, token));
    setEvidence('');
    setReviewed(false);
  }
  return (
    <section aria-label="Seguimiento de contacto">
      <h4>Seguimiento de contacto · {labels[workflow.state]}</h4>
      {workflow.recipient && (
        <p>
          Destinatario del intento: {workflow.channel} · {workflow.recipient}.
        </p>
      )}
      {workflow.contactStartedAt && (
        <p>
          Aviso exitoso: {workflow.contactStartedAt} · vence: {workflow.expiresAt}.
        </p>
      )}
      {seconds !== null && !resolved && (
        <p role="timer" aria-live="off">
          {seconds > 0
            ? `${seconds} segundos restantes (estimación)`
            : 'Plazo vencido: conciliar respuesta o descarte'}
        </p>
      )}
      {stale && !resolved && (
        <p role="status">Sin sincronización reciente. Actualiza el contacto antes de resolver.</p>
      )}
      {workflow.resolution && (
        <p>
          Resolución: {workflow.resolution}. Recepción: {workflow.responseReceivedAt || 'sin respuesta'}.
        </p>
      )}
      <button
        disabled={busy}
        onClick={() =>
          run(async () =>
            onContact(await request(`${root}/candidates/${contact.candidateId}/contact`, token))
          )
        }
      >
        Actualizar contacto y reloj
      </button>
      {eligible && (canOperate || canConfirm) && (
        <React.Fragment>
          <label>
            Evidencia de contacto o respuesta
            <textarea
              required
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          {canOperate && ['detected', 'contacting'].includes(workflow.state) && (
            <React.Fragment>
              <label>
                Canal registrado
                <select
                  aria-label="Canal registrado"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  <option value="">Seleccionar…</option>
                  {contact.email && <option value="email">Email · {contact.email}</option>}
                  {contact.phone && <option value="whatsapp">WhatsApp · {contact.phone}</option>}
                </select>
              </label>
              <button
                disabled={busy || !channel || !evidence.trim()}
                onClick={() => run(() => action('begin', { channel, evidence }))}
              >
                Registrar intento de contacto
              </button>
            </React.Fragment>
          )}
          {canOperate && workflow.state === 'contacting' && (
            <React.Fragment>
              <p>
                Confirma el aviso al destinatario registrado solo después de realizarlo. No se envían mensajes
                desde aquí.
              </p>
              <button
                disabled={busy || !evidence.trim()}
                onClick={() => run(() => action('notice', { success: true, evidence }))}
              >
                Confirmar aviso exitoso e iniciar 60 segundos
              </button>
              <button
                disabled={busy || !evidence.trim()}
                onClick={() => run(() => action('notice', { success: false, evidence }))}
              >
                Registrar aviso fallido sin iniciar plazo
              </button>
            </React.Fragment>
          )}
          {canConfirm && workflow.state === 'awaiting_response' && (
            <React.Fragment>
              <label>
                Hora de recepción de respuesta (ISO con zona horaria)
                <input
                  value={receivedAt}
                  placeholder="2026-11-16T21:30:00-03:00"
                  onChange={(e) => setReceivedAt(e.target.value)}
                />
              </label>
              <p>
                Registra la hora que acredita el canal. Una recepción posterior al vencimiento queda
                descartada.
              </p>
              <button
                disabled={busy || stale || !receivedAt || !evidence.trim()}
                onClick={() => run(() => action('respond', { receivedAt, evidence }))}
              >
                Registrar respuesta y resolver
              </button>
              <label>
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                Revisé el canal: no hay respuesta oportuna pendiente de registrar.
              </label>
              <button
                disabled={busy || stale || seconds !== 0 || !reviewed || !evidence.trim()}
                onClick={() => run(() => action('discard', { reviewedNoTimelyResponse: reviewed, evidence }))}
              >
                Resolver descarte por falta de respuesta
              </button>
            </React.Fragment>
          )}
        </React.Fragment>
      )}
      {workflow.cohort === 'reserve' && (
        <p>Reserva: requiere habilitación según reparto; no inicia contacto por este pozo.</p>
      )}
      <details>
        <summary>Historial privado de contacto</summary>
        <ul>
          {(contact.events || []).map((event) => (
            <li key={event._id}>
              {event.occurredAt} · {event.action} · operador {event.actorId} · {event.channel} ·{' '}
              {event.recipient}
              {event.receivedAt && ` · recepción ${event.receivedAt}`} · {event.evidence}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
