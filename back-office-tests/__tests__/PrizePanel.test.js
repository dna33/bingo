import React from 'react';
import { render, cleanup, fireEvent, waitForElement } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import PrizePanel from '../../src/back-office/components/PrizePanel';
import { request } from '../../src/back-office/pilot-api';
jest.mock('../../src/back-office/pilot-api', () => ({ request: jest.fn(), base: '/bingo-api/pilot' }));
let props, summary, report, proposal;
beforeEach(() => {
  jest.clearAllMocks();
  summary = {
    totals: {
      totalClp: 400000,
      allocatedClp: 50000,
      deliveredClp: 0,
      pendingCreditClp: 50000,
      availableClp: 350000,
      unassignedClp: 0
    },
    pools: [
      {
        figure: 'F',
        totalClp: 50000,
        allocatedClp: 50000,
        deliveredClp: 0,
        availableClp: 0,
        unassignedClp: 0
      }
    ],
    results: [{ _id: 'r1', figure: 'F', state: 'detected', allocationCycle: 0 }],
    proposals: []
  };
  report = {
    version: 4,
    total: 1,
    rows: [
      {
        candidateId: 'c1',
        participantId: 'p1',
        name: 'Synthetic person',
        email: 'p@example.invalid',
        phone: '+56900000000',
        cardCode: 'card1',
        figure: 'F',
        candidateState: 'confirmed',
        awardState: 'not_allocated',
        amountClp: null,
        accountReference: ''
      }
    ]
  };
  proposal = {
    _id: 'proposal1',
    snapshotHash: 'fixture-reviewed-hash',
    cycle: 0,
    allocatedClp: 50000,
    remainderClp: 0,
    disposition: 'fully_allocated',
    seed: 'a'.repeat(64),
    algorithm: 'hmac-sha256-fisher-yates-rejection-v1',
    split: { baseClp: 50000, residualClp: 0, shares: [{ candidateId: 'c1', amountClp: 50000 }] },
    basis: { candidates: [{ id: 'c1', participantId: 'p1', state: 'confirmed' }] },
    accounts: { p1: 'polla-account-1' }
  };
  props = {
    root: '/editions/e1/prizes',
    token: 'staff',
    permissions: ['results:confirm', 'contacts:read'],
    version: 4,
    busy: false,
    run: (work) => work(),
    mutate: jest.fn().mockResolvedValue({ proposalId: 'proposal1' })
  };
  request.mockImplementation(async (path) => {
    if (path === props.root) return summary;
    if (path.includes('/reports/')) return report;
    if (path.includes('/proposals/')) return proposal;
    if (path.includes('/accounts/'))
      return {
        participant: {
          _id: 'p1',
          name: 'Synthetic person',
          email: 'p@example.invalid',
          externalId: 'unverified-source-id'
        },
        account: null
      };
    throw new Error('Unknown fixture request ' + path);
  });
});
afterEach(cleanup);
test('readonly staff see budget without private reports or approval and credit controls', async () => {
  const ui = render(<PrizePanel {...props} permissions={['participants:read']} />);
  await waitForElement(() => ui.getByText('Contabilidad por figura'));
  expect(ui.queryByLabelText('Reporte de premios')).toBeNull();
  expect(ui.queryByText('Preparar reparto F · ciclo 0')).toBeNull();
  expect(request.mock.calls.some((c) => c[0].includes('/reports/'))).toBe(false);
});
test('preparation creates a fixed proposal and approval needs explicit review; proposed money cannot be edited', async () => {
  const ui = render(<PrizePanel {...props} />);
  await waitForElement(() => ui.getByText('Preparar reparto F · ciclo 0'));
  expect(ui.getByText('Preparar reparto F · ciclo 0').disabled).toBe(true);
  fireEvent.change(ui.getByLabelText('Motivo o referencia de revisión del reparto'), {
    target: { value: 'Validated synthetic distribution' }
  });
  await act(async () => {
    fireEvent.click(ui.getByText('Preparar reparto F · ciclo 0'));
  });
  expect(props.mutate).toHaveBeenCalledWith('prepare', {
    resultId: 'r1',
    reason: 'Validated synthetic distribution'
  });
  expect(ui.getByText('Validar y adjudicar propuesta').disabled).toBe(true);
  expect(ui.getByText('polla-account-1')).toBeTruthy();
  expect(ui.queryByLabelText('Monto editable')).toBeNull();
  fireEvent.click(
    ui.getByLabelText('Revisé todo el grupo, las cuentas, los montos y el destino del remanente.')
  );
  await act(async () => {
    fireEvent.click(ui.getByText('Validar y adjudicar propuesta'));
  });
  expect(props.mutate).toHaveBeenCalledWith('confirm', {
    proposalId: 'proposal1',
    reason: 'Validated synthetic distribution',
    reviewed: true,
    reviewedSnapshotHash: 'fixture-reviewed-hash',
    exhaustionAcknowledged: false
  });
});
test('Polla account verification is explicit and imported external id is never silently treated as an account', async () => {
  const ui = render(<PrizePanel {...props} />);
  await waitForElement(() => ui.getByText('Verificar cuenta p1'));
  await act(async () => {
    fireEvent.click(ui.getByText('Verificar cuenta p1'));
  });
  expect(ui.getByLabelText('Referencia de cuenta Polla').value).toBe('');
  expect(ui.getByText(/unverified-source-id/)).toBeTruthy();
  fireEvent.change(ui.getByLabelText('Referencia de cuenta Polla'), { target: { value: 'polla-account-1' } });
  fireEvent.change(ui.getByLabelText('Evidencia de verificación con Polla'), {
    target: { value: 'Ownership verified with Polla' }
  });
  fireEvent.click(ui.getByLabelText('Polla confirmó que esta cuenta pertenece al participante registrado.'));
  await act(async () => {
    fireEvent.submit(ui.getByLabelText('Verificar cuenta Polla'));
  });
  expect(props.mutate).toHaveBeenCalledWith('accounts', {
    participantId: 'p1',
    accountReference: 'polla-account-1',
    evidence: 'Ownership verified with Polla',
    verifiedWithPolla: true
  });
});
test('credit form records a completed external full-amount credit with account, proof and explicit Polla acknowledgement', async () => {
  report.rows[0] = {
    ...report.rows[0],
    awardId: 'award1',
    awardState: 'confirmed',
    amountClp: 50000,
    accountReference: 'polla-account-1'
  };
  const ui = render(<PrizePanel {...props} />);
  await waitForElement(() => ui.getByText('Registrar abono award1'));
  fireEvent.click(ui.getByText('Registrar abono award1'));
  expect(ui.getByText('Registrar entrega por abono').disabled).toBe(true);
  fireEvent.change(ui.getByLabelText('Referencia única del comprobante de abono'), {
    target: { value: 'polla-operation-001' }
  });
  fireEvent.change(ui.getByLabelText('Fecha efectiva del abono (ISO con zona)'), {
    target: { value: '2026-11-17T01:00:00Z' }
  });
  fireEvent.change(ui.getByLabelText('Evidencia del abono'), {
    target: { value: 'External receipt reference, synthetic' }
  });
  fireEvent.click(ui.getByLabelText('El monto completo ya fue abonado en esta cuenta de polla.cl.'));
  await act(async () => {
    fireEvent.submit(ui.getByLabelText('Registrar abono en Polla'));
  });
  expect(props.mutate).toHaveBeenCalledWith('credits', {
    awardId: 'award1',
    amountClp: 50000,
    accountReference: 'polla-account-1',
    reference: 'polla-operation-001',
    creditedAt: '2026-11-17T01:00:00Z',
    evidence: 'External receipt reference, synthetic',
    creditedToPolla: true
  });
});
test('discarded and pending-credit reports stay distinct and CSV export is limited to export permission', async () => {
  const ui = render(<PrizePanel {...props} />);
  await waitForElement(() => ui.getByLabelText('Reporte de premios'));
  expect(ui.queryByText('Exportar reporte completo CSV')).toBeNull();
  await act(async () => {
    fireEvent.change(ui.getByLabelText('Reporte de premios'), { target: { value: 'discarded' } });
  });
  expect(request.mock.calls.some((c) => c[0].includes('/reports/discarded?'))).toBe(true);
  await act(async () => {
    fireEvent.change(ui.getByLabelText('Reporte de premios'), { target: { value: 'pending' } });
  });
  expect(request.mock.calls.some((c) => c[0].includes('/reports/pending?'))).toBe(true);
});
