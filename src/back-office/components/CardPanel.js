import React, { useEffect, useRef, useState } from 'react';
import { request, newId, base } from '../pilot-api';
export default function CardPanel({ edition, token, permissions, onChanged }) {
  const [status, setStatus] = useState(null);
  const [cards, setCards] = useState([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({
    minNumber: '',
    maxNumber: '',
    columnMode: '',
    title: edition.name,
    eventDate: '',
    eventTime: '',
    timeZone: 'America/Santiago',
    confirmationReference: ''
  });
  const mounted = useRef(false),
    continuing = useRef(false),
    errorRef = useRef(null);
  const can = (permission) => permissions.includes(permission);
  const root = `/editions/${edition._id}`;
  async function refresh(page = offset) {
    const next = await request(root + '/cards/summary', token);
    const list = await request(root + `/cards?limit=20&offset=${page}`, token);
    if (mounted.current) {
      setStatus(next);
      setCards(list);
      setOffset(page);
    }
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
        setIssuing(false);
        setReissuing(false);
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
  async function mutate(path, body, version) {
    return request(root + path, token, {
      method: 'POST',
      headers: { 'Idempotency-Key': `cards-${newId()}` },
      body: JSON.stringify({ expectedVersion: version, ...body })
    });
  }
  async function emit() {
    continuing.current = true;
    setIssuing(true);
    let version = status.version;
    do {
      const result = await mutate('/cards/issue', { limit: 50 }, version);
      version = result.version;
      if (mounted.current)
        setStatus((previous) => ({
          ...previous,
          version,
          remaining: result.remaining,
          pdfReady: result.totalParticipants - result.remaining
        }));
      if (!result.remaining) break;
    } while (continuing.current && mounted.current);
    continuing.current = false;
    if (mounted.current) {
      await refresh();
      await onChanged();
      setNotice('Progreso guardado. Los cartones emitidos se conservarán al reanudar.');
    }
  }
  async function reissueAll() {
    continuing.current = true;
    setReissuing(true);
    let version = status.version;
    do {
      const result = await mutate('/cards/pdf/reissue-batch', { limit: 50 }, version);
      version = result.version;
      if (mounted.current)
        setStatus((previous) => ({ ...previous, version, outdatedTemplates: result.remaining }));
      if (!result.remaining) break;
    } while (continuing.current && mounted.current);
    continuing.current = false;
    if (mounted.current) {
      await refresh();
      await onChanged();
      setNotice('Diseño actualizado. Los números de cada cartón no cambiaron.');
    }
  }
  async function download(card) {
    const response = await fetch(`${base}${root}/cards/${card._id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('No se pudo descargar el PDF. Actualiza los datos y revisa su estado.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `carton-${card.cardCode}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const mutable = status && !status.listClosed && edition.state === 'preparation';
  return (
    <section aria-label="Cartones permanentes" aria-busy={busy}>
      <h2>Cartones permanentes y PDF</h2>
      {error && (
        <div role="alert" tabIndex={-1} ref={errorRef}>
          <p>{error}</p>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <p role="status">Cargando cartones…</p>
      ) : (
        <React.Fragment>
          <p role="status">
            {status.pdfReady} PDF disponibles de {status.activeParticipants} participantes. Pendientes:{' '}
            {status.remaining}.
          </p>
          {status.settings ? (
            <p>
              Variante confirmada: {status.settings.minNumber}–{status.settings.maxNumber},{' '}
              {status.settings.columnMode === 'american75'
                ? 'rangos por columna B/I/N/G/O'
                : 'distribución libre'}
              .{' '}
              {status.locked
                ? 'Reglas bloqueadas tras la primera emisión.'
                : 'La primera emisión bloqueará estas reglas.'}
            </p>
          ) : (
            <p>Antes de emitir, un administrador debe confirmar el rango y la distribución de los números.</p>
          )}
          {can('editions:configure') && mutable && !status.locked && (
            <details open={!status.settings}>
              <summary>Confirmar reglas de los cartones y datos del PDF</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    await mutate(
                      '/card-settings',
                      {
                        settings: {
                          ...draft,
                          minNumber: Number(draft.minNumber),
                          maxNumber: Number(draft.maxNumber)
                        }
                      },
                      status.version
                    );
                    await refresh();
                    await onChanged();
                    setNotice('Reglas confirmadas. Ya puedes emitir los cartones de la lista conciliada.');
                  });
                }}
              >
                <label>
                  Número mínimo
                  <input
                    required
                    type="number"
                    min="1"
                    max="977"
                    value={draft.minNumber}
                    onChange={(e) => setDraft({ ...draft, minNumber: e.target.value })}
                  />
                </label>
                <label>
                  Número máximo
                  <input
                    required
                    type="number"
                    min="24"
                    max="1000"
                    value={draft.maxNumber}
                    onChange={(e) => setDraft({ ...draft, maxNumber: e.target.value })}
                  />
                </label>
                <label>
                  Distribución
                  <select
                    aria-label="Distribución"
                    required
                    value={draft.columnMode}
                    onChange={(e) => setDraft({ ...draft, columnMode: e.target.value })}
                  >
                    <option value="">Seleccionar…</option>
                    <option value="unrestricted">Libre: sin rangos por columna</option>
                    <option value="american75">B/I/N/G/O: rangos de 15, números 1–75</option>
                  </select>
                </label>
                <label>
                  Título de edición en el PDF
                  <input
                    required
                    maxLength={80}
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </label>
                <label>
                  Fecha del evento (opcional)
                  <input
                    type="date"
                    value={draft.eventDate}
                    onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })}
                  />
                </label>
                <label>
                  Hora del evento (opcional)
                  <input
                    type="time"
                    value={draft.eventTime}
                    onChange={(e) => setDraft({ ...draft, eventTime: e.target.value })}
                  />
                </label>
                <label>
                  Zona horaria
                  <input
                    value={draft.timeZone}
                    onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}
                  />
                </label>
                <label>
                  Respaldo de la confirmación de reglas
                  <input
                    required
                    maxLength={1000}
                    value={draft.confirmationReference}
                    onChange={(e) => setDraft({ ...draft, confirmationReference: e.target.value })}
                  />
                </label>
                <p>
                  Los números y los datos impresos quedan fijos al emitir el primer lote. Fecha u hora vacías
                  aparecerán como «por confirmar» en esos PDF.
                </p>
                <button disabled={busy}>Confirmar configuración de cartones</button>
              </form>
            </details>
          )}
          {can('cards:issue') && mutable && (
            <React.Fragment>
              {!status.eligible && (
                <p>Resuelve las diferencias de la lista aprobada antes de emitir cartones.</p>
              )}
              <button
                disabled={busy || !status.settings || !status.eligible || status.remaining === 0}
                onClick={() => run(emit)}
              >
                Emitir cartones pendientes
              </button>
              {issuing && (
                <button
                  onClick={() => {
                    continuing.current = false;
                    setNotice('Se pausará al terminar el lote en curso.');
                  }}
                >
                  Pausar tras este lote
                </button>
              )}
            </React.Fragment>
          )}
          <p>
            Cada participante conserva un cartón por edición. Descargar o recuperar el PDF mantiene sus
            números; no envía ningún mensaje.
          </p>
          {status.outdatedTemplates > 0 && (
            <React.Fragment>
              <p role="status">
                {status.outdatedTemplates} cartón(es) con un diseño de PDF anterior al vigente.
              </p>
              {can('cards:issue') && (
                <React.Fragment>
                  <button disabled={busy} onClick={() => run(reissueAll)}>
                    Actualizar todos los PDFs al diseño vigente
                  </button>
                  {reissuing && (
                    <button
                      onClick={() => {
                        continuing.current = false;
                        setNotice('Se pausará al terminar el lote en curso.');
                      }}
                    >
                      Pausar tras este lote
                    </button>
                  )}
                  <p>No cambia los números de ningún cartón, solo el diseño impreso.</p>
                </React.Fragment>
              )}
            </React.Fragment>
          )}
          <button disabled={busy} onClick={() => run(() => refresh())}>
            Actualizar cartones
          </button>
          <div className="pilot-table">
            <table>
              <caption>Cartones emitidos · página {Math.floor(offset / 20) + 1}</caption>
              <thead>
                <tr>
                  <th>Código de cartón</th>
                  <th>Participante</th>
                  <th>PDF individual</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card._id}>
                    <td>{card.cardCode}</td>
                    <td>{card.participantId}</td>
                    <td>
                      {card.pdfAvailable ? (
                        <React.Fragment>
                          <button disabled={busy} onClick={() => run(() => download(card))}>
                            Descargar PDF {card.cardCode}
                          </button>
                          {!card.templateCurrent && can('cards:issue') && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await mutate(`/cards/${card._id}/pdf/reissue`, {}, status.version);
                                  await refresh();
                                  await onChanged();
                                })
                              }
                            >
                              Actualizar al diseño vigente {card.cardCode}
                            </button>
                          )}
                        </React.Fragment>
                      ) : (
                        <React.Fragment>
                          <span>PDF no disponible</span>
                          {can('cards:issue') && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await mutate(`/cards/${card._id}/pdf/recover`, {}, status.version);
                                  await refresh();
                                  await onChanged();
                                })
                              }
                            >
                              Recuperar PDF {card.cardCode}
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
            onClick={() => run(() => refresh(Math.max(0, offset - 20)))}
          >
            Cartones anteriores
          </button>
          <button disabled={busy || cards.length < 20} onClick={() => run(() => refresh(offset + 20))}>
            Más cartones
          </button>
        </React.Fragment>
      )}
    </section>
  );
}
