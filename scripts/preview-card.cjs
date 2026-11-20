const fs = require('node:fs');
const { renderCardPdf } = require('../bingo-api/pilot/card-pdf');
// Synthetic fixed layout: this script does not issue a real card or access a database.
const sample = {
  cardCode: 'DEMO-00000000-0000-0000-0000-000000000001',
  cells: [2, 18, 33, 49, 62, 9, 22, 44, 58, 73, 15, 28, null, 52, 69, 5, 16, 39, 47, 66, 11, 25, 31, 60, 75],
  generation: { minNumber: 1, maxNumber: 75, columnMode: 'american75' },
  presentation: { title: 'Una Mañana Fabulosa · DEMOSTRACIÓN', editionId: '000000000000000000000001',
    eventDate: '2026-11-16', eventTime: '10:00', timeZone: 'America/Santiago',
    templateVersion: 4, issuedAt: '2026-11-16T12:00:00.000Z' }
};
renderCardPdf(sample).then(bytes => {
  const output = process.argv[2];
  if (!output) throw new Error('Provide an output PDF path');
  fs.writeFileSync(output, bytes); console.log(`Synthetic PDF written: ${output}`);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
