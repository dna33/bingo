import React from 'react';
import { render, fireEvent, cleanup, waitForElement } from '@testing-library/react';
import DeliveryPanel from '../../src/back-office/components/DeliveryPanel';
import { request, newId } from '../../src/back-office/pilot-api';
jest.mock('../../src/back-office/pilot-api', () => ({ request: jest.fn(), newId: jest.fn() }));
const edition = { _id: 'edition-1', version: 5, listClosedAt: '2026-11-16T12:00:00Z' };
let summary, jobs, changed;
const job = {
  _id: 'job-1',
  cardId: 'card-1',
  participantId: 'person-1',
  recipient: 'person@example.invalid',
  channel: 'email',
  kind: 'initial',
  state: 'provider_accepted',
  attemptCount: 1,
  providerKey: 'job-1-1'
};
beforeEach(() => {
  jest.clearAllMocks();
  let key = 0;
  newId.mockImplementation(() => `key-${++key}`);
  summary = { version: 5, counts: {}, initialQueued: 0, unqueued: 1, activeParticipants: 1 };
  jobs = [];
  changed = jest.fn().mockResolvedValue();
  request.mockImplementation(async (path, token, options) => {
    if (path.endsWith('/summary')) return { ...summary };
    if (path.includes('?limit=')) return jobs;
    if (path.endsWith('/enqueue')) {
      summary = { ...summary, version: 6, counts: { pending: 1 }, unqueued: 0, initialQueued: 1 };
      return { version: 6, remaining: 0 };
    }
    if (options) return { version: 6 };
    if (path.endsWith('/attempts'))
      return [{ _id: 'attempt-1', attempt: 1, state: 'provider_accepted', recipient: job.recipient }];
    return { id: job._id, reason: 'Recorded reason' };
  });
});
afterEach(cleanup);
test('queueing is clearly simulated and submits channel/scenario without arbitrary recipients or PDF replacement', async () => {
  const ui = render(
    <DeliveryPanel edition={edition} token="staff" permissions={['deliveries:manage']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Encolar PDFs pendientes'));
  expect(
    ui.getByText('Proveedor exclusivamente simulado. No envía emails ni documentos de WhatsApp reales.')
  ).toBeTruthy();
  fireEvent.change(ui.getByLabelText('Canal simulado'), { target: { value: 'whatsapp' } });
  fireEvent.click(ui.getByText('Encolar PDFs pendientes'));
  await waitForElement(() => ui.getByText('Cola guardada. Ningún mensaje real fue enviado.'));
  const sent = JSON.parse(request.mock.calls.find((call) => call[0].endsWith('/enqueue'))[2].body);
  expect(sent).toEqual({ expectedVersion: 5, channel: 'whatsapp', simulation: 'accepted', limit: 100 });
});
test('acceptance is distinct from delivery and read-only access has no sending controls', async () => {
  jobs = [job];
  summary.counts = { provider_accepted: 1 };
  const ui = render(
    <DeliveryPanel edition={edition} token="staff" permissions={['deliveries:read']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Ver historial job-1'));
  expect(ui.getByText('Aceptado por el proveedor: 1')).toBeTruthy();
  expect(ui.getByText('Entrega confirmada: 0')).toBeTruthy();
  expect(ui.queryByText('Encolar PDFs pendientes')).toBeNull();
  expect(ui.queryByText('Procesar cola simulada')).toBeNull();
  expect(request.mock.calls.every((call) => !call[2])).toBe(true);
});
test('explicit fallback sends a new command linked to the same job, with a reason and alternate channel', async () => {
  jobs = [{ ...job, state: 'bounced' }];
  summary.counts = { bounced: 1 };
  const ui = render(
    <DeliveryPanel edition={edition} token="staff" permissions={['deliveries:manage']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Reenviar job-1'));
  fireEvent.change(ui.getByLabelText('Canal simulado'), { target: { value: 'whatsapp' } });
  fireEvent.click(ui.getByText('Reenviar job-1'));
  fireEvent.change(ui.getByLabelText('Motivo del reenvío o reintento'), {
    target: { value: 'Email bounced; use recorded phone' }
  });
  fireEvent.submit(ui.getByText('Registrar operación simulada').closest('form'));
  await waitForElement(() =>
    ui.getByText('Operación simulada registrada. Se conservan el cartón y el PDF originales.')
  );
  const sent = request.mock.calls.find((call) => call[0].endsWith('/job-1/resend'));
  expect(JSON.parse(sent[2].body)).toEqual({
    expectedVersion: 5,
    reason: 'Email bounced; use recorded phone',
    simulation: 'accepted',
    channel: 'whatsapp'
  });
});
test('uncertain sends expose reconciliation and simulated evidence, not a blind retry action', async () => {
  jobs = [{ ...job, state: 'uncertain' }];
  summary.counts = { uncertain: 1 };
  const ui = render(
    <DeliveryPanel edition={edition} token="staff" permissions={['deliveries:manage']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Reconciliar job-1'));
  expect(ui.queryByText('Reintentar job-1')).toBeNull();
  expect(ui.queryByText('Reenviar job-1')).toBeNull();
  fireEvent.click(ui.getByText('Simular confirmación job-1'));
  fireEvent.submit(ui.getByText('Registrar operación simulada').closest('form'));
  await waitForElement(() =>
    ui.getByText('Operación simulada registrada. Se conservan el cartón y el PDF originales.')
  );
  const sent = JSON.parse(request.mock.calls.find((call) => call[0].endsWith('/mock-event'))[2].body);
  expect(sent.providerKey).toBe('job-1-1');
  expect(sent.status).toBe('delivered');
  expect(sent.eventKey).toBeTruthy();
});
