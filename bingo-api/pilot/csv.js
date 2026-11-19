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
// Polla's own platform export ("Report NNN") is a transactional report, not a pre-cleaned
// participant list: comma is the decimal separator in es-CL spreadsheets, so Polla exports with
// ';' instead, and it carries one row per bet rather than one row per player. The legacy shape
// (','-delimited, four fixed column names) is kept as-is; this adds the raw export as a second
// accepted shape, both normalized to the same {email, telefono, jugador_id, nombre} values so
// every downstream step (duplicate/conflict detection, preview, resolution) is unaffected.
const LEGACY_ALLOWED = ['email', 'telefono', 'jugador_id', 'nombre'];
const POLLA_FIELD_MAP = { 'player email': 'email', 'player mobile phone': 'telefono', 'player id': 'jugador_id' };
const POLLA_NAME_COLUMNS = ['player name', 'player surname'];
const POLLA_IGNORED = [
  'influencer id',
  'influencer code',
  'player rut',
  'transaction date',
  'game',
  'bets number',
  'bet amount'
];
function detectDelimiter(source) {
  const end = source.search(/\r\n|\r|\n/);
  const firstLine = end === -1 ? source : source.slice(0, end);
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}
function headerEntries(fields) {
  return fields
    .map((value, index) => ({ name: value.trim().toLowerCase(), index }))
    .filter((entry) => entry.name !== '');
}
function detectShape(entries) {
  const names = entries.map((entry) => entry.name);
  if (new Set(names).size !== names.length) return null;
  if (names.includes('email') && names.includes('telefono') && names.every((n) => LEGACY_ALLOWED.includes(n)))
    return 'legacy';
  const pollaKnown = new Set([...Object.keys(POLLA_FIELD_MAP), ...POLLA_NAME_COLUMNS, ...POLLA_IGNORED]);
  if (
    names.includes('player email') &&
    names.includes('player mobile phone') &&
    names.every((n) => pollaKnown.has(n))
  )
    return 'polla';
  return null;
}
function valueExtractor(shape, entries) {
  const indexOf = (name) => {
    const entry = entries.find((e) => e.name === name);
    return entry ? entry.index : -1;
  };
  const field = (fields, index) => (index >= 0 ? fields[index] || '' : '');
  if (shape === 'legacy') {
    const email = indexOf('email'),
      telefono = indexOf('telefono'),
      jugadorId = indexOf('jugador_id'),
      nombre = indexOf('nombre');
    return (fields) => ({
      email: field(fields, email),
      telefono: field(fields, telefono),
      jugador_id: field(fields, jugadorId),
      nombre: field(fields, nombre)
    });
  }
  const email = indexOf('player email'),
    phone = indexOf('player mobile phone'),
    jugadorId = indexOf('player id'),
    name = indexOf('player name'),
    surname = indexOf('player surname');
  return (fields) => ({
    email: field(fields, email),
    telefono: field(fields, phone),
    jugador_id: field(fields, jugadorId),
    nombre: [field(fields, name), field(fields, surname)]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ')
  });
}
function parseCsv(bytes) {
  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    throw csvError('csv_utf8');
  }
  if (source.includes('\0')) throw csvError('csv_syntax');
  const delimiter = detectDelimiter(source);
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
    } else if (ch === delimiter) {
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
  let headerRecord = records.shift();
  let entries = headerEntries(headerRecord.fields);
  let shape = detectShape(entries);
  if (!shape && records.length) {
    // Polla's raw export carries a leading report-title line ("Report NNN;;;;...") before the
    // real header row. Only skip it when doing so turns an unrecognized row into a known shape.
    const candidateEntries = headerEntries(records[0].fields);
    const candidateShape = detectShape(candidateEntries);
    if (candidateShape) {
      headerRecord = records.shift();
      entries = candidateEntries;
      shape = candidateShape;
    }
  }
  if (!shape) throw csvError('csv_headers');
  if (!records.length) throw csvError('csv_empty');
  const extract = valueExtractor(shape, entries);
  const headerColumnCount = headerRecord.fields.length;
  return records.map((record) => ({
    rowNumber: record.line,
    raw: {
      values: extract(record.fields),
      cells: record.fields
    },
    structureIssues: record.fields.length === headerColumnCount ? [] : ['column_count']
  }));
}
function normalize(values) {
  const issues = [];
  const read = (key) => (typeof values[key] === 'string' ? values[key].trim() : '');
  const email = read('email').toLowerCase();
  let phone = read('telefono').replace(/[\s().-]/g, '');
  // Polla's raw export gives bare national numbers (e.g. "56912345678"), not E.164: a leading
  // '+' is assumed missing rather than the number being malformed, and added back here so both
  // input shapes end up validated the same way.
  if (phone && !phone.startsWith('+')) phone = `+${phone}`;
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
