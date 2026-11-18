const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const failure = require('./errors');
const TEMPLATE_VERSION = 1;
const GRID = { x: 82.5, top: 638, size: 430 };
function validatePrintable(text) {
  try {
    // Built-in PDF fonts support Spanish/WinAnsi. Fail explicitly rather than lose glyphs.
    const { StandardFontEmbedder } = require('pdf-lib');
    StandardFontEmbedder.for(StandardFonts.Helvetica).encodeText(text);
  } catch (_) {
    throw Object.assign(failure(400, 'Unsupported characters in PDF title'), { publicCode: 'card_title' });
  }
}
function wrap(text, font, size, width) {
  const lines = [''];
  for (const word of text.split(' ')) {
    let remaining = word;
    if (
      lines[lines.length - 1] &&
      font.widthOfTextAtSize(lines[lines.length - 1] + ' ' + remaining, size) > width
    )
      lines.push('');
    if (lines[lines.length - 1]) lines[lines.length - 1] += ' ';
    for (const letter of remaining) {
      const last = lines.length - 1;
      if (font.widthOfTextAtSize(lines[last] + letter, size) > width) lines.push(letter);
      else lines[last] += letter;
    }
  }
  return lines;
}
async function renderCardPdf(card) {
  const presentation = card.presentation;
  if (!presentation || presentation.templateVersion !== TEMPLATE_VERSION)
    throw failure(409, 'PDF template unavailable');
  validatePrintable(presentation.title);
  const document = await PDFDocument.create();
  const fixedDate = new Date(presentation.issuedAt);
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  document.setTitle(`Cartón ${card.cardCode}`);
  document.setAuthor('Bingo Fabuloso');
  document.setProducer('Bingo Fabuloso · template 1');
  document.setCreator('Bingo Fabuloso');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([595.28, 841.89]);
  const ink = rgb(0.1, 0.14, 0.2),
    accent = rgb(0.24, 0.13, 0.34);
  function text(value, x, y, size = 12, face = font) {
    page.drawText(value, { x, y, size, font: face, color: ink });
  }
  text('BINGO FABULOSO', 48, 793, 14, bold);
  let titleSize = 21;
  while (wrap(presentation.title, bold, titleSize, 499).length > 2 && titleSize > 12) titleSize--;
  const titles = wrap(presentation.title, bold, titleSize, 499);
  titles.forEach((line, i) => text(line, 48, 760 - i * 24, titleSize, bold));
  text(`Edición: ${presentation.editionId}`, 48, 716, 9);
  text(`Cartón: ${card.cardCode}`, 48, 697, 11);
  const date = presentation.eventDate
    ? presentation.eventDate.split('-').reverse().join('/')
    : 'por confirmar';
  const time = presentation.eventTime
    ? `${presentation.eventTime} (${presentation.timeZone})`
    : 'por confirmar';
  text(`Fecha: ${date} · Hora: ${time}`, 48, 675, 11);
  'BINGO'.split('').forEach((letter, col) => text(letter, GRID.x + col * 86 + 36, 648, 14, bold));
  const side = GRID.size / 5;
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 5; col++) {
      const i = row * 5 + col,
        x = GRID.x + col * side,
        y = GRID.top - (row + 1) * side;
      page.drawRectangle({
        x,
        y,
        width: side,
        height: side,
        borderWidth: 1.1,
        borderColor: ink,
        color: i === 12 ? rgb(0.89, 0.89, 0.91) : rgb(1, 1, 1)
      });
      const value = i === 12 ? 'LIBRE' : String(card.cells[i]);
      const size = i === 12 ? 16 : 30;
      text(
        value,
        x + (side - bold.widthOfTextAtSize(value, size)) / 2,
        y + (side - size) / 2 + 5,
        size,
        bold
      );
    }
  const instructions = [
    'Abre este PDF en tu teléfono o computador, o imprímelo. Sigue los números por YouTube. No necesitas registrarte, iniciar sesión ni activar el cartón.',
    'El sistema detecta automáticamente a los candidatos. Si Fabuloso te contacta por un premio, debes responder dentro de 60 segundos. Sin respuesta oportuna, pierdes ese premio.',
    'El centro LIBRE siempre cuenta como marcado, también al reiniciar una ronda. Copiar o reenviar este PDF no cambia su asignación.'
  ];
  let y = 182;
  for (const paragraph of instructions) {
    for (const line of wrap(paragraph, font, 11, 499)) {
      text(line, 48, y, 11);
      y -= 15;
    }
    y -= 9;
  }
  page.drawLine({ start: { x: 48, y: 43 }, end: { x: 547, y: 43 }, color: accent, thickness: 1 });
  text(
    `Números ${card.generation.minNumber}-${card.generation.maxNumber} · ${card.generation.columnMode === 'american75' ? 'Rangos B/I/N/G/O' : 'Distribución libre'}`,
    48,
    27,
    9
  );
  // No owner contact, personal name, activation credential or player login link is embedded.
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
module.exports = { renderCardPdf, validatePrintable, TEMPLATE_VERSION, GRID };
