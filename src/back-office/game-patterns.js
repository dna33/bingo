// Reference drawings from the brief. They are proposals until the operator reviews and confirms them.
// Which letters actually play, and each one's pool, is chosen per edition in the configuration
// screen (see GamePanel's "included" checkbox and pool input) — this module only supplies
// starting defaults. A letter left unchecked never becomes a figure for that edition at all: no
// round opens it, no pool is created for it, so it can neither be detected nor pay anything.
const blackout = ['11111', '11111', '11111', '11111', '11111'];
export const masks = {
  F: ['11111', '10000', '11110', '10000', '10000'],
  A: blackout,
  B: blackout,
  U: ['10001', '00000', '00010', '00000', '10000'],
  L: blackout,
  S: blackout,
  O: blackout
};
// Friday the 27th plays a single simultaneous round: the final target is the full letter F
// (bingo, $300,000) and the secondary target is its four corners (binguito, $100,000) — a strict
// subset of F's cells, so binguito always completes no later than F. These defaults preselect
// exactly that; the other five letters start unchecked with $0, editable for a future event.
const defaultIncluded = { F: true, A: false, B: false, U: true, L: false, S: false, O: false };
const defaultPoolClp = { F: 300000, A: 0, B: 0, U: 100000, L: 0, S: 0, O: 0 };
export function proposedFigures() {
  return Object.entries(masks).map(([name, mask]) => ({
    name,
    mask: [...mask],
    poolClp: defaultPoolClp[name],
    included: defaultIncluded[name]
  }));
}
// Alternate, faster-to-complete mask for a figure, selectable instead of its classic letter shape.
export const alternateMasks = {
  U: ['10001', '10001', '10001', '10001', '11111']
};
