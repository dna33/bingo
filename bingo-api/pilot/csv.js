const { TextDecoder } = require('node:util');
const failure = require('./errors');
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 50000;
function csvError(code) {
  return Object.assign(failure(400, 'Invalid CSV'), { publicCode: code });
}
function decodeFile(base64) {
  if (
    typeof base64 !== 'string' ||
    !base64.length ||
    base64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
    base64.length % 4 !== 0
  )
    throw csvError('csv_encoding');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) throw csvError('csv_encoding');
  if (bytes.length > MAX_BYTES) throw csvError('csv_size');
  return bytes;
}
function parseCsv(bytes) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    throw csvError('csv_utf8');
  }
  if (source.includes('\0')) throw csvError('csv_syntax');
  const records = [];
  let fields = [],
    field = '',
    quoted = false,
    closed = false,
    line = 1,
    startLine = 1;
  const finish = () => {
    fields.push(field);
    records.push({ line: startLine, fields });
    if (records.length > MAX_ROWS + 1) throw csvError('csv_rows');
    fields = [];
    field = '';
    closed = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += ch;
        if (ch === '\n' || (ch === '\r' && source[i + 1] !== '\n')) line++;
      }
    } else if (ch === ',') {
      fields.push(field);
      field = '';
      closed = false;
    } else if (ch === '\r' || ch === '\n') {
      finish();
      if (ch === '\r' && source[i + 1] === '\n') i++;
      line++;
      startLine = line;
    } else if (ch === '"' && !field.length && !closed) {
      quoted = true;
    } else {
      if (closed || ch === '"') throw csvError('csv_syntax');
      field += ch;
    }
  }
  if (quoted) throw csvError('csv_syntax');
  if (field.length || fields.length || closed) finish();
  if (!records.length) throw csvError('csv_headers');
  const headers = records.shift().fields.map((s) => s.trim().toLowerCase());
  const allowed = ['email', 'telefono', 'jugador_id', 'nombre'];
  if (
    !headers.includes('email') ||
    !headers.includes('telefono') ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !allowed.includes(h))
  )
    throw csvError('csv_headers');
  if (!records.length) throw csvError('csv_empty');
  return records.map((record) => ({
    rowNumber: record.line,
    raw: {
      values: Object.fromEntries(headers.map((h, i) => [h, record.fields[i] || ''])),
      cells: record.fields
    },
    structureIssues: record.fields.length === headers.length ? [] : ['column_count']
  }));
}
function normalize(values) {
  const issues = [];
  const read = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  const email = read('email').toLowerCase();
  const phone = read('telefono').replace(/[\s().-]/g, '');
  const externalId = read('jugador_id');
  const name = read('nombre');
  if (!email || email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email))
    issues.push('email_format');
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) issues.push('phone_format');
  if (externalId.length > 128 || /[\r\n\x00-\x1f]/.test(externalId)) issues.push('external_id_format');
  if (name.length > 200 || /[\x00-\x1f]/.test(name)) issues.push('name_format');
  return { data: { email, phone, externalId, name }, issues };
}
module.exports = { decodeFile, parseCsv, normalize, MAX_BYTES, MAX_ROWS };
