import React from 'react';
import { render, fireEvent, cleanup, waitForElement } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import CandidateAlerts from '../../src/back-office/components/CandidateAlerts';
import { request } from '../../src/back-office/pilot-api';
jest.mock('../../src/back-office/pilot-api', () => ({ request: jest.fn() }));
let props, data, oscillator, context;
beforeEach(() => {
  jest.clearAllMocks();
  data = {
    rows: [{ _id: 'a1', figure: 'F', candidateCount: 3, sequence: 5, cohort: 'primary', roundId: 'r1' }],
    pendingCount: 1
  };
  request.mockImplementation(async () => data);
  props = {
    root: '/editions/e1/game',
    token: 'staff',
    canOperate: true,
    busy: false,
    run: (work) => work(),
    mutate: jest.fn().mockResolvedValue({})
  };
  oscillator = {
    frequency: {},
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    disconnect: jest.fn()
  };
  context = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: jest.fn().mockResolvedValue(),
    close: jest.fn(),
    createOscillator: jest.fn(() => oscillator),
    createGain: () => ({ gain: {}, connect: jest.fn(), disconnect: jest.fn() })
  };
  window.AudioContext = jest.fn(() => context);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  delete window.AudioContext;
});
test('alert remains visible until acknowledgement, with full tie count and archived recognition', async () => {
  props.mutate.mockImplementation(async () => {
    data = { rows: [], pendingCount: 0 };
  });
  const ui = render(<CandidateAlerts {...props} />);
  await waitForElement(() => ui.getByText('Figura F · 3 candidatos'));
  expect(props.mutate).not.toHaveBeenCalled();
  expect(context.resume).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText('Reconocer alerta F · extracción 5'));
  await waitForElement(() =>
    ui.getByText('0 alertas sin reconocer. Reconocer no confirma premios ni inicia el minuto.')
  );
  expect(props.mutate).toHaveBeenCalledWith('alerts/a1/acknowledge');
  await act(async () => {
    fireEvent.click(ui.getByLabelText('Consultar también alertas reconocidas'));
  });
  expect(request.mock.calls.some((call) => call[0].includes('pending=false'))).toBe(true);
});
test('sound requires explicit enable and repeats until pending count clears; mute stops it', async () => {
  jest.useFakeTimers();
  const ui = render(<CandidateAlerts {...props} />);
  await act(async () => {});
  expect(oscillator.start).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(ui.getByText('Habilitar y probar sonido'));
  });
  expect(context.resume).toHaveBeenCalledTimes(1);
  expect(oscillator.start).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  expect(oscillator.start).toHaveBeenCalledTimes(2);
  fireEvent.click(ui.getByText('Silenciar en esta consola'));
  await act(async () => {
    jest.advanceTimersByTime(4000);
  });
  expect(oscillator.start).toHaveBeenCalledTimes(2);
});
test('audio failure is visible and a viewer cannot acknowledge or recover alerts', async () => {
  context.resume.mockRejectedValue(new Error('Audio bloqueado por navegador'));
  const ui = render(<CandidateAlerts {...props} canOperate={false} />);
  await waitForElement(() => ui.getByText('Figura F · 3 candidatos'));
  expect(ui.queryByText('Reconocer alerta F · extracción 5')).toBeNull();
  expect(ui.queryByText('Recuperar alertas de candidaturas existentes')).toBeNull();
  fireEvent.click(ui.getByText('Habilitar y probar sonido'));
  await waitForElement(() => ui.getByText('Audio bloqueado por navegador'));
  expect(oscillator.start).not.toHaveBeenCalled();
});

