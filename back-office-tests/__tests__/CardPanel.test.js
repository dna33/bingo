import React from 'react';
import { render, fireEvent, cleanup, waitForElement } from '@testing-library/react';
import CardPanel from '../../src/back-office/components/CardPanel';
import { request, newId } from '../../src/back-office/pilot-api';
jest.mock('../../src/back-office/pilot-api', () => ({
  request: jest.fn(),
  newId: jest.fn(),
  base: 'http://localhost/api'
}));
const edition = { _id: 'edition-1', name: 'Piloto', version: 1, state: 'preparation' };
let summary, rows, issued, changed;
beforeEach(() => {
  jest.clearAllMocks();
  let counter = 0;
  newId.mockImplementation(() => `request-${++counter}`);
  summary = {
    version: 1,
    settings: null,
    locked: false,
    listClosed: false,
    eligible: true,
    activeParticipants: 120,
    pdfReady: 0,
    remaining: 120
  };
  rows = [];
  issued = [];
  changed = jest.fn().mockResolvedValue();
  request.mockImplementation(async (path, token, options) => {
    if (path.endsWith('/cards/summary')) return { ...summary };
    if (path.includes('/cards?')) return rows;
    if (path.endsWith('/card-settings')) {
      summary = { ...summary, version: 2, settings: JSON.parse(options.body).settings };
      return { version: 2 };
    }
    if (path.endsWith('/cards/issue')) {
      const body = JSON.parse(options.body);
      issued.push(body);
      const processed = Math.min(50, summary.remaining);
      summary = {
        ...summary,
        version: body.expectedVersion + 1,
        remaining: summary.remaining - processed,
        pdfReady: summary.pdfReady + processed,
        locked: true
      };
      return { version: summary.version, remaining: summary.remaining, totalParticipants: 120, processed };
    }
    throw new Error('Unexpected route');
  });
});
afterEach(cleanup);
test('configuration has no default range/variant and sends explicit confirmation with schedule metadata', async () => {
  const ui = render(
    <CardPanel edition={edition} token="staff" permissions={['editions:configure']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Confirmar configuración de cartones'));
  expect(ui.getByLabelText('Número mínimo').value).toBe('');
  expect(ui.getByLabelText('Distribución').value).toBe('');
  fireEvent.change(ui.getByLabelText('Número mínimo'), { target: { value: '1' } });
  fireEvent.change(ui.getByLabelText('Número máximo'), { target: { value: '75' } });
  fireEvent.change(ui.getByLabelText('Distribución'), { target: { value: 'unrestricted' } });
  fireEvent.change(ui.getByLabelText('Respaldo de la confirmación de reglas'), {
    target: { value: 'Rules approved for synthetic test' }
  });
  fireEvent.submit(ui.getByText('Confirmar configuración de cartones').closest('form'));
  await waitForElement(() =>
    ui.getByText('Reglas confirmadas. Ya puedes emitir los cartones de la lista conciliada.')
  );
  const sent = JSON.parse(request.mock.calls.find((call) => call[0].endsWith('/card-settings'))[2].body);
  expect(sent.expectedVersion).toBe(1);
  expect(sent.settings.minNumber).toBe(1);
  expect(sent.settings.maxNumber).toBe(75);
  expect(sent.settings.confirmationReference).toBe('Rules approved for synthetic test');
});
test('emission advances the version between resumable batches and stops when no participant is pending', async () => {
  summary.settings = { minNumber: 1, maxNumber: 75, columnMode: 'unrestricted' };
  const ui = render(
    <CardPanel edition={edition} token="staff" permissions={['cards:issue']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Emitir cartones pendientes'));
  fireEvent.click(ui.getByText('Emitir cartones pendientes'));
  await waitForElement(() =>
    ui.getByText('Progreso guardado. Los cartones emitidos se conservarán al reanudar.')
  );
  expect(issued.map((command) => command.expectedVersion)).toEqual([1, 2, 3]);
  expect(ui.getByText('Emitir cartones pendientes').disabled).toBe(true);
  const keys = request.mock.calls
    .filter((call) => call[0].endsWith('/cards/issue'))
    .map((call) => call[2].headers['Idempotency-Key']);
  expect(new Set(keys).size).toBe(3);
});
test('read-only staff can download a saved PDF without configuration or emission controls', async () => {
  rows = [{ _id: 'card-1', cardCode: 'stored-code', participantId: 'participant-1', pdfAvailable: true }];
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = jest.fn().mockReturnValue('blob:synthetic');
  URL.revokeObjectURL = jest.fn();
  fetch.mockResponseOnce('synthetic-pdf');
  const ui = render(
    <CardPanel edition={edition} token="staff" permissions={['participants:read']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Descargar PDF stored-code'));
  expect(ui.queryByText('Emitir cartones pendientes')).toBeNull();
  expect(ui.queryByText('Confirmar configuración de cartones')).toBeNull();
  fireEvent.click(ui.getByText('Descargar PDF stored-code'));
  await waitForElement(() => {
    if (!click.mock.calls.length) throw new Error('waiting');
    return true;
  });
  expect(fetch.mock.calls[0][0]).toBe('http://localhost/api/editions/edition-1/cards/card-1/pdf');
  expect(request.mock.calls.every((call) => !call[2])).toBe(true);
  click.mockRestore();
});

test('pausing stops after the in-flight batch and resuming uses its committed version', async () => {
  summary.settings = { minNumber: 1, maxNumber: 75, columnMode: 'unrestricted' };
  const normal = request.getMockImplementation();
  let finish;
  request.mockImplementation((path, token, options) => {
    if (path.endsWith('/cards/issue') && !finish) {
      issued.push(JSON.parse(options.body));
      return new Promise((resolve) => {
        finish = () => {
          summary = { ...summary, version: 2, remaining: 70, pdfReady: 50, locked: true };
          resolve({ version: 2, remaining: 70, totalParticipants: 120, processed: 50 });
        };
      });
    }
    return normal(path, token, options);
  });
  const ui = render(
    <CardPanel edition={edition} token="staff" permissions={['cards:issue']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Emitir cartones pendientes'));
  fireEvent.click(ui.getByText('Emitir cartones pendientes'));
  await waitForElement(() => ui.getByText('Pausar tras este lote'));
  fireEvent.click(ui.getByText('Pausar tras este lote'));
  finish();
  await waitForElement(() =>
    ui.getByText('Progreso guardado. Los cartones emitidos se conservarán al reanudar.')
  );
  expect(issued).toHaveLength(1);
  fireEvent.click(ui.getByText('Emitir cartones pendientes'));
  await waitForElement(() =>
    ui.getByText('Progreso guardado. Los cartones emitidos se conservarán al reanudar.')
  );
  expect(issued.map((command) => command.expectedVersion)).toEqual([1, 2, 3]);
});
