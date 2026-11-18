import React, { useEffect, useRef, useState } from 'react';
import { request } from '../pilot-api';
export function tone(context) {
  if (context.state !== 'running') throw new Error('El navegador suspendió el sonido. Habilítalo otra vez.');
  const oscillator = context.createOscillator(),
    gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
export default function CandidateAlerts({ root, token, canOperate, busy, run, mutate, refreshVersion }) {
  const [data, setData] = useState({ rows: [], pendingCount: 0 }),
    [error, setError] = useState(''),
    [history, setHistory] = useState(false),
    [offset, setOffset] = useState(0),
    [sound, setSound] = useState(false),
    [soundError, setSoundError] = useState('');
  const audio = useRef(null),
    controller = useRef(null),
    pending = useRef(0),
    latestAlert = useRef(''),
    soundEnabled = useRef(false),
    lastTone = useRef(-Infinity);
  function play() {
    // Avoid two overlapping pulses when a new alert arrives next to the repeat tick.
    if (performance.now() - lastTone.current < 250) return;
    tone(audio.current);
    lastTone.current = performance.now();
  }
  function audioFailure(failure) {
    soundEnabled.current = false;
    setSound(false);
    setSoundError(failure.message);
  }
  function load() {
    return controller.current ? controller.current.refresh() : Promise.resolve();
  }
  useEffect(() => {
    pending.current = 0;
    latestAlert.current = '';
    setData({ rows: [], pendingCount: 0 });
    setError('');
  }, [root, token]);
  useEffect(() => {
    const current = { closed: false, dirty: false, promise: null, version: refreshVersion };
    current.refresh = () => {
      current.dirty = true;
      if (current.promise) return current.promise;
      current.promise = (async () => {
        do {
          current.dirty = false;
          const requestedVersion = current.version;
          try {
            const next = await request(`${root}/alerts?limit=25&offset=${offset}&pending=${!history}`, token);
            if (current.closed) return;
            if (
              Number.isSafeInteger(next.version) &&
              Number.isSafeInteger(current.version) &&
              next.version < current.version
            ) {
              // A commit observed during this request gets one coalesced follow-up.
              if (current.version !== requestedVersion) {
                current.dirty = true;
                continue;
              }
              throw new Error('El servidor todavía no refleja la versión conocida de la partida.');
            }
            setData(next);
            const newest = offset === 0 && next.rows[0];
            const alertKey = newest ? `${newest.createdAt || ''}:${newest._id}` : '';
            const freshAlert = Boolean(newest && alertKey > latestAlert.current && !newest.acknowledgedAt);
            if (alertKey > latestAlert.current) latestAlert.current = alertKey;
            if ((next.pendingCount > pending.current || freshAlert) && soundEnabled.current) {
              try {
                play();
              } catch (failure) {
                audioFailure(failure);
              }
            }
            pending.current = next.pendingCount;
            setError('');
          } catch (failure) {
            if (!current.closed)
              setError('No se pudieron actualizar las alertas. Se conservan las anteriores.');
          }
        } while (current.dirty && !current.closed);
      })().finally(() => {
        current.promise = null;
        if (current.dirty && !current.closed) return current.refresh();
        return undefined;
      });
      return current.promise;
    };
    controller.current = current;
    current.refresh();
    const timer = setInterval(current.refresh, 2000);
    return () => {
      current.closed = true;
      clearInterval(timer);
      if (controller.current === current) controller.current = null;
    };
  }, [root, token, history, offset]);
  useEffect(() => {
    const current = controller.current;
    if (current && current.version !== refreshVersion) {
      current.version = refreshVersion;
      current.refresh();
    }
  }, [refreshVersion]);
  useEffect(() => {
    if (!sound) return undefined;
    const timer = setInterval(() => {
      if (pending.current < 1) return;
      try {
        play();
      } catch (failure) {
        audioFailure(failure);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [sound]);
  useEffect(
    () => () => {
      if (audio.current) audio.current.close();
    },
    []
  );
  async function enableSound() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context)
        throw new Error('Este navegador no ofrece audio. Usa el navegador operativo y revisa su volumen.');
      if (!audio.current) audio.current = new Context();
      await audio.current.resume();
      play();
      soundEnabled.current = true;
      setSound(true);
      setSoundError('');
    } catch (failure) {
      audioFailure(failure);
    }
  }
  return (
    <section className="candidate-alerts" aria-label="Alertas de candidatos">
      <h3>Alertas de candidatos</h3>
      <p role="status">
        {data.pendingCount} alertas sin reconocer. Reconocer no confirma premios ni inicia el minuto.
      </p>
      {error && <p role="alert">{error}</p>}
      <button onClick={enableSound}>Habilitar y probar sonido</button>
      <button
        disabled={!sound}
        onClick={() => {
          soundEnabled.current = false;
          setSound(false);
        }}
      >
        Silenciar en esta consola
      </button>
      <p>
        {sound
          ? 'Sonido habilitado: se repetirá mientras existan alertas sin reconocer.'
          : 'Sonido deshabilitado en esta consola.'}
      </p>
      {soundError && <p role="alert">{soundError}</p>}
      <label>
        <input
          type="checkbox"
          checked={history}
          onChange={(e) => {
            setHistory(e.target.checked);
            setOffset(0);
          }}
        />
        Consultar también alertas reconocidas
      </label>
      <ul>
        {data.rows.map((alert) => (
          <li key={alert._id} className={!alert.acknowledgedAt ? 'unacknowledged' : ''}>
            <strong>
              Figura {alert.figure} · {alert.candidateCount} candidatos
            </strong>
            {' · '}
            {alert.cohort === 'primary' ? 'Primera bolilla ganadora' : 'Reservas'}
            {' · extracción '}
            {alert.sequence} · {alert.createdAt}
            {alert.acknowledgedAt ? (
              <p>
                Reconocida: {alert.acknowledgedAt} · operador {alert.acknowledgedBy}
              </p>
            ) : (
              canOperate && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await mutate(`alerts/${alert._id}/acknowledge`);
                      await load();
                    })
                  }
                >
                  Reconocer alerta {alert.figure} · extracción {alert.sequence}
                </button>
              )
            )}
            <p>
              Consultar todos: ronda {alert.roundId}, figura {alert.figure}, grupo {alert.cohort}, extracción{' '}
              {alert.sequence}.
            </p>
          </li>
        ))}
      </ul>
      <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
        Alertas anteriores
      </button>
      <button disabled={data.rows.length < 25} onClick={() => setOffset(offset + 25)}>
        Más alertas
      </button>
      {canOperate && (
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              await mutate('alerts/reconcile');
              await load();
            })
          }
        >
          Recuperar alertas de candidaturas existentes
        </button>
      )}
    </section>
  );
}
