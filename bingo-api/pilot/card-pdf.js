const fs = require('node:fs');
const path = require('node:path');
const fontkit = require('@pdf-lib/fontkit');
const {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath
} = require('pdf-lib');
const failure = require('./errors');
const TEMPLATE_VERSION = 4;
const PAGE_W = 595.28,
  PAGE_H = 841.89;
const ASSETS = path.join(__dirname, 'assets');
const LOGO_BYTES = fs.readFileSync(path.join(ASSETS, 'fabuloso-logo.png'));
const LOGO_ASPECT_RATIO = 900 / 164;
const ICON_BYTES = {
  red: fs.readFileSync(path.join(ASSETS, 'fabuloso-icon-red.png')),
  blue: fs.readFileSync(path.join(ASSETS, 'fabuloso-icon-blue.png')),
  green: fs.readFileSync(path.join(ASSETS, 'fabuloso-icon-green.png')),
  gold: fs.readFileSync(path.join(ASSETS, 'fabuloso-icon-gold.png')),
  magenta: fs.readFileSync(path.join(ASSETS, 'fabuloso-icon-magenta.png'))
};
const ICON_ASPECT_RATIO = 200 / 182;
// Lilita One (SIL OFL 1.1, see assets/fonts/OFL.txt) — the thick, playful display face from the brief.
const DISPLAY_FONT_BYTES = fs.readFileSync(path.join(ASSETS, 'fonts', 'LilitaOne-Regular.ttf'));
const DISPLAY_FONT_CHECK = fontkit.create(DISPLAY_FONT_BYTES);
// Sampled from the official Fabuloso vector mark (brand red) and from the show's festive palette.
const INK = rgb(17 / 255, 17 / 255, 17 / 255);
const CREAM = rgb(1, 249 / 255, 241 / 255);
const WHITE = rgb(1, 1, 1);
const COLUMNS = [
  { letter: 'B', strong: rgb(229 / 255, 74 / 255, 58 / 255), tint: rgb(1, 240 / 255, 239 / 255), key: 'red' },
  { letter: 'I', strong: rgb(0, 116 / 255, 1), tint: rgb(238 / 255, 245 / 255, 1), key: 'blue' },
  {
    letter: 'N',
    strong: rgb(4 / 255, 153 / 255, 78 / 255),
    tint: rgb(237 / 255, 249 / 255, 241 / 255),
    key: 'green'
  },
  { letter: 'G', strong: rgb(1, 194 / 255, 0), tint: rgb(1, 250 / 255, 232 / 255), key: 'gold' },
  {
    letter: 'O',
    strong: rgb(178 / 255, 0, 98 / 255),
    tint: rgb(251 / 255, 239 / 255, 245 / 255),
    key: 'magenta'
  }
];
const BRAND_RED = COLUMNS[0].strong;
const BRAND_GOLD = COLUMNS[3].strong;
function roundedRectPath(w, h, r) {
  return (
    `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} ` +
    `H${r} A${r},${r} 0 0 1 0,${h - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`
  );
}
function diamondPath(s) {
  return `M${s},0 L${2 * s},${s} L${s},${2 * s} L0,${s} Z`;
}
// Cubic-bezier quarter-circle approximation, used only to clip square cell fills to a rounded silhouette.
const KAPPA = 0.5522847498307936;
function roundedRectClipOps(x0, y0, w, h, r) {
  const k = r * KAPPA;
  return [
    moveTo(x0 + r, y0),
    lineTo(x0 + w - r, y0),
    appendBezierCurve(x0 + w - r + k, y0, x0 + w, y0 + r - k, x0 + w, y0 + r),
    lineTo(x0 + w, y0 + h - r),
    appendBezierCurve(x0 + w, y0 + h - r + k, x0 + w - r + k, y0 + h, x0 + w - r, y0 + h),
    lineTo(x0 + r, y0 + h),
    appendBezierCurve(x0 + r - k, y0 + h, x0, y0 + h - r + k, x0, y0 + h - r),
    lineTo(x0, y0 + r),
    appendBezierCurve(x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0),
    closePath()
  ];
}
// Fixed, deterministic confetti — never over the card shell, so numbers always stay readable.
const CONFETTI = [
  { shape: 'circle', cx: 14, topY: 44, r: 3.5, color: 'gold' },
  { shape: 'circle', cx: 582, topY: 38, r: 4, color: 'magenta' },
  { shape: 'diamond', x: 560, topY: 78, s: 5, color: 'blue' },
  { shape: 'circle', cx: 16, topY: 92, r: 3, color: 'green' },
  { shape: 'circle', cx: 12, topY: 230, r: 4, color: 'red' },
  { shape: 'diamond', x: 574, topY: 268, s: 5, color: 'gold' },
  { shape: 'circle', cx: 583, topY: 360, r: 3, color: 'green' },
  { shape: 'circle', cx: 11, topY: 430, r: 3.5, color: 'blue' },
  { shape: 'diamond', x: 9, topY: 520, s: 5.5, color: 'magenta' },
  { shape: 'circle', cx: 584, topY: 540, r: 4, color: 'red' },
  { shape: 'circle', cx: 70, topY: 648, r: 3.5, color: 'gold' },
  { shape: 'diamond', x: 505, topY: 642, s: 5.5, color: 'green' },
  { shape: 'circle', cx: 300, topY: 652, r: 3, color: 'magenta' },
  { shape: 'circle', cx: 13, topY: 760, r: 3.5, color: 'blue' },
  { shape: 'diamond', x: 572, topY: 756, s: 5, color: 'red' }
];
function validatePrintable(text) {
  try {
    // Built-in PDF fonts support Spanish/WinAnsi. Fail explicitly rather than lose glyphs.
    const { StandardFontEmbedder } = require('pdf-lib');
    StandardFontEmbedder.for(StandardFonts.Helvetica).encodeText(text);
  } catch (_) {
    throw Object.assign(failure(400, 'Unsupported characters in PDF title'), { publicCode: 'card_title' });
  }
  for (const char of text) {
    const glyph = DISPLAY_FONT_CHECK.glyphForCodePoint(char.codePointAt(0));
    if (!glyph || glyph.id === 0)
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
  document.registerFontkit(fontkit);
  const fixedDate = new Date(presentation.issuedAt);
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  document.setTitle(`Cartón ${card.cardCode}`);
  document.setAuthor('Bingo Fabuloso');
  document.setProducer(`Bingo Fabuloso · template ${TEMPLATE_VERSION}`);
  document.setCreator('Bingo Fabuloso');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const display = await document.embedFont(DISPLAY_FONT_BYTES);
  const logo = await document.embedPng(LOGO_BYTES);
  const icons = {};
  for (const key of Object.keys(ICON_BYTES)) icons[key] = await document.embedPng(ICON_BYTES[key]);
  const page = document.addPage([PAGE_W, PAGE_H]);
  const fromTop = (distance) => PAGE_H - distance;
  function text(value, x, topBaseline, size = 12, face = font, color = INK) {
    page.drawText(value, { x, y: fromTop(topBaseline), size, font: face, color });
  }
  function roundedRect(x, topY, w, h, r, color, borderColor, borderWidth = 0) {
    page.drawSvgPath(roundedRectPath(w, h, r), { x, y: fromTop(topY), color, borderColor, borderWidth });
  }
  function clipRounded(x, topY, w, h, r) {
    page.pushOperators(pushGraphicsState(), ...roundedRectClipOps(x, fromTop(topY + h), w, h, r), clip(), endPath());
  }
  function unclip() {
    page.pushOperators(popGraphicsState());
  }
  function icon(key, x, topY, size) {
    page.drawImage(icons[key], { x, y: fromTop(topY + size), width: size * ICON_ASPECT_RATIO, height: size });
  }
  function drawConfetti(piece) {
    const color = COLUMNS.find((c) => c.key === piece.color).strong;
    if (piece.shape === 'circle') page.drawCircle({ x: piece.cx, y: fromTop(piece.topY), size: piece.r, color });
    else
      page.drawSvgPath(diamondPath(piece.s), {
        x: piece.x,
        y: fromTop(piece.topY),
        color
      });
  }
  // Page shell
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: CREAM });
  for (const piece of CONFETTI) drawConfetti(piece);
  // Header: logo + title, on the cream backdrop above the card shell
  const logoHeight = 24;
  page.drawImage(logo, {
    x: 48,
    y: fromTop(26 + logoHeight),
    width: logoHeight * LOGO_ASPECT_RATIO,
    height: logoHeight
  });
  const titleText = presentation.title.toUpperCase();
  let titleSize = 21;
  while (wrap(titleText, display, titleSize, 499).length > 2 && titleSize > 12) titleSize--;
  const titles = wrap(titleText, display, titleSize, 499);
  titles.forEach((line, i) => text(line, 48, 94 + i * 24, titleSize, display));
  // Info box: EDICIÓN / CARTÓN / FECHA, its own tight rounded frame (no shadow, flat brand border)
  const CARD_X = 28,
    CARD_W = PAGE_W - 2 * CARD_X,
    CARD_PADDING = 14;
  const INFO_TOP = 112;
  const INFO_ROW_H = 18,
    INFO_ROW_GAP = 5,
    INFO_BLOCK_H = INFO_ROW_H * 3 + INFO_ROW_GAP * 2;
  const INFO_H = CARD_PADDING * 2 + INFO_BLOCK_H,
    INFO_RADIUS = 18,
    INFO_BORDER = 3;
  roundedRect(CARD_X, INFO_TOP, CARD_W, INFO_H, INFO_RADIUS, WHITE, INK, INFO_BORDER);
  function infoRow(label, value, rowTop) {
    const labelW = 78,
      labelH = INFO_ROW_H;
    roundedRect(CARD_X + CARD_PADDING, rowTop, labelW, labelH, labelH / 2, BRAND_RED);
    const labelSize = 8.5;
    text(
      label,
      CARD_X + CARD_PADDING + (labelW - display.widthOfTextAtSize(label, labelSize)) / 2,
      rowTop + labelH / 2 + labelSize * 0.34,
      labelSize,
      display,
      WHITE
    );
    text(value, CARD_X + CARD_PADDING + labelW + 10, rowTop + labelH - 5, 10.5, bold);
  }
  const row1 = INFO_TOP + CARD_PADDING;
  infoRow('EDICIÓN', presentation.editionId, row1);
  infoRow('CARTÓN', card.cardCode, row1 + INFO_ROW_H + INFO_ROW_GAP);
  const date = presentation.eventDate
    ? presentation.eventDate.split('-').reverse().join('/')
    : 'por confirmar';
  const time = presentation.eventTime
    ? `${presentation.eventTime} (${presentation.timeZone})`
    : 'por confirmar';
  infoRow('FECHA', `${date} · ${time}`, row1 + 2 * (INFO_ROW_H + INFO_ROW_GAP));
  // Grid box: B-I-N-G-O header + 5x5 cells, clipped to a rounded silhouette then framed with a flat border
  const GRID_GAP = 16,
    GRID_HEADER_H = 32,
    GRID_RADIUS = 14,
    GRID_BORDER = 3;
  const CELL = 78,
    GRID_W = CELL * 5,
    GRID_X = CARD_X + (CARD_W - GRID_W) / 2;
  const headerTop = INFO_TOP + INFO_H + GRID_GAP,
    gridTop = headerTop + GRID_HEADER_H,
    GRID_BOX_H = GRID_HEADER_H + CELL * 5,
    GRID_BOTTOM = headerTop + GRID_BOX_H;
  clipRounded(GRID_X, headerTop, GRID_W, GRID_BOX_H, GRID_RADIUS);
  COLUMNS.forEach((column, col) => {
    const x = GRID_X + col * CELL;
    page.drawRectangle({ x, y: fromTop(headerTop + GRID_HEADER_H), width: CELL, height: GRID_HEADER_H, color: column.strong });
    const letterSize = 17,
      letterColor = column.key === 'gold' ? INK : WHITE;
    text(
      column.letter,
      x + (CELL - display.widthOfTextAtSize(column.letter, letterSize)) / 2,
      headerTop + GRID_HEADER_H / 2 + letterSize * 0.34,
      letterSize,
      display,
      letterColor
    );
  });
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 5; col++) {
      const i = row * 5 + col,
        x = GRID_X + col * CELL,
        cellTop = gridTop + row * CELL,
        free = i === 12;
      page.drawRectangle({
        x,
        y: fromTop(cellTop + CELL),
        width: CELL,
        height: CELL,
        color: free ? INK : COLUMNS[col].tint
      });
      if (free) {
        icon('red', x + (CELL - 20) / 2, cellTop + CELL / 2 - 22, 20);
        const label = 'LIBRE',
          size = 12;
        text(label, x + (CELL - display.widthOfTextAtSize(label, size)) / 2, cellTop + CELL / 2 + 18, size, display, WHITE);
      } else {
        const value = String(card.cells[i]),
          size = 27;
        text(
          value,
          x + (CELL - display.widthOfTextAtSize(value, size)) / 2,
          cellTop + CELL / 2 + size * 0.3,
          size,
          display
        );
      }
    }
  unclip();
  for (let col = 1; col < 5; col++)
    page.drawLine({
      start: { x: GRID_X + col * CELL, y: fromTop(headerTop) },
      end: { x: GRID_X + col * CELL, y: fromTop(headerTop + GRID_BOX_H) },
      thickness: 1,
      color: INK
    });
  for (let row = 0; row <= 4; row++)
    page.drawLine({
      start: { x: GRID_X, y: fromTop(gridTop + row * CELL) },
      end: { x: GRID_X + GRID_W, y: fromTop(gridTop + row * CELL) },
      thickness: 1,
      color: INK
    });
  roundedRect(GRID_X, headerTop, GRID_W, GRID_BOX_H, GRID_RADIUS, undefined, INK, GRID_BORDER);
  // Instructions, boxed, with the response deadline highlighted
  const instructions = [
    'Abre este PDF en tu teléfono o computador, o imprímelo, y sigue los números por YouTube. No necesitas registrarte, iniciar sesión ni activar el cartón: ya está listo para jugar.',
    'El sistema detecta solo a los candidatos. Si Fabuloso te contacta por un premio, respóndele o se va al agua.',
    'El centro LIBRE siempre cuenta como marcado, incluso si se reinicia una ronda. Copiar o reenviar este PDF no cambia su asignación, así que no hay apuro.'
  ];
  const INSTR_TOP = GRID_BOTTOM + 22,
    INSTR_PADDING = 14,
    INSTR_SIZE = 8.5,
    LINE_H = 12,
    PARAGRAPH_GAP = 7;
  const wrapped = instructions.map((paragraph) => wrap(paragraph, font, INSTR_SIZE, CARD_W - 2 * INSTR_PADDING));
  const totalLines = wrapped.reduce((sum, lines) => sum + lines.length, 0);
  const textBlockH = totalLines * LINE_H + (wrapped.length - 1) * PARAGRAPH_GAP;
  const instrBoxH = textBlockH + 2 * INSTR_PADDING;
  roundedRect(CARD_X, INSTR_TOP, CARD_W, instrBoxH, 12, CREAM, INK, 1.5);
  let lineTop = INSTR_TOP + INSTR_PADDING + INSTR_SIZE;
  wrapped.forEach((lines, index) => {
    for (const line of lines) {
      const highlightAt = line.indexOf('se va al agua');
      if (highlightAt >= 0) {
        const prefixW = font.widthOfTextAtSize(line.slice(0, highlightAt), INSTR_SIZE),
          highlightW = font.widthOfTextAtSize('se va al agua', INSTR_SIZE);
        page.drawRectangle({
          x: CARD_X + INSTR_PADDING + prefixW - 1.5,
          y: fromTop(lineTop + 3),
          width: highlightW + 3,
          height: INSTR_SIZE + 3,
          color: COLUMNS[3].strong
        });
      }
      text(line, CARD_X + INSTR_PADDING, lineTop, INSTR_SIZE, font);
      lineTop += LINE_H;
    }
    if (index < wrapped.length - 1) lineTop += PARAGRAPH_GAP;
  });
  // Rainbow mark row + footer bar
  const iconsTop = INSTR_TOP + instrBoxH + 14,
    iconSize = 15,
    iconGap = 10,
    iconsW = Object.keys(icons).length * iconSize * ICON_ASPECT_RATIO + (Object.keys(icons).length - 1) * iconGap;
  let iconX = (PAGE_W - iconsW) / 2;
  for (const key of ['red', 'blue', 'green', 'gold', 'magenta']) {
    icon(key, iconX, iconsTop, iconSize);
    iconX += iconSize * ICON_ASPECT_RATIO + iconGap;
  }
  // Anchored below the icon row (not the page bottom) so it never overlaps as instructions/icons grow.
  const FOOTER_H = 28,
    FOOTER_GAP = 10,
    FOOTER_RADIUS = 14;
  const footerTop = iconsTop + iconSize + FOOTER_GAP;
  roundedRect(CARD_X, footerTop, CARD_W, FOOTER_H, FOOTER_RADIUS, INK);
  const rangeLabel = `NÚMEROS ${card.generation.minNumber}-${card.generation.maxNumber} · RANGOS `,
    columnsLabel = card.generation.columnMode === 'american75' ? 'B / I / N / G / O' : 'DISTRIBUCIÓN LIBRE',
    footerSize = 9.5;
  const footerW =
    display.widthOfTextAtSize(rangeLabel, footerSize) + display.widthOfTextAtSize(columnsLabel, footerSize);
  const footerTextX = CARD_X + (CARD_W - footerW) / 2,
    footerBaseline = footerTop + FOOTER_H / 2 + footerSize * 0.34;
  text(rangeLabel, footerTextX, footerBaseline, footerSize, display, WHITE);
  text(
    columnsLabel,
    footerTextX + display.widthOfTextAtSize(rangeLabel, footerSize),
    footerBaseline,
    footerSize,
    display,
    BRAND_GOLD
  );
  // No owner contact, personal name, activation credential or player login link is embedded.
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
module.exports = { renderCardPdf, validatePrintable, TEMPLATE_VERSION };
