import React, { useEffect, useRef, useState } from 'react';
import { request, newId } from '../pilot-api';
import { proposedFigures, alternateMasks, masks } from '../game-patterns';
import CandidateAlerts from './CandidateAlerts';
import ContactWorkflow from './ContactWorkflow';
import PrizePanel from './PrizePanel';
const states = {
  preparation: 'Preparación',
  ready: 'Lista',
  playing: 'En juego',
  paused: 'Pausada',
  finished: 'Finalizada'
};
const policies = [
  [
    'roundMode',
    'Modalidad de rondas',
    [
      ['independent', 'Rondas independientes'],
      ['simultaneous', 'Todas las figuras activas']
    ]
  ],
  [
    'extractionMode',
    'Modalidad de extracción',
    [
      ['manual', 'Registrar bolillero físico'],
      ['digital', 'Extracción digital del servidor']
    ]
  ],
  [
    'repeatWinners',
    'Puede ganar varias figuras',
    [
      ['true', 'Sí'],
      ['false', 'No (solo rondas independientes)']
    ]
  ],
  [
    'pauseDuringContact',
    'Pausar al detectar candidatos',
    [
      ['true', 'Sí, hasta resolver respuestas'],
      ['false', 'No, conservar completaciones posteriores']
    ]
  ],
  [
    'roundingPolicy',
    'Política de pesos residuales',
    [['auditable_residual_draw', 'Sorteo auditable de residuos']]
  ],
  [
    'discardPolicy',
    'Parte de quienes no responden',
    [
      ['redistribute_confirmed', 'Redistribuir entre quienes respondieron'],
      ['redispute_remainder', 'Volver a disputar el remanente']
    ]
  ],
  [
    'noResponsePolicy',
    'Si nadie responde',
    [
      ['redispute_same_figure', 'Volver a disputar la figura'],
      ['advance_keep_unassigned', 'Avanzar y registrar el monto no asignado']
    ]
  ],
  [
    'contactClockStart',
    'Inicio del minuto',
    [['operator_confirms_notice', 'Cuando el operador confirma el aviso de premio']]
  ]
];
function maskClass(mask, position, matched, pending) {
  const required = mask[Math.floor(position / 5)] && mask[Math.floor(position / 5)][position % 5] === '1';
  return [
    'game-mask-cell',
    required && 'required',
    matched.includes(position) && 'matched',
    pending.includes(position) && 'pending'
  ]
    .filter(Boolean)
    .join(' ');
}
export function Mask({ mask, matched = [], pending = [], cells }) {
  return (
    <div
      className="game-mask"
      role="img"
      aria-label={`Máscara: ${mask.join(' / ')}. Uno indica casilla exigida y L es el centro libre.`}
    >
      {Array.from({ length: 25 }, (_, i) => (
        <span key={i} className={maskClass(mask, i, matched, pending)}>
          {i === 12
            ? 'L'
            : cells
              ? cells[i]
              : mask[Math.floor(i / 5)] && mask[Math.floor(i / 5)][i % 5] === '1'
                ? '×'
                : '·'}
        </span>
      ))}
    </div>
  );
}
export function DrawHistory({ draws }) {
  if (!draws.length) return null;
  return (
    <div className="game-draws" role="list" aria-label={`Bolillas extraídas: ${draws.length}`}>
      {draws.map((draw, i) => (
        <span
          key={draw._id}
          role="listitem"
          className={`game-ball${i === draws.length - 1 ? ' latest' : ''}`}
          title={`Extracción ${draw.sequence} · ${draw.drawnAt} · ${
            draw.origin === 'manual' ? 'registro físico' : 'digital'
          }`}
        >
          {draw.number}
        </span>
      ))}
    </div>
  );
}
export default function GamePanel({ edition, token, permissions, onChanged }) {
  const [frame, setFrame] = useState(null),
    [candidates, setCandidates] = useState([]),
    [contact, setContact] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [number, setNumber] = useState(''),
    [review, setReview] = useState(null),
    [reason, setReason] = useState('');
  const [incidentKind, setIncidentKind] = useState('operation'),
    [incidents, setIncidents] = useState(null);
  const [offset, setOffset] = useState(0),
    [cohort, setCohort] = useState('primary'),
    [historyRound, setHistoryRound] = useState('');
  const [draft, setDraft] = useState({
    roundMode: '',
    extractionMode: '',
    repeatWinners: '',
    pauseDuringContact: '',
    roundingPolicy: '',
    discardPolicy: '',
    noResponsePolicy: '',
    contactClockStart: '',
    maskReviewConfirmed: false,
    confirmationReference: '',
    nearMissThresholds: '1,2,3',
    figures: proposedFigures()
  });
  const mounted = useRef(false),
    writing = useRef(false),
    polling = useRef(false),
    version = useRef(-1),
    errorRef = useRef(null);
  const root = `/editions/${edition._id}/game`,
    canOperate = permissions.includes('game:operate'),
    canConfigure = permissions.includes('editions:configure');
  async function load(page = offset, selected = cohort, selectedRound = historyRound) {
    const next = await request(root, token);
    if (!mounted.current || next.version < version.current) return;
    version.current = next.version;
    setFrame(next);
    const roundId = selectedRound === 'all' ? null : selectedRound || (next.round && next.round._id);
    const rows = await request(
      `${root}/candidates?limit=25&offset=${page}&cohort=${selected}${roundId ? `&roundId=${roundId}` : ''}`,
      token
    );
    if (mounted.current && next.version >= version.current) {
      setCandidates(rows);
      setOffset(page);
    }
  }
  async function run(work) {
    writing.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    run(() => load(0));
    const timer = setInterval(async () => {
      if (writing.current || polling.current) return;
      polling.current = true;
      try {
        await load();
      } catch (failure) {
        if (mounted.current) setError('No se pudo actualizar la partida. Actualiza antes de continuar.');
      } finally {
        polling.current = false;
      }
    }, 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [edition._id, edition.version, cohort, historyRound]);
  useEffect(() => {
    if (error && errorRef.current) errorRef.current.focus();
  }, [error]);
  async function mutate(path, body = {}, expectedVersion = frame.version) {
    const target = path.startsWith('prizes/') ? `/editions/${edition._id}/${path}` : `${root}/${path}`;
    const result = await request(target, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': `game-${newId()}` },
      body: JSON.stringify({ expectedVersion, ...body })
    });
    if (['prepare', 'start', 'next-round', 'finish'].includes(path)) setContact(null);
    version.current = result.version;
    setReview(null);
    await load(0);
    await onChanged();
    setNotice(
      path === 'draw'
        ? `Número oficial confirmado: ${result.number}.`
        : 'Operación registrada en el historial oficial.'
    );
    return result;
  }
  const last = frame && frame.draws[frame.draws.length - 1];
  const pendingContact =
    frame &&
    frame.rules &&
    (frame.rules.pauseDuringContact || !frame.rules.repeatWinners) &&
    frame.pendingPrimaryCandidates > 0;
  return (
    <section aria-label="Partida oficial" aria-busy={busy}>
      <h2>Partida oficial</h2>
      <p>
        La secuencia del servidor es la oficial. Todos los cartones habilitados se evalúan aunque sus
        titulares estén desconectados.
      </p>
      {error && (
        <div role="alert" tabIndex={-1} ref={errorRef}>
          <p>{error}</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!frame ? (
        <p role="status">Cargando partida…</p>
      ) : (
        <React.Fragment>
          <p role="status">
            Estado: {states[frame.state]} · {frame.rosterCount} cartones congelados · versión {frame.version}.
          </p>
          <p className="game-current">
            Último número oficial: {last ? last.number : '—'}
            {last && ` · extracción ${last.sequence}`}
          </p>
          <DrawHistory draws={frame.draws} />
          <button disabled={busy} onClick={() => run(() => load())}>
            Actualizar partida
          </button>
          {frame.rules && (
            <p>
              Reglas confirmadas, versión {frame.rulesVersion}.{' '}
              {frame.rules.roundMode === 'independent' ? 'Rondas independientes' : 'Figuras simultáneas'} ·{' '}
              {frame.rules.extractionMode === 'manual' ? 'Bolillero físico registrado' : 'Extracción digital'}
              .
            </p>
          )}
          {canConfigure && frame.state === 'preparation' && (
            <details open={!frame.rules}>
              <summary>Configurar figuras y reglas del juego</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const included = draft.figures.filter((f) => f.included);
                  run(() =>
                    mutate('configure', {
                      settings: {
                        ...draft,
                        repeatWinners: draft.repeatWinners === 'true',
                        pauseDuringContact: draft.pauseDuringContact === 'true',
                        order: included.map((f) => f.name),
                        nearMissThresholds: draft.nearMissThresholds
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map(Number),
                        figures: included.map((f) => ({
                          name: f.name,
                          poolClp: Number(f.poolClp),
                          mask: f.mask.map((row) => row.trim()).filter(Boolean)
                        }))
                      }
                    })
                  );
                }}
              >
                {policies.map(([key, label, options]) => (
                  <label key={key}>
                    {label}
                    <select
                      aria-label={label}
                      required
                      value={draft[key]}
                      onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                    >
                      <option value="">Seleccionar…</option>
                      {options.map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Alertar cartones a N extracciones de completar (separadas por coma; vacío desactiva)
                  <input
                    value={draft.nearMissThresholds}
                    onChange={(e) => setDraft({ ...draft, nearMissThresholds: e.target.value })}
                  />
                </label>
                <p>
                  Los dibujos siguientes son referencias del brief: revísalos antes de confirmar. El centro L
                  es libre. Marca qué figuras participan de esta edición y su pozo; las que dejes sin marcar
                  no se juegan en absoluto (no abren ronda, no tienen pozo, no pueden detectarse ni pagar).
                  Asignado: ${draft.figures
                    .filter((f) => f.included)
                    .reduce((sum, f) => sum + (Number(f.poolClp) || 0), 0)
                    .toLocaleString('es-CL')}{' '}
                  de $400.000.
                </p>
                <div className="game-figures">
                  {draft.figures.map((figure, i) => (
                    <fieldset key={figure.name}>
                      <legend>Figura {figure.name}</legend>
                      <label>
                        <input
                          type="checkbox"
                          checked={figure.included}
                          onChange={(e) => {
                            const figures = draft.figures.map((f, j) =>
                              j === i ? { ...f, included: e.target.checked } : f
                            );
                            setDraft({ ...draft, figures });
                          }}
                        />
                        Incluir esta figura en la edición
                      </label>
                      <label>
                        Pozo de la figura {figure.name} (CLP)
                        <input
                          type="number"
                          min="0"
                          step="1"
                          disabled={!figure.included}
                          value={figure.poolClp}
                          onChange={(e) => {
                            const figures = draft.figures.map((f, j) =>
                              j === i ? { ...f, poolClp: e.target.value } : f
                            );
                            setDraft({ ...draft, figures });
                          }}
                        />
                      </label>
                      <Mask mask={figure.mask} />
                      {alternateMasks[figure.name] && (
                        <label>
                          Patrón {figure.name}
                          <select
                            value={
                              figure.mask.join('\n') === alternateMasks[figure.name].join('\n')
                                ? 'binguito'
                                : 'classic'
                            }
                            onChange={(e) => {
                              const mask =
                                e.target.value === 'binguito'
                                  ? [...alternateMasks[figure.name]]
                                  : [...masks[figure.name]];
                              const figures = draft.figures.map((f, j) => (j === i ? { ...f, mask } : f));
                              setDraft({ ...draft, figures });
                            }}
                          >
                            <option value="classic">Letra clásica</option>
                            <option value="binguito">Binguito</option>
                          </select>
                        </label>
                      )}
                      <label>
                        Máscara {figure.name}: cinco filas de 0 y 1
                        <textarea
                          required
                          rows={5}
                          value={figure.mask.join('\n')}
                          onChange={(e) => {
                            const figures = draft.figures.map((f, j) =>
                              j === i ? { ...f, mask: e.target.value.split('\n') } : f
                            );
                            setDraft({ ...draft, figures });
                          }}
                        />
                      </label>
                    </fieldset>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    required
                    checked={draft.maskReviewConfirmed}
                    onChange={(e) => setDraft({ ...draft, maskReviewConfirmed: e.target.checked })}
                  />
                  He revisado las máscaras y las reglas con el equipo de Fabuloso.
                </label>
                <label>
                  Referencia de confirmación de reglas
                  <input
                    required
                    maxLength={1000}
                    value={draft.confirmationReference}
                    onChange={(e) => setDraft({ ...draft, confirmationReference: e.target.value })}
                  />
                </label>
                <p>
                  Completar una figura genera candidatos pendientes de respuesta. No confirma un premio ni
                  inicia por sí solo el minuto de contacto.
                </p>
                <button disabled={busy}>Confirmar reglas del juego</button>
              </form>
            </details>
          )}
          {canOperate && (
            <div className="game-controls">
              {frame.state === 'preparation' && (
                <button
                  disabled={busy || !frame.rules || !edition.listClosedAt}
                  onClick={() => run(() => mutate('prepare'))}
                >
                  Validar y pasar a listo
                </button>
              )}
              {frame.state === 'ready' && (
                <button disabled={busy} onClick={() => run(() => mutate('start'))}>
                  Iniciar partida oficial
                </button>
              )}
              {frame.state === 'playing' && (
                <button disabled={busy} onClick={() => run(() => mutate('pause'))}>
                  Pausar partida
                </button>
              )}
              {frame.state === 'paused' && (
                <button
                  disabled={busy || (frame.rules.pauseDuringContact && frame.pendingPrimaryCandidates > 0)}
                  onClick={() => run(() => mutate('resume'))}
                >
                  Reanudar partida
                </button>
              )}
              {pendingContact && (
                <p>
                  Hay candidatos pendientes de respuesta. La política elegida puede impedir reanudar o avanzar
                  de ronda hasta resolverlos.
                </p>
              )}
              {frame.results.some((r) => r.state === 'detected') && (
                <p>Valida el reparto del pozo antes de avanzar a la siguiente figura.</p>
              )}
              {['playing', 'paused'].includes(frame.state) && frame.rules.roundMode === 'independent' && (
                <button
                  disabled={
                    busy ||
                    pendingContact ||
                    !frame.round ||
                    frame.round.ordinal >= 6 ||
                    !frame.results.some((r) => r.state !== 'open') ||
                    frame.results.some((r) => !['adjudicated', 'unassigned'].includes(r.state))
                  }
                  onClick={() => run(() => mutate('next-round'))}
                >
                  Siguiente ronda · reiniciar bolillas y marcas
                </button>
              )}
            </div>
          )}
          {canOperate &&
            frame.state === 'playing' &&
            frame.round &&
            (frame.rules.extractionMode === 'digital' ? (
              <button disabled={busy} onClick={() => run(() => mutate('draw', { roundId: frame.round._id }))}>
                Extraer número digital
              </button>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setReview({ number: Number(number), version: frame.version, roundId: frame.round._id });
                }}
              >
                <label>
                  Número del bolillero físico
                  <input
                    type="number"
                    required
                    min={frame.round.minNumber}
                    max={frame.round.maxNumber}
                    value={number}
                    onChange={(e) => {
                      setNumber(e.target.value);
                      setReview(null);
                    }}
                  />
                </label>
                <button disabled={busy}>Revisar número</button>
                {review && (
                  <div>
                    <p>Número pendiente de confirmación: {review.number}.</p>
                    {review.version !== frame.version && (
                      <p>La partida cambió. Revisa de nuevo el número antes de confirmarlo.</p>
                    )}
                    <button
                      type="button"
                      disabled={
                        busy || review.version !== frame.version || review.roundId !== frame.round._id
                      }
                      onClick={() =>
                        run(async () => {
                          await mutate(
                            'draw',
                            { number: review.number, roundId: review.roundId },
                            review.version
                          );
                          setNumber('');
                        })
                      }
                    >
                      Confirmar número {review.number}
                    </button>
                  </div>
                )}
              </form>
            ))}
          {frame.round && (
            <React.Fragment>
              <h3>
                Ronda {frame.round.ordinal + 1} · {frame.round.figures.join(', ')}
              </h3>
              <div className="game-figures">
                {frame.results.map((result) => {
                  const definition = frame.rules.figures.find((f) => f.name === result.figure),
                    advance = (frame.round.progress || []).find((p) => p.figure === result.figure),
                    near = advance && advance.nearCards[0];
                  return (
                    <article key={result._id}>
                      <h4>
                        Figura {result.figure} · ${result.poolClp.toLocaleString('es-CL')}
                      </h4>
                      <Mask mask={definition.mask} />
                      <p>
                        Primera bolilla: {result.firstSequence || 'pendiente'} ·{' '}
                        {result.primaryCandidateCount} candidatos
                        {result.primaryCandidateCount > 1 && ' empatados'}.
                      </p>
                      <p>Completaciones posteriores en reserva: {result.reserveCandidateCount}.</p>
                      {advance &&
                        (frame.rules.nearMissThresholds || [])
                          .filter((distance) => advance.proximityCounts && advance.proximityCounts[distance])
                          .map((distance) => {
                            const count = advance.proximityCounts[distance];
                            return (
                              <p key={distance} role="alert" className="game-near-miss-alert">
                                {count} {count > 1 ? 'cartones' : 'cartón'} a {distance}{' '}
                                {distance > 1 ? 'extracciones' : 'extracción'} de completar {result.figure}.
                              </p>
                            );
                          })}
                      {near && (
                        <React.Fragment>
                          <p>
                            Cartón cercano: {near.cardId} · faltan {near.missingNumbers.join(', ')}.
                          </p>
                          <Mask
                            mask={definition.mask}
                            cells={near.cells}
                            matched={near.matchedPositions}
                            pending={near.pendingPositions}
                          />
                        </React.Fragment>
                      )}
                    </article>
                  );
                })}
              </div>
              <details>
                <summary>Secuencia oficial ({frame.draws.length} números)</summary>
                <ol>
                  {frame.draws.map((draw) => (
                    <li key={draw._id}>
                      {draw.number} · {draw.drawnAt} ·{' '}
                      {draw.origin === 'manual' ? 'registro físico' : 'digital'}
                    </li>
                  ))}
                </ol>
              </details>
            </React.Fragment>
          )}
          <CandidateAlerts
            refreshVersion={frame.version}
            root={root}
            token={token}
            canOperate={canOperate}
            busy={busy}
            run={run}
            mutate={mutate}
          />
          <PrizePanel
            root={`/editions/${edition._id}/prizes`}
            token={token}
            permissions={permissions}
            version={frame.version}
            busy={busy}
            run={run}
            mutate={(path, body) => mutate(`prizes/${path}`, body)}
          />
          <h3>Candidatos detectados</h3>
          <p>
            Los candidatos de reserva no se suman automáticamente al primer grupo ni a un pozo adjudicado.
          </p>
          <label>
            Grupo de candidatos
            <select
              aria-label="Grupo de candidatos"
              disabled={busy}
              value={cohort}
              onChange={(e) => {
                setCohort(e.target.value);
                setOffset(0);
                setContact(null);
              }}
            >
              <option value="primary">Primera bolilla ganadora</option>
              <option value="reserve">Completaciones posteriores (reserva)</option>
            </select>
          </label>
          <label>
            Ronda de candidatos
            <select
              aria-label="Ronda de candidatos"
              disabled={busy}
              value={historyRound}
              onChange={(e) => {
                setHistoryRound(e.target.value);
                setOffset(0);
                setContact(null);
              }}
            >
              <option value="">Ronda actual</option>
              <option value="all">Todas las rondas</option>
              {(frame.rounds || []).map((round) => (
                <option key={round._id} value={round._id}>
                  Ronda {round.ordinal + 1} · {round.figures.join(', ')}
                </option>
              ))}
            </select>
          </label>
          <div className="pilot-table">
            <table>
              <caption>
                Candidatos · página {Math.floor(offset / 25) + 1}. Se conserva el conjunto completo.
              </caption>
              <thead>
                <tr>
                  <th>Figura y cartón</th>
                  {permissions.includes('contacts:read') && <th>Participante</th>}
                  <th>Evidencia oficial</th>
                  <th>Estado</th>
                  <th>Contacto</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate._id}>
                    <td>
                      {candidate.figure} · {candidate.cardId}
                    </td>
                    {permissions.includes('contacts:read') && (
                      <td>{candidate.participantName || 'Sin nombre registrado'}</td>
                    )}
                    <td>
                      Bolilla {candidate.evidence.number}, extracción {candidate.evidence.sequence}
                      <Mask mask={candidate.evidence.mask} cells={candidate.evidence.cells} />
                    </td>
                    <td>
                      {candidate.cohort === 'primary' ? 'Candidato de primera bolilla' : 'Reserva'} ·{' '}
                      {candidate.state === 'detected' ? 'Pendiente de respuesta' : candidate.state}
                      {candidate.deadlineStatus === 'expired_pending_review' && (
                        <p>Plazo vencido: requiere conciliación antes de resolver.</p>
                      )}
                      {candidate.expiresAt && <p>Vence: {candidate.expiresAt}</p>}
                    </td>
                    <td>
                      {permissions.includes('contacts:read') && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () =>
                              setContact(await request(`${root}/candidates/${candidate._id}/contact`, token))
                            )
                          }
                        >
                          Consultar contacto {candidate._id}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button disabled={busy || offset === 0} onClick={() => run(() => load(Math.max(0, offset - 25)))}>
            Candidatos anteriores
          </button>
          <button disabled={busy || candidates.length < 25} onClick={() => run(() => load(offset + 25))}>
            Más candidatos
          </button>
          {contact && (
            <aside aria-label="Contacto privado del candidato">
              <h3>Contacto privado · figura {contact.figure}</h3>
              <p>
                {contact.name} · {(contact.emails || []).join(', ')} · {(contact.phones || []).join(', ')}
              </p>
              <p>Estos datos son para el equipo; no deben mostrarse en la salida pública.</p>
              <ul>
                {contact.deliveries.map((delivery) => (
                  <li key={delivery._id}>
                    Envío {delivery._id} · {delivery.kind} · {delivery.channel} · {delivery.recipient} ·{' '}
                    {delivery.state}
                    {delivery.parentId && ` · reenvío de ${delivery.parentId}`}
                  </li>
                ))}
              </ul>
              <ContactWorkflow
                key={contact.candidateId}
                contact={contact}
                root={root}
                token={token}
                permissions={permissions}
                busy={busy}
                run={run}
                mutate={mutate}
                onContact={setContact}
              />
              <button disabled={busy} onClick={() => setContact(null)}>
                Cerrar contacto
              </button>
            </aside>
          )}
          {canOperate && ['ready', 'playing', 'paused'].includes(frame.state) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                run(() => mutate('incidents', { kind: incidentKind, reason, drawId: last && last._id }));
              }}
            >
              <h3>Incidencias y finalización</h3>
              <label>
                Tipo de incidencia
                <select
                  aria-label="Tipo de incidencia"
                  value={incidentKind}
                  onChange={(e) => setIncidentKind(e.target.value)}
                >
                  <option value="operation">Operación</option>
                  <option value="entry_error">Registro de número físico</option>
                  <option value="recovery">Recuperación</option>
                </select>
              </label>
              <label>
                Motivo de incidencia o finalización
                <textarea
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>Registrar una incidencia pausa la partida. La secuencia oficial se conserva.</p>
              <button disabled={busy}>Registrar incidencia</button>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => run(() => mutate('finish', { reason }))}
              >
                Finalizar partida conservando resultados
              </button>
            </form>
          )}
          {(canOperate || permissions.includes('audit:read')) && (
            <React.Fragment>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => setIncidents(await request(root + '/incidents?limit=100', token)))
                }
              >
                Consultar incidencias ({frame.incidentCount})
              </button>
              {incidents && (
                <ul>
                  {incidents.map((item) => (
                    <li key={item._id}>
                      {item.occurredAt} · {item.kind} · {item.reason}
                    </li>
                  ))}
                </ul>
              )}
            </React.Fragment>
          )}
        </React.Fragment>
      )}
    </section>
  );
}
