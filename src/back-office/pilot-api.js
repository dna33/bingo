import ApiConsts from '../API/api-consts';
const base = ApiConsts.PILOT;
const messages = {
  prize_pending_settlement: 'Valida el reparto o cierre del pozo actual antes de pasar a otra figura.',
  prize_budget: 'El presupuesto y sus registros no concilian. Se bloqueó la operación; revisa la incidencia.',
  prize_legacy: 'Existen premios sin contabilidad de esta etapa; requieren conciliación antes de operar.',
  prize_evidence: 'Registra motivo o evidencia de la operación (hasta 2.000 caracteres).',
  prize_account: 'Ingresa una referencia de cuenta válida y confirma su pertenencia con Polla.',
  prize_account_locked:
    'La cuenta quedó congelada al aprobar un reparto. No puede cambiarse desde este flujo.',
  prize_account_duplicate: 'Esa cuenta ya está vinculada a otra persona de esta edición.',
  prize_account_missing:
    'Faltan cuentas Polla verificadas de candidatos confirmados. Revisa el reporte de respuestas oportunas.',
  prize_result_state: 'La figura no tiene un grupo disponible para este reparto.',
  prize_pending_responses:
    'Resuelve todos los contactos del grupo, incluidos vencidos pendientes de conciliación.',
  prize_group: 'El grupo o sus cartones no concilian con el resultado oficial.',
  prize_response_evidence: 'La candidatura no tiene una respuesta oportuna acreditada para esta operación.',
  prize_already_allocated: 'Esta candidatura o propuesta ya tiene una adjudicación registrada.',
  prize_proposal_stale: 'La propuesta no coincide con los saldos y el grupo actuales. Revisa la incidencia.',
  prize_review: 'Confirma la revisión del grupo, cuentas, montos y destino del remanente.',
  prize_exhaustion_review:
    'Confirma expresamente el cierre como no asignado al agotarse los cartones elegibles.',
  prize_waiting_candidates: 'Aún hay cartones elegibles: continúa las extracciones para disputar este saldo.',
  prize_continuation_state:
    'La redisputa requiere que esta ronda siga abierta para extraer o promover reservas.',
  prize_credit: 'El abono debe coincidir con monto completo, cuenta verificada y comprobante del premio.',
  prize_credit_date: 'La fecha efectiva del abono necesita zona horaria y no puede estar en el futuro.',
  prize_already_credited: 'Este premio ya está abonado o no tiene una adjudicación válida.',
  prize_credit_duplicate: 'Ese comprobante ya se registró para un abono en esta edición.',

  contact_state: 'Actualiza el candidato: esta acción no corresponde a su estado de contacto.',
  contact_resolved: 'El candidato ya tiene una resolución. El historial y el plazo se conservan.',
  contact_reserve: 'Esta candidatura está en reserva; su habilitación depende del reparto de la etapa 7.',
  contact_result_closed: 'El resultado ya está cerrado y no admite cambios de contacto.',
  contact_evidence: 'Registra evidencia del aviso, respuesta o revisión (hasta 2.000 caracteres).',
  contact_recipient: 'El participante no tiene destinatario registrado para ese canal.',
  contact_response_time: 'La recepción debe ser posterior al aviso y no puede estar en el futuro.',
  contact_not_expired: 'Todavía no venció el minuto individual de respuesta.',
  contact_review_required: 'Revisa el canal y confirma que no hay una respuesta oportuna pendiente.',
  game_configuration:
    'Completa las modalidades y políticas del juego y confirma la revisión de las máscaras.',
  game_round_mode: 'Elige una modalidad de rondas válida.',
  game_extraction_mode: 'Elige una modalidad de extracción válida.',
  game_repeat_winners: 'Indica si un cartón puede ganar más de una figura.',
  game_pause_contact: 'Indica si la partida se pausa al detectar candidatos.',
  game_rounding_policy: 'Elige la política de pesos residuales.',
  game_discard_policy: 'Elige qué pasa con la parte de quienes no responden.',
  game_no_response_policy: 'Elige qué pasa si nadie responde.',
  game_contact_clock: 'Elige cuándo inicia el minuto de contacto.',
  game_mask_review: 'Marca la casilla de revisión de máscaras y reglas.',
  game_confirmation_reference: 'Ingresa una referencia de confirmación de reglas (hasta 1.000 caracteres).',
  game_order: 'El orden de figuras debe listar F,A,B,U,L,S,O exactamente una vez cada una.',
  game_figures_set: 'Debe haber exactamente siete figuras, con nombres F,A,B,U,L,S,O sin repetir.',
  game_near_miss: 'Los umbrales de alerta deben ser enteros entre 1 y 20, sin repetir (máximo 10).',
  game_cross_figure_policy:
    'Las figuras simultáneas requieren permitir varias figuras por persona; falta definir la otra prioridad.',
  game_mask:
    'Revisa las siete máscaras de 5 × 5 y los pozos: U (Binguito) $100.000, F (letra completa) $300.000, el resto en $0.',
  game_configuration_required: 'Confirma primero las reglas y máscaras del juego.',
  game_frozen: 'Las reglas quedaron congeladas al preparar la partida.',
  game_state: 'Esta acción no corresponde al estado actual. Actualiza la partida.',
  game_roster_exists: 'La lista de cartones ya quedó congelada para esta partida.',
  game_pending_contact:
    'Hay candidatos pendientes de respuesta. Resuélvelos antes de reanudar o avanzar según las reglas elegidas.',
  game_rounds_complete: 'No hay otra ronda independiente configurada.',
  game_round_changed: 'La ronda cambió. Actualiza y revisa la extracción antes de confirmar.',
  game_exhausted: 'Ya se extrajeron todos los números de esta ronda.',
  game_digital_number: 'La extracción digital elige el número en el servidor; no admite uno ingresado.',
  game_duplicate: 'Ese número ya está registrado en la ronda. El historial no se modificó.',
  game_round_incomplete: 'Todavía no se detectaron candidatos para completar esta ronda.',
  game_roster_integrity:
    'La copia congelada de cartones presenta una inconsistencia. Registra y revisa la incidencia.',

  delivery_list_not_final: 'Cierra la lista conciliada con sus PDFs antes de encolar la entrega.',
  delivery_uncertain: 'Hay un envío en curso o incierto. Reconcílialo antes de volver a enviar.',
  delivery_still_pending: 'La entrega sigue pendiente. Procésala antes de solicitar un reenvío.',
  delivery_participant_inactive: 'La persona ya no está activa en la edición. Revisa la incidencia.',
  delivery_not_retryable: 'Este estado no permite otro intento. Un reenvío debe ser explícito.',
  delivery_event_conflict: 'La confirmación simulada contradice el estado o pertenece a otro intento.',

  card_variant: 'Confirma una variante válida: al menos 24 números, entre 1 y 1000; B/I/N/G/O exige 1–75.',
  card_title:
    'El título admite caracteres latinos y acentos. Sustituye emojis u otros caracteres no disponibles.',
  card_confirmation_required: 'Un administrador debe confirmar las reglas de los cartones antes de emitir.',
  card_settings_locked:
    'Los cartones ya emitidos mantienen su configuración. No se puede cambiar la variante o sus datos impresos.',
  card_collision: 'No se encontró una disposición única. No se guardó el lote; vuelve a intentarlo.',
  pdf_integrity:
    'El PDF no coincide con su huella guardada. Registra la incidencia y restaura una copia válida.',
  pdf_missing: 'Falta el PDF. Usa la recuperación para reconstruirlo desde el cartón guardado.',
  card_legacy:
    'Este cartón previo no tiene una ficha de emisión completa. Requiere revisión; sus números no se reemplazarán.',

  csv_headers: 'Usa encabezados email y telefono, con jugador_id y nombre opcionales, separados por comas.',
  csv_utf8: 'Guarda el archivo con codificación UTF-8.',
  csv_syntax: 'Revisa las comillas y separadores del CSV.',
  csv_empty: 'El archivo debe contener al menos una fila de participantes.',
  csv_encoding: 'No se pudo leer el archivo.',
  csv_size: 'El archivo supera el límite de 5 MiB.',
  csv_rows: 'El archivo supera el límite técnico de 50.000 filas.',
  import_unresolved: 'Resuelve todas las filas inválidas y con conflictos antes de incorporar.',
  import_superseded: 'Existe una versión más reciente. Revisa esa versión antes de incorporar.',
  list_frozen: 'La lista está cerrada o la edición ya salió de preparación.',
  import_already_applied: 'Esta versión ya se incorporó. Carga una nueva versión para corregirla.',
  reconciliation_incomplete: 'No se puede cerrar: revisa participantes, diferencias y cartones pendientes.'
};
export async function request(path, token, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(
      messages[data.code] ||
        (response.status === 401
          ? 'Inicia sesión con una cuenta de personal activa.'
          : response.status === 403
            ? 'Tu cuenta no tiene permiso para esta operación.'
            : response.status === 409
              ? 'La edición cambió. Actualiza los datos antes de reintentar.'
              : 'Revisa los datos e inténtalo de nuevo.')
    );
  }
  return response.json();
}
export async function login(email, password) {
  const response = await fetch(ApiConsts.LOGIN_ADMIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error('No se pudo iniciar sesión. Revisa tus credenciales y activación.');
  return (await response.json()).token;
}
export function newId() {
  return Array.from(window.crypto.getRandomValues(new Uint8Array(12)), (n) =>
    n.toString(16).padStart(2, '0')
  ).join('');
}
export function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}
export { base };
