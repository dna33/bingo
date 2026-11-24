// Reference drawings from the brief. They are proposals until the operator reviews and confirms them.
export const masks = {
  F: ['11111', '10000', '11110', '10000', '10000'],
  A: ['01110', '10001', '11111', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '11110'],
  U: ['10001', '10001', '10001', '10001', '11111'],
  L: ['10000', '10000', '10000', '10000', '11111'],
  S: ['11111', '10000', '11111', '00001', '11111'],
  O: ['11111', '10001', '10001', '10001', '11111']
};
// Friday's live event plays only Binguito (U) and the full letter F (F); the rest sit
// idle at $0 this edition and will carry their own pools on a future event's edition.
const poolsByFigure = { F: 300000, A: 0, B: 0, U: 100000, L: 0, S: 0, O: 0 };
export function proposedFigures() {
  return Object.entries(masks).map(([name, mask]) => ({
    name,
    mask: [...mask],
    poolClp: poolsByFigure[name]
  }));
}
// Alternate, faster-to-complete mask for a figure, selectable instead of its classic letter shape.
export const alternateMasks = {
  U: ['10001', '00000', '00010', '00000', '10000']
};
