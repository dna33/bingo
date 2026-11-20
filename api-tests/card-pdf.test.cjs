const { test } = require('node:test');
const assert = require('node:assert/strict');
const parsePdf = require('pdf-parse');
const { renderCardPdf } = require('../bingo-api/pilot/card-pdf');
const example = {
  cardCode: 'DEMO-34a041ef-844b-4e76-af41-a4cda233b681',
  cells: [2, 18, 33, 49, 62, 9, 22, 44, 58, 73, 15, 28, null, 52, 69, 5, 16, 39, 47, 66, 11, 25, 31, 60, 75],
  generation: { minNumber: 1, maxNumber: 75, columnMode: 'american75' },
  presentation: {
    title: 'Edición de otoño · Fabuloso',
    editionId: '000000000000000000000001',
    eventDate: '2026-11-16',
    eventTime: '10:00',
    timeZone: 'America/Santiago',
    templateVersion: 4,
    issuedAt: '2026-11-16T12:00:00.000Z'
  }
};
async function extract(bytes) {
  let items;
  const pdf = await parsePdf(bytes, {
    pagerender: async (page) => {
      const text = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: true });
      items = text.items;
      return items.map((item) => item.str).join('\n');
    }
  });
  return { ...pdf, items };
}
test('actual PDF text contains the exact stored layout in row-major order with one free center', async () => {
  const bytes = await renderCardPdf(example);
  const pdf = await extract(bytes);
  assert.equal(pdf.numpages, 1);
  const cells = pdf.items.map((item) => item.str).filter((str) => /^(?:\d{1,4}|LIBRE)$/.test(str));
  assert.deepEqual(
    cells,
    example.cells.map((n) => (n === null ? 'LIBRE' : String(n)))
  );
  for (const value of [
    example.cardCode,
    example.presentation.editionId,
    '16/11/2026',
    '10:00',
    'YouTube',
    'se va al agua',
    'iniciar sesión',
    'no cambia su asignación'
  ])
    assert.ok(pdf.text.includes(value), value);
  assert.ok(!pdf.text.includes('email'));
  assert.ok(!pdf.text.includes('contraseña'));
});
test('rebuilding a PDF from the immutable snapshot produces identical bytes', async () => {
  assert.ok((await renderCardPdf(example)).equals(await renderCardPdf(example)));
});
test('long titles fit on one A4 page; missing schedule is explicit and unsupported glyphs fail', async () => {
  const card = {
    ...example,
    presentation: { ...example.presentation, title: 'W'.repeat(80), eventDate: '', eventTime: '' }
  };
  const pdf = await extract(await renderCardPdf(card));
  assert.equal(pdf.numpages, 1);
  assert.ok(pdf.text.includes('por confirmar'));
  for (const item of pdf.items) {
    assert.ok(item.transform[4] >= 0 && item.transform[4] + item.width <= 596, JSON.stringify(item));
    assert.ok(item.transform[5] > 0 && item.transform[5] < 842);
  }
  await assert.rejects(
    renderCardPdf({ ...card, presentation: { ...card.presentation, title: 'No disponible 🦊' } }),
    (error) => error.publicCode === 'card_title'
  );
});
