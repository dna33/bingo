import React from 'react';
import { render, fireEvent, cleanup, waitForElement } from '@testing-library/react';
import PilotConsole from '../../src/back-office/components/PilotConsole';
import { request, login, newId, fileBase64 } from '../../src/back-office/pilot-api';
jest.mock('../../src/back-office/pilot-api', () => ({
  request: jest.fn(),
  login: jest.fn(),
  newId: jest.fn(),
  fileBase64: jest.fn(),
  base: 'http://localhost/api'
}));
let resolved;
const row = {
  id: 'row1',
  rowNumber: 2,
  values: { email: 'bad', telefono: 'phone' },
  effective: { email: 'bad', phone: 'phone' },
  issues: ['email_format'],
  status: 'invalid'
};
const report = {
  uniqueParticipants: 0,
  activeParticipants: 0,
  issuedCards: 0,
  excludedRows: 0,
  unresolvedRows: [],
  missingParticipantIds: [],
  extraParticipantIds: [],
  withoutCardIds: [],
  untraceableParticipantIds: [],
  inconsistentCardIds: [],
  pendingFiles: 1,
  canClose: false
};
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  resolved = false;
  newId.mockReturnValue('generated-key');
  fileBase64.mockResolvedValue('base64-csv');
  request.mockImplementation(async (path, token, options) => {
    if (path === '/me')
      return { permissions: ['editions:read', 'imports:read', 'imports:write', 'contacts:read'] };
    if (path === '/editions?limit=500') return [{ _id: 'edition1', name: 'Piloto' }];
    if (path === '/editions/edition1')
      return { _id: 'edition1', name: 'Piloto', state: 'preparation', version: resolved ? 2 : 1 };
    if (path.endsWith('/prizes')) return { version: 1, totals: {totalClp:400000,allocatedClp:0,deliveredClp:0,availableClp:400000,unassignedClp:0,pendingCreditClp:0}, pools: [], results: [], proposals: [] };
    if (path.includes('/prizes/reports/')) return { total: 0, rows: [], version: 1 };
    if (path.endsWith('/game')) return { version: 1, state: 'preparation', rules: null, round: null, rounds: [], draws: [], results: [], rosterCount: 0, pendingPrimaryCandidates: 0 };
    if (path.includes('/game/alerts?')) return { rows: [], pendingCount: 0 };
    if (path.includes('/game/candidates?')) return [];
    if (path.endsWith('/cards/summary')) return { version: 1, settings: null, pdfReady: 0, activeParticipants: 0, remaining: 0 };
    if (path.includes('/cards?')) return [];
    if (path.endsWith('/reconciliation')) return report;
    if (path.endsWith('/imports') && options) return { importId: 'file1', reused: false };
    if (path.endsWith('/imports'))
      return [{ _id: 'file1', filename: 'players.csv', version: 1, status: 'staged' }];
    if (path.includes('/preview?'))
      return {
        importId: 'file1',
        importVersion: 1,
        state: 'staged',
        filename: 'players.csv',
        summary: {
          rows: 1,
          valid: 0,
          invalid: resolved ? 0 : 1,
          duplicates: 0,
          conflicts: 0,
          resolved: resolved ? 1 : 0
        },
        rows: [{ ...row, ...(resolved ? { status: 'resolved', issues: [], outcome: 'excluded' } : {}) }]
      };
    if (path.endsWith('/resolve')) {
      resolved = true;
      return { version: 2 };
    }
    throw new Error('Unexpected route');
  });
});
afterEach(cleanup);
test('login uses staff credentials and does not require a successful legacy player fetch', async () => {
  login.mockResolvedValue('staff-token');
  const ui = render(<PilotConsole />);
  fireEvent.change(ui.getByLabelText('Email'), { target: { value: 'staff@example.invalid' } });
  fireEvent.change(ui.getByLabelText('Contraseña'), { target: { value: 'secret-password' } });
  fireEvent.submit(ui.getByText('Iniciar sesión').closest('form'));
  await waitForElement(() => ui.getByText('Selecciona una edición'));
  expect(login).toHaveBeenCalledWith('staff@example.invalid', 'secret-password');
  expect(localStorage.getItem('admin-token')).toBe('staff-token');
});
test('upload previews before apply, blocks invalid rows and sends a resolution with Polla evidence', async () => {
  localStorage.setItem('admin-token', 'staff-token');
  const ui = render(<PilotConsole />);
  await waitForElement(() => ui.getByText('Selecciona una edición'));
  fireEvent.change(ui.getByLabelText('Selecciona una edición'), { target: { value: 'edition1' } });
  await waitForElement(() => ui.getByText('Cargar y previsualizar'));
  fireEvent.change(ui.getByLabelText('Archivo CSV'), {
    target: { files: [new File(['email,telefono'], 'players.csv', { type: 'text/csv' })] }
  });
  fireEvent.change(ui.getByLabelText('Versión o referencia de Polla'), {
    target: { value: 'Polla version 1' }
  });
  fireEvent.submit(ui.getByText('Cargar y previsualizar').closest('form'));
  await waitForElement(() => ui.getByText('Resolver fila 2'));
  expect(ui.getByText('Incorporar esta versión').disabled).toBe(true);
  const upload = request.mock.calls.find((call) => call[2] && call[0].endsWith('/imports'));
  expect(JSON.parse(upload[2].body)).toEqual({
    expectedVersion: 1,
    filename: 'players.csv',
    sourceReference: 'Polla version 1',
    contentBase64: 'base64-csv'
  });
  fireEvent.click(ui.getByText('Resolver fila 2'));
  fireEvent.change(ui.getByLabelText('Tratamiento'), { target: { value: 'exclude' } });
  fireEvent.change(ui.getByLabelText('Referencia o aclaración de Polla'), {
    target: { value: 'Polla correction 2' }
  });
  fireEvent.submit(ui.getByText('Guardar resolución').closest('form'));
  await waitForElement(() => ui.getByText('Operación registrada.'));
  const resolution = request.mock.calls.find((call) => call[0].endsWith('/resolve'));
  expect(JSON.parse(resolution[2].body).decision).toEqual({
    kind: 'exclude',
    pollaReference: 'Polla correction 2'
  });
  expect(ui.getByText('Incorporar esta versión').disabled).toBe(false);
  expect(ui.getByText('Cerrar lista conciliada').disabled).toBe(true);
});
test('a role without contact/import permissions cannot see file controls', async () => {
  localStorage.setItem('admin-token', 'viewer-token');
  const implementation = request.getMockImplementation();
  request.mockImplementation((path, ...args) =>
    path === '/me' ? Promise.resolve({ permissions: ['editions:read'] }) : implementation(path, ...args)
  );
  const ui = render(<PilotConsole />);
  await waitForElement(() => ui.getByText('Selecciona una edición'));
  fireEvent.change(ui.getByLabelText('Selecciona una edición'), { target: { value: 'edition1' } });
  await waitForElement(() => ui.getByText('Tu rol no permite consultar archivos con datos personales.'));
  expect(ui.queryByLabelText('Archivo CSV')).toBeNull();
});
test('an API failure is announced and focused without hiding the login form', async () => {
  login.mockRejectedValue(new Error('Credenciales inválidas'));
  const ui = render(<PilotConsole />);
  fireEvent.submit(ui.getByText('Iniciar sesión').closest('form'));
  const alert = await waitForElement(() => ui.getByRole('alert'));
  expect(alert.textContent).toContain('Credenciales inválidas');
  expect(document.activeElement).toBe(alert);
});
