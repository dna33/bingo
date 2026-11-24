// Reference drawings from the brief. They are proposals until the operator reviews and confirms them.
// Friday the 27th plays a single simultaneous round: the final target is the full letter F
// (bingo, $300,000) and the secondary target is its four corners (binguito, $100,000) — a strict
// subset of F's cells, so binguito always completes no later than F. Figure U carries that
// corners pattern as its proposed mask for this event (its classic letter shape moved to
// alternateMasks.U below, reachable via the mask toggle if ever needed). The other five letters
// carry no pool this edition and default to a full blackout: since roundMode 'simultaneous' opens
// every figure from the start with no round boundary to defer them behind, blackout keeps them
// effectively unreachable for the length of this round (on top of the $0-pool safety block in
// prizes.js). They will need their own masks and pools again on a future event's edition.
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
  U: ['10001', '10001', '10001', '10001', '11111']
};
