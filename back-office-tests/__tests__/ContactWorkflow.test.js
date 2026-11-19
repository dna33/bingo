import React from 'react';
import { render, fireEvent, cleanup, waitForElement } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import ContactWorkflow, { remainingSeconds } from '../../src/back-office/components/ContactWorkflow';
import { request } from '../../src/back-office/pilot-api';
jest.mock('../../src/back-office/pilot-api', () => ({ request: jest.fn() }));
let contact, props;
beforeEach(() => {
  jest.clearAllMocks();
  contact = {
    candidateId: 'c1',
    emails: ['test@example.invalid'],
    phones: ['+56900000000'],
    serverTime: '2026-11-16T20:00:00Z',
    workflow: { state: 'detected', cohort: 'primary' },
    events: []
  };
  props = {
    root: '/editions/e1/game',
    token: 'staff',
    permissions: ['game:operate', 'results:confirm'],
    busy: false,
    run: (work) => work(),
    mutate: jest.fn().mockResolvedValue({}),
    onContact: jest.fn()
  };
  request.mockImplementation(async () => contact);
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
test('countdown uses server anchor, includes exact limit and never extends a deadline', () => {
  expect(remainingSeconds('2026-11-16T20:01:00Z', '2026-11-16T20:00:00Z', 1200)).toBe(59);
  expect(remainingSeconds('2026-11-16T20:01:00Z', '2026-11-16T20:01:00Z')).toBe(0);
  expect(remainingSeconds('2026-11-16T20:01:00Z', '2026-11-16T20:02:00Z')).toBe(0);
  expect(remainingSeconds(null, '2026-11-16T20:00:00Z')).toBeNull();
});
test('attempt requires channel and evidence; target recipient is never supplied by the browser', async () => {
  const ui = render(<ContactWorkflow {...props} contact={contact} />);
  expect(ui.getByText('Registrar intento de contacto').disabled).toBe(true);
  fireEvent.change(ui.getByLabelText('Canal registrado'), { target: { value: 'email' } });
  fireEvent.change(ui.getByLabelText('Evidencia de contacto o respuesta'), {
    target: { value: 'Attempt evidence' }
  });
  await act(async () => {
    fireEvent.click(ui.getByText('Registrar intento de contacto'));
  });
  await waitForElement(() => ui.getByText('Seguimiento de contacto · Detectado'));
  expect(props.mutate).toHaveBeenCalledWith('candidates/c1/begin', {
    channel: 'email',
    evidence: 'Attempt evidence'
  });
});
test('failed and successful notice have separate explicit outcomes, and neither action supplies clock values', async () => {
  contact.workflow = {
    state: 'contacting',
    cohort: 'primary',
    channel: 'email',
    recipient: 'saved@example.invalid'
  };
  const ui = render(<ContactWorkflow {...props} contact={contact} />);
  expect(ui.getByText('Destinatario del intento: email · saved@example.invalid.')).toBeTruthy();
  fireEvent.change(ui.getByLabelText('Evidencia de contacto o respuesta'), {
    target: { value: 'Failure evidence' }
  });
  await act(async () => {
    fireEvent.click(ui.getByText('Registrar aviso fallido sin iniciar plazo'));
  });
  expect(props.mutate).toHaveBeenCalledWith('candidates/c1/notice', {
    success: false,
    evidence: 'Failure evidence'
  });
  await waitForElement(() => ui.getByText('Seguimiento de contacto · Contactando'));
  fireEvent.change(ui.getByLabelText('Evidencia de contacto o respuesta'), {
    target: { value: 'Notice success evidence' }
  });
  await act(async () => {
    fireEvent.click(ui.getByText('Confirmar aviso exitoso e iniciar 60 segundos'));
  });
  expect(props.mutate).toHaveBeenCalledWith('candidates/c1/notice', {
    success: true,
    evidence: 'Notice success evidence'
  });
});
test('expired candidate accepts documented receipt time or explicit no-response review, never an automatic discard', async () => {
  contact.workflow = {
    state: 'awaiting_response',
    cohort: 'primary',
    contactStartedAt: '2026-11-16T19:58:00Z',
    expiresAt: '2026-11-16T19:59:00Z'
  };
  const ui = render(<ContactWorkflow {...props} contact={contact} />);
  expect(ui.getByRole('timer').textContent).toContain('Plazo vencido');
  expect(props.mutate).not.toHaveBeenCalled();
  fireEvent.change(ui.getByLabelText('Evidencia de contacto o respuesta'), {
    target: { value: 'Receipt in channel' }
  });
  fireEvent.change(ui.getByLabelText('Hora de recepción de respuesta (ISO con zona horaria)'), {
    target: { value: '2026-11-16T19:58:59Z' }
  });
  expect(ui.getByText('Resolver descarte por falta de respuesta').disabled).toBe(true);
  await act(async () => {
    fireEvent.click(ui.getByText('Registrar respuesta y resolver'));
  });
  expect(props.mutate).toHaveBeenCalledWith('candidates/c1/respond', {
    receivedAt: '2026-11-16T19:58:59Z',
    evidence: 'Receipt in channel'
  });
  await waitForElement(() => ui.getByText('Seguimiento de contacto · Esperando respuesta'));
});
test('discard needs explicit review and terminal or reserve states expose no resolution controls', async () => {
  contact.workflow = {
    state: 'awaiting_response',
    cohort: 'primary',
    contactStartedAt: '2026-11-16T19:58:00Z',
    expiresAt: '2026-11-16T19:59:00Z'
  };
  const ui = render(<ContactWorkflow {...props} contact={contact} />);
  fireEvent.change(ui.getByLabelText('Evidencia de contacto o respuesta'), {
    target: { value: 'Channel reviewed' }
  });
  fireEvent.click(ui.getByLabelText('Revisé el canal: no hay respuesta oportuna pendiente de registrar.'));
  await act(async () => {
    fireEvent.click(ui.getByText('Resolver descarte por falta de respuesta'));
  });
  expect(props.mutate).toHaveBeenCalledWith('candidates/c1/discard', {
    reviewedNoTimelyResponse: true,
    evidence: 'Channel reviewed'
  });
  ui.rerender(
    <ContactWorkflow
      {...props}
      contact={{ ...contact, workflow: { state: 'confirmed', cohort: 'primary' } }}
    />
  );
  expect(ui.queryByText('Registrar respuesta y resolver')).toBeNull();
  ui.rerender(
    <ContactWorkflow
      {...props}
      contact={{ ...contact, workflow: { state: 'detected', cohort: 'reserve' } }}
    />
  );
  expect(ui.queryByText('Registrar intento de contacto')).toBeNull();
});

test('lost synchronization disables resolution while preserving the original deadline estimate', async () => {
  jest.useFakeTimers();
  request.mockRejectedValue(new Error('Offline'));
  contact.workflow = {
    state: 'awaiting_response',
    cohort: 'primary',
    contactStartedAt: '2026-11-16T20:00:00Z',
    expiresAt: '2026-11-16T20:01:00Z'
  };
  const ui = render(<ContactWorkflow {...props} contact={contact} />);
  await act(async () => {
    jest.advanceTimersByTime(6000);
  });
  expect(ui.getByText('Sin sincronización reciente. Actualiza el contacto antes de resolver.')).toBeTruthy();
  expect(ui.getByText('Registrar respuesta y resolver').disabled).toBe(true);
  expect(ui.getByRole('timer').textContent).toContain('54 segundos');
  expect(props.mutate).not.toHaveBeenCalled();
});
