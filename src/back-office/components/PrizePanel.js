import React, { useEffect, useRef, useState } from 'react';
import { request, base } from '../pilot-api';
const money = (value) => `$${Number(value || 0).toLocaleString('es-CL')}`;
export default function PrizePanel({ root, token, permissions, version, busy, run, mutate }) {
  const [summary, setSummary] = useState(null),
    [report, setReport] = useState(null),
    [kind, setKind] = useState('confirmed'),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [reason, setReason] = useState(''),
    [proposal, setProposal] = useState(null),
    [shareOffset, setShareOffset] = useState(0),
    [reviewed, setReviewed] = useState(false),
    [recoveryReviewed, setRecoveryReviewed] = useState(false),
    [exhaustion, setExhaustion] = useState(false),
    [account, setAccount] = useState(null),
    [accountRef, setAccountRef] = useState(''),
    [accountEvidence, setAccountEvidence] = useState(''),
    [accountVerified, setAccountVerified] = useState(false),
    [award, setAward] = useState(null),
    [creditReference, setCreditReference] = useState(''),
    [creditEvidence, setCreditEvidence] = useState(''),
    [creditedAt, setCreditedAt] = useState(''),
    [creditedToPolla, setCreditedToPolla] = useState(false);
  const mounted = useRef(false),
    canConfirm = permissions.includes('results:confirm'),
    canReadPrivate =
      permissions.includes('contacts:read') && (canConfirm || permissions.includes('exports:read'));
  async function load() {
    const s = await request(root, token);
    const r = canReadPrivate
      ? await request(`${root}/reports/${kind}?limit=25&offset=${offset}`, token)
      : null;
    if (mounted.current) {
      setSummary(s);
      setReport(r);
      setError('');
    }
  }
  useEffect(() => {
    let fetching = false;
    mounted.current = true;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        await load();
      } catch (failure) {
        if (mounted.current)
          setError('No se pudo actualizar el presupuesto y reparto. Actualiza antes de aprobar.');
      } finally {
        fetching = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [root, token, version, kind, offset]);
  async function change(path, body) {
    const result = await mutate(path, body);
    await load();
    return result;
  }
  async function showProposal(id) {
    setProposal(await request(`${root}/proposals/${id}`, token));
    setShareOffset(0);
    setReviewed(false);
    setExhaustion(false);
  }
  async function exportReport() {
    const response = await fetch(`${base}${root}/reports/${kind}?format=csv`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('No se pudo exportar el reporte. Revisa permisos y filtros.');
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement('a');
    link.href = url;
    link.download = `premios-${kind}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section aria-label="Premios y abonos en Polla">
      <h3>Premios y abonos en polla.cl</h3>
      <p>
        La respuesta oportuna, la adjudicación y el abono son pasos distintos. El abono se realiza fuera de
        Bingo.
      </p>
      {error && <p role="alert">{error}</p>}
      {!summary ? (
        <p role="status">Cargando presupuesto…</p>
      ) : (
        <React.Fragment>
          <p role="status">
            Presupuesto: {money(summary.totals.totalClp)} · adjudicado: {money(summary.totals.allocatedClp)} ·
            abonado: {money(summary.totals.deliveredClp)} · pendiente de abono:{' '}
            {money(summary.totals.pendingCreditClp)} · disponible: {money(summary.totals.availableClp)} · no
            asignado al cerrar: {money(summary.totals.unassignedClp)}.
          </p>
          <table>
            <caption>Contabilidad por figura</caption>
            <thead>
              <tr>
                <th>Figura</th>
                <th>Pozo</th>
                <th>Adjudicado</th>
                <th>Abonado</th>
                <th>Disponible</th>
                <th>No asignado</th>
              </tr>
            </thead>
            <tbody>
              {summary.pools.map((pool) => (
                <tr key={pool.figure}>
                  <td>{pool.figure}</td>
                  <td>{money(pool.totalClp)}</td>
                  <td>{money(pool.allocatedClp)}</td>
                  <td>{money(pool.deliveredClp)}</td>
                  <td>{money(pool.availableClp)}</td>
                  <td>{money(pool.unassignedClp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canConfirm && (
            <React.Fragment>
              <label>
                Motivo o referencia de revisión del reparto
                <textarea maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <p>
                Primero resuelve todos los contactos y verifica las cuentas. Preparar fija un único sorteo de
                pesos residuales; aprobar registra la adjudicación.
              </p>
              {summary.state === 'finished' &&
                (summary.results || []).some(
                  (r) => r.roundId === summary.currentRoundId && ['open', 'detected'].includes(r.state)
                ) && (
                  <div>
                    <label>
                      <input
                        type="checkbox"
                        checked={recoveryReviewed}
                        onChange={(e) => setRecoveryReviewed(e.target.checked)}
                      />
                      Revisé la incidencia y autorizo reabrir la ronda detenida para resolver sus premios.
                    </label>
                    <button
                      disabled={busy || !recoveryReviewed || !reason.trim()}
                      onClick={() =>
                        run(() => change('reopen-round', { reviewed: recoveryReviewed, reason }))
                      }
                    >
                      Reabrir ronda detenida en pausa
                    </button>
                  </div>
                )}
              {(summary.results || [])
                .filter((r) => ['detected', 'open'].includes(r.state))
                .map((result) => (
                  <button
                    key={result._id}
                    disabled={busy || !reason.trim() || !!error}
                    onClick={() =>
                      run(async () => {
                        const data = await change('prepare', { resultId: result._id, reason });
                        await showProposal(data.proposalId);
                      })
                    }
                  >
                    Preparar reparto {result.figure} · ciclo {result.allocationCycle || 0}
                  </button>
                ))}
            </React.Fragment>
          )}
          {canReadPrivate &&
            (summary.proposals || []).map((p) => (
              <button key={p._id} disabled={busy} onClick={() => run(() => showProposal(p._id))}>
                Revisar propuesta {p._id}
                {p.confirmedAt ? ' · aprobada' : ''}
              </button>
            ))}
          {proposal && (
            <aside aria-label="Propuesta de reparto">
              <h4>Propuesta fija · ciclo {proposal.cycle}</h4>
              <p>
                Adjudicar: {money(proposal.allocatedClp)} · remanente: {money(proposal.remainderClp)} ·
                destino: {proposal.disposition}.
              </p>
              <p>
                Semilla del sorteo: {proposal.seed} · algoritmo: {proposal.algorithm}. El sorteo se conserva
                al reintentar.
              </p>
              <p>
                {proposal.split.shares.length} participaciones; base {money(proposal.split.baseClp)} y{' '}
                {proposal.split.residualClp} pesos residuales.
              </p>
              <table>
                <caption>Participaciones de la propuesta</caption>
                <thead>
                  <tr>
                    <th>Candidato</th>
                    <th>Respuesta</th>
                    <th>Parte</th>
                    <th>Cuenta Polla verificada</th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.split.shares.slice(shareOffset, shareOffset + 25).map((share) => {
                    const c = proposal.basis.candidates.find((c) => c.id === share.candidateId);
                    return (
                      <tr key={share.candidateId}>
                        <td>{share.candidateId}</td>
                        <td>{c.state}</td>
                        <td>{money(share.amountClp)}</td>
                        <td>{proposal.accounts[c.participantId] || 'No corresponde: descartado'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                disabled={shareOffset === 0}
                onClick={() => setShareOffset(Math.max(0, shareOffset - 25))}
              >
                Participaciones anteriores
              </button>
              <button
                disabled={shareOffset + 25 >= proposal.split.shares.length}
                onClick={() => setShareOffset(shareOffset + 25)}
              >
                Más participaciones
              </button>
              {canConfirm && !proposal.confirmedAt && (
                <React.Fragment>
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    Revisé todo el grupo, las cuentas, los montos y el destino del remanente.
                  </label>
                  {proposal.disposition === 'keep_unassigned_exhausted' && (
                    <label>
                      <input
                        type="checkbox"
                        checked={exhaustion}
                        onChange={(e) => setExhaustion(e.target.checked)}
                      />
                      Reconozco que no quedan cartones elegibles; autorizo cerrar este saldo como no asignado.
                    </label>
                  )}
                  <button
                    disabled={
                      busy ||
                      !reviewed ||
                      !reason.trim() ||
                      !!error ||
                      (proposal.disposition === 'keep_unassigned_exhausted' && !exhaustion)
                    }
                    onClick={() =>
                      run(async () => {
                        await change('confirm', {
                          proposalId: proposal._id,
                          reason,
                          reviewed,
                          reviewedSnapshotHash: proposal.snapshotHash,
                          exhaustionAcknowledged: exhaustion
                        });
                        await showProposal(proposal._id);
                      })
                    }
                  >
                    Validar y adjudicar propuesta
                  </button>
                </React.Fragment>
              )}
              <button disabled={busy} onClick={() => setProposal(null)}>
                Cerrar propuesta
              </button>
            </aside>
          )}
        </React.Fragment>
      )}
      {canReadPrivate && (
        <React.Fragment>
          <label>
            Reporte de premios
            <select
              aria-label="Reporte de premios"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setOffset(0);
              }}
            >
              <option value="confirmed">Respuestas oportunas, incluida adjudicación pendiente</option>
              <option value="awards">Adjudicados</option>
              <option value="pending">Pendientes de abono</option>
              <option value="delivered">Abonados</option>
              <option value="discarded">Descartados (separados)</option>
            </select>
          </label>
          {permissions.includes('exports:read') && (
            <button disabled={busy} onClick={() => run(exportReport)}>
              Exportar reporte completo CSV
            </button>
          )}
          {report && (
            <div className="pilot-table">
              <table>
                <caption>
                  {report.total} resultados · versión {report.version}
                </caption>
                <thead>
                  <tr>
                    <th>Persona y cartón</th>
                    <th>Figura y estado</th>
                    <th>Monto</th>
                    <th>Cuenta</th>
                    <th>Operación</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.candidateId}>
                      <td>
                        {row.name || row.participantId} · {row.email} · {row.phone}
                        <br />
                        Cartón {row.cardCode}
                      </td>
                      <td>
                        {row.figure} · {row.candidateState} · {row.awardState}
                      </td>
                      <td>{row.amountClp === null ? 'Sin adjudicar' : money(row.amountClp)}</td>
                      <td>{row.accountReference || 'Falta cuenta verificada'}</td>
                      <td>
                        {canConfirm && (
                          <React.Fragment>
                            {row.awardState === 'not_allocated' && row.candidateState === 'confirmed' && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    const data = await request(
                                      `${root}/accounts/${row.participantId}`,
                                      token
                                    );
                                    setAccount(data);
                                    setAccountRef(data.account ? data.account.accountReference : '');
                                    setAccountEvidence('');
                                    setAccountVerified(false);
                                  })
                                }
                              >
                                {row.accountReference ? 'Revisar cuenta' : 'Verificar cuenta'}{' '}
                                {row.participantId}
                              </button>
                            )}
                            {row.awardState === 'confirmed' && row.amountClp > 0 && (
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setAward(row);
                                  setCreditReference('');
                                  setCreditEvidence('');
                                  setCreditedAt(new Date().toISOString());
                                  setCreditedToPolla(false);
                                }}
                              >
                                Registrar abono {row.awardId}
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
          )}
          <button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
            Resultados anteriores
          </button>
          <button
            disabled={busy || !report || offset + 25 >= report.total}
            onClick={() => setOffset(offset + 25)}
          >
            Más resultados
          </button>
        </React.Fragment>
      )}
      {account && canConfirm && (
        <form
          aria-label="Verificar cuenta Polla"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await change('accounts', {
                participantId: account.participant._id,
                accountReference: accountRef,
                evidence: accountEvidence,
                verifiedWithPolla: accountVerified
              });
              setAccount(null);
            });
          }}
        >
          <h4>Verificar cuenta en polla.cl</h4>
          <p>
            {account.participant.name} · {(account.participant.emails || []).join(', ')} ·{' '}
            {(account.participant.phones || []).join(', ')}.
          </p>
          <p>
            Identificador de origen: {account.participant.externalId || 'no informado'}. No se considera una
            cuenta verificada automáticamente.
          </p>
          <label>
            Referencia de cuenta Polla
            <input
              required
              maxLength={100}
              value={accountRef}
              onChange={(e) => setAccountRef(e.target.value)}
            />
          </label>
          <label>
            Evidencia de verificación con Polla
            <textarea
              required
              maxLength={2000}
              value={accountEvidence}
              onChange={(e) => setAccountEvidence(e.target.value)}
            />
          </label>
          <label>
            <input
              required
              type="checkbox"
              checked={accountVerified}
              onChange={(e) => setAccountVerified(e.target.checked)}
            />
            Polla confirmó que esta cuenta pertenece al participante registrado.
          </label>
          <button disabled={busy || !accountVerified}>Guardar cuenta verificada</button>
          <button type="button" disabled={busy} onClick={() => setAccount(null)}>
            Cancelar verificación
          </button>
        </form>
      )}
      {award && canConfirm && (
        <form
          aria-label="Registrar abono en Polla"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await change('credits', {
                awardId: award.awardId,
                amountClp: award.amountClp,
                accountReference: award.accountReference,
                reference: creditReference,
                evidence: creditEvidence,
                creditedAt,
                creditedToPolla
              });
              setAward(null);
            });
          }}
        >
          <h4>Registrar abono ya realizado</h4>
          <p>
            {money(award.amountClp)} en la cuenta {award.accountReference} de{' '}
            {award.name || award.participantId}.
          </p>
          <label>
            Referencia única del comprobante de abono
            <input
              required
              maxLength={200}
              value={creditReference}
              onChange={(e) => setCreditReference(e.target.value)}
            />
          </label>
          <label>
            Fecha efectiva del abono (ISO con zona)
            <input required value={creditedAt} onChange={(e) => setCreditedAt(e.target.value)} />
          </label>
          <label>
            Evidencia del abono
            <textarea
              required
              maxLength={2000}
              value={creditEvidence}
              onChange={(e) => setCreditEvidence(e.target.value)}
            />
          </label>
          <label>
            <input
              required
              type="checkbox"
              checked={creditedToPolla}
              onChange={(e) => setCreditedToPolla(e.target.checked)}
            />
            El monto completo ya fue abonado en esta cuenta de polla.cl.
          </label>
          <button disabled={busy || !creditedToPolla}>Registrar entrega por abono</button>
          <button type="button" disabled={busy} onClick={() => setAward(null)}>
            Cancelar registro de abono
          </button>
        </form>
      )}
    </section>
  );
}