test('a committed game version refreshes immediately without waiting for polling; unrelated renders do not refetch', async () => {
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  await waitForElement(() => ui.getByText('Figura F · 3 candidatos'));
  expect(request).toHaveBeenCalledTimes(1);
  ui.rerender(<CandidateAlerts {...props} busy refreshVersion={4} />);
  expect(request).toHaveBeenCalledTimes(1);
  data = { version: 5, rows: [{ ...data.rows[0], _id: 'a2', candidateCount: 7 }], pendingCount: 2 };
  await act(async () => {
    ui.rerender(<CandidateAlerts {...props} refreshVersion={5} />);
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(ui.getByText('Figura F · 7 candidatos')).toBeTruthy();
});

test('in-flight reads coalesce newer versions and reject an old snapshot before displaying the follow-up', async () => {
  let resolveFirst, resolveSecond;
  request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        })
    );
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  ui.rerender(<CandidateAlerts {...props} refreshVersion={5} />);
  ui.rerender(<CandidateAlerts {...props} refreshVersion={6} />);
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveFirst({ ...data, version: 4 });
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(ui.queryByText('Figura F · 3 candidatos')).toBeNull();
  await act(async () => {
    resolveSecond({ version: 6, rows: [{ ...data.rows[0], candidateCount: 9 }], pendingCount: 1 });
  });
  expect(ui.getByText('Figura F · 9 candidatos')).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(2);
});

test('changing editions ignores late responses from the previous context', async () => {
  let oldResponse;
  request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResponse = resolve;
        })
    )
    .mockResolvedValue({ version: 2, rows: [{ ...data.rows[0], _id: 'new', figure: 'O' }], pendingCount: 1 });
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  await act(async () => {
    ui.rerender(<CandidateAlerts {...props} root="/editions/e2/game" refreshVersion={2} />);
  });
  expect(ui.getByText('Figura O · 3 candidatos')).toBeTruthy();
  await act(async () => {
    oldResponse({ ...data, version: 4 });
  });
  expect(ui.queryByText('Figura F · 3 candidatos')).toBeNull();
  expect(ui.getByText('Figura O · 3 candidatos')).toBeTruthy();
});

test('failed fast refresh keeps durable rows visible and fallback polling recovers', async () => {
  jest.useFakeTimers();
  request
    .mockResolvedValueOnce({ ...data, version: 4 })
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue({ version: 5, rows: [], pendingCount: 0 });
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  await act(async () => {});
  await act(async () => {
    ui.rerender(<CandidateAlerts {...props} refreshVersion={5} />);
  });
  expect(ui.getByText('Figura F · 3 candidatos')).toBeTruthy();
  expect(ui.getByText('No se pudieron actualizar las alertas. Se conservan las anteriores.')).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(ui.queryByText('Figura F · 3 candidatos')).toBeNull();
  expect(ui.queryByText('No se pudieron actualizar las alertas. Se conservan las anteriores.')).toBeNull();
});

test('a server snapshot behind the known version produces an error and bounded fallback, not a request loop', async () => {
  jest.useFakeTimers();
  request.mockResolvedValue({ ...data, version: 3 });
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(1);
  expect(ui.queryByText('Figura F · 3 candidatos')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(request).toHaveBeenCalledTimes(2);
});

test('enabled sound announces a new persistent alert immediately instead of waiting for the repeat timer', async () => {
  jest.useFakeTimers();
  data = { version: 4, rows: [], pendingCount: 0 };
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  await act(async () => {});
  await act(async () => {
    fireEvent.click(ui.getByText('Habilitar y probar sonido'));
  });
  expect(oscillator.start).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  data = {
    version: 5,
    rows: [{ _id: 'a2', figure: 'F', candidateCount: 3, cohort: 'primary', sequence: 5 }],
    pendingCount: 1
  };
  await act(async () => {
    ui.rerender(<CandidateAlerts {...props} refreshVersion={5} />);
  });
  expect(oscillator.start).toHaveBeenCalledTimes(2);
  expect(props.mutate).not.toHaveBeenCalled();
});

test('a replacement alert sounds even if recognition elsewhere keeps the pending count unchanged', async () => {
  jest.useFakeTimers();
  const ui = render(<CandidateAlerts {...props} refreshVersion={4} />);
  await act(async () => {});
  await act(async () => {
    fireEvent.click(ui.getByText('Habilitar y probar sonido'));
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  data = { ...data, version: 5, rows: [{ ...data.rows[0], _id: 'a2' }] };
  await act(async () => {
    ui.rerender(<CandidateAlerts {...props} refreshVersion={5} />);
  });
  expect(oscillator.start).toHaveBeenCalledTimes(2);
});
