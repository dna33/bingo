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
export function proposedFigures() {
  return Object.entries(masks).map(([name, mask]) => ({
    name,
    mask: [...mask],
    poolClp: name === 'O' ? 100000 : 50000
  }));
}
