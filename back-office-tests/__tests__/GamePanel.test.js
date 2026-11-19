import React from 'react';
import { render, fireEvent, cleanup, waitForElement } from '@testing-library/react';
import GamePanel from '../../src/back-office/components/GamePanel';
import { request, newId } from '../../src/back-office/pilot-api';
import { proposedFigures } from '../../src/back-office/game-patterns';
jest.mock('../../src/back-office/pilot-api', () => ({ request: jest.fn(), newId: jest.fn() }));
const edition = { _id: 'edition1', version: 4, name: 'Piloto', listClosedAt: '2026-11-16T12:00:00Z' };
let frame, rows, changed;
beforeEach(() => {
  jest.clearAllMocks();
  let key = 0;
  newId.mockImplementation(() => `request-${++key}`);
  frame = {
    version: 4,
    state: 'playing',
    rosterCount: 2,
    pendingPrimaryCandidates: 0,
    incidentCount: 0,
    rulesVersion: 3,
    rules: {
      roundMode: 'independent',
      extractionMode: 'manual',
      repeatWinners: true,
      pauseDuringContact: false,
      figures: proposedFigures()
    },
    round: { _id: 'round1', ordinal: 0, figures: ['F'], minNumber: 1, maxNumber: 75, progress: [] },
    rounds: [],
    results: [],
    draws: []
  };
  rows = [];
  changed = jest.fn().mockResolvedValue();
  request.mockImplementation(async (path, token, options) => {
    if (path.endsWith('/prizes'))
      return {
        version: 1,
        totals: {
          totalClp: 400000,
          allocatedClp: 0,
          deliveredClp: 0,
          availableClp: 400000,
          unassignedClp: 0,
          pendingCreditClp: 0
        },
        pools: [],
        results: [],
        proposals: []
      };
    if (path.includes('/prizes/reports/')) return { total: 0, rows: [], version: 1 };
    if (path.endsWith('/game')) return { ...frame };
    if (path.includes('/alerts?')) return { rows: [], pendingCount: 0 };
    if (path.includes('/candidates?')) return rows;
    if (path.endsWith('/contact'))
      return {
        figure: 'F',
        name: 'Private name',
        emails: ['private@example.invalid'],
        phones: ['+56900000000'],
        deliveries: []
      };
    if (options) {
      const body = JSON.parse(options.body);
      if (path.endsWith('/draw')) {
        frame = {
          ...frame,
          version: 5,
          draws: [
            {
              _id: 'draw1',
              number: body.number === undefined ? 31 : body.number,
              sequence: 1,
              origin: frame.rules.extractionMode
            }
          ]
        };
        return { version: 5, number: frame.draws[0].number };
      }
      frame = { ...frame, version: 5 };
      return { version: 5 };
    }
    return [];
  });
});
afterEach(cleanup);
test('physical number is reviewed before submission and confirmation sends the reviewed official version', async () => {
  const ui = render(
    <GamePanel edition={edition} token="staff" permissions={['game:operate']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByLabelText('Número del bolillero físico'));
  fireEvent.change(ui.getByLabelText('Número del bolillero físico'), { target: { value: '17' } });
  fireEvent.submit(ui.getByText('Revisar número').closest('form'));
  expect(request.mock.calls.every((call) => !call[2])).toBe(true);
  fireEvent.click(ui.getByText('Confirmar número 17'));
  await waitForElement(() => ui.getByText('Número oficial confirmado: 17.'));
  const sent = JSON.parse(request.mock.calls.find((call) => call[0].endsWith('/draw'))[2].body);
  expect(sent).toEqual({ expectedVersion: 4, number: 17, roundId: 'round1' });
  expect(request.mock.calls.filter((call) => call[0].includes('/alerts?')).length).toBeGreaterThan(1);
});
test('digital extraction sends no client-selected number; viewer has no operating controls', async () => {
  frame.rules.extractionMode = 'digital';
  const ui = render(
    <GamePanel edition={edition} token="staff" permissions={['game:operate']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Extraer número digital'));
  fireEvent.click(ui.getByText('Extraer número digital'));
  await waitForElement(() => ui.getByText('Número oficial confirmado: 31.'));
  const sent = JSON.parse(request.mock.calls.find((call) => call[0].endsWith('/draw'))[2].body);
  expect(sent).toEqual({ expectedVersion: 4, roundId: 'round1' });
  cleanup();
  const readonly = render(
    <GamePanel edition={edition} token="viewer" permissions={['participants:read']} onChanged={changed} />
  );
  await waitForElement(() => readonly.getByText('Último número oficial: 31 · extracción 1'));
  expect(readonly.queryByText('Extraer número digital')).toBeNull();
  expect(readonly.queryByText('Pausar partida')).toBeNull();
});
test('all ties are counted and contacts are fetched only by an authorized explicit action', async () => {
  frame.results = [
    {
      _id: 'result1',
      figure: 'F',
      poolClp: 50000,
      firstSequence: 1,
      primaryCandidateCount: 2,
      reserveCandidateCount: 1
    }
  ];
  rows = ['a', 'b'].map((id) => ({
    _id: id,
    figure: 'F',
    cardId: `card-${id}`,
    cohort: 'primary',
    state: 'detected',
    evidence: {
      number: 1,
      sequence: 1,
      mask: proposedFigures()[0].mask,
      cells: Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1))
    }
  }));
  const ui = render(
    <GamePanel
      edition={edition}
      token="staff"
      permissions={['participants:read', 'contacts:read']}
      onChanged={changed}
    />
  );
  await waitForElement(() => ui.getByText('Consultar contacto a'));
  expect(ui.getByText('Primera bolilla: 1 · 2 candidatos empatados.')).toBeTruthy();
  expect(ui.queryByText('private@example.invalid')).toBeNull();
  fireEvent.click(ui.getByText('Consultar contacto a'));
  await waitForElement(() => ui.getByLabelText('Contacto privado del candidato'));
  expect(ui.getByLabelText('Contacto privado del candidato').textContent).toContain(
    'private@example.invalid'
  );
});
test('near-miss alerts show the configured distances and stay silent for distances without pending cards', async () => {
  frame.rules.nearMissThresholds = [1, 2];
  frame.round.progress = [
    { figure: 'F', nearCards: [], proximityCounts: { 1: 3, 2: 0 } }
  ];
  frame.results = [
    {
      _id: 'result1',
      figure: 'F',
      poolClp: 50000,
      firstSequence: null,
      primaryCandidateCount: 0,
      reserveCandidateCount: 0
    }
  ];
  const ui = render(
    <GamePanel edition={edition} token="staff" permissions={['game:operate']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText(/3 cartones a 1 extracción de completar F/));
  expect(ui.queryByText(/extracciones de completar F/)).toBeNull();
});
test('the selected contact-pause policy blocks resume while primary candidates are unresolved', async () => {
  frame.state = 'paused';
  frame.rules.pauseDuringContact = true;
  frame.pendingPrimaryCandidates = 2;
  const ui = render(
    <GamePanel edition={edition} token="staff" permissions={['game:operate']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Reanudar partida'));
  expect(ui.getByText('Reanudar partida').disabled).toBe(true);
  expect(ui.queryByText('Revisar número')).toBeNull();
});
test('draft rules require explicit modalities, policies and mask review before confirmation', async () => {
  frame.state = 'preparation';
  frame.rules = null;
  frame.round = null;
  const ui = render(
    <GamePanel edition={edition} token="staff" permissions={['editions:configure']} onChanged={changed} />
  );
  await waitForElement(() => ui.getByText('Confirmar reglas del juego'));
  expect(ui.getByLabelText('Modalidad de rondas').value).toBe('');
  const choices = {
    'Modalidad de rondas': 'independent',
    'Modalidad de extracción': 'manual',
    'Puede ganar varias figuras': 'true',
    'Pausar al detectar candidatos': 'false',
    'Política de pesos residuales': 'auditable_residual_draw',
    'Parte de quienes no responden': 'redistribute_confirmed',
    'Si nadie responde': 'advance_keep_unassigned',
    'Inicio del minuto': 'operator_confirms_notice'
  };
  Object.entries(choices).forEach(([label, value]) =>
    fireEvent.change(ui.getByLabelText(label), { target: { value } })
  );
  fireEvent.click(ui.getByLabelText('He revisado las máscaras y las reglas con el equipo de Fabuloso.'));
  fireEvent.change(ui.getByLabelText('Referencia de confirmación de reglas'), {
    target: { value: 'Synthetic review' }
  });
  fireEvent.submit(ui.getByText('Confirmar reglas del juego').closest('form'));
  await waitForElement(() => ui.getByText('Operación registrada en el historial oficial.'));
  const body = JSON.parse(request.mock.calls.find((call) => call[0].endsWith('/configure'))[2].body);
  expect(body.settings.figures).toHaveLength(7);
  expect(body.settings.maskReviewConfirmed).toBe(true);
  expect(body.settings.repeatWinners).toBe(true);
});
