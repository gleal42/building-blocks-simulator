// Boards recreated from the photos of the real puzzle.
//
// In both photos almost every square looks like a full square with a seam around it. A
// full square can only come from a cube, or from an overhang lying on a ramp. The layout
// below uses the latter: each cube + prism lies down with its prism as a ramp, and a loose
// prism of the same colour lies on top of it as an overhang (two separate pieces, so a
// seam shows between the squares, as in the photos).

import { HALF, MIX_ORIENTS, E, W } from './geometry.js';

const mixO = (dir, pose) => MIX_ORIENTS.find((m) => m.dir === dir && m.pose === pose).o;
const RAMP = 2;
const RIGHT = 1;

function brickRows(rowsFrom, rowsTo) {
  const pieces = [];
  for (let r = rowsFrom; r < rowsTo; r += 1) {
    // White: cube in column 0, ramp in column 1, white overhang on the ramp.
    pieces.push({ type: 'mix', color: 'W', r, c: 0, o: mixO(E, RAMP) });
    pieces.push({ type: 'tri', color: 'W', r, c: 1, o: HALF.O_E });
    // Black: cube in column 3, ramp in column 2, black overhang on the ramp.
    pieces.push({ type: 'mix', color: 'B', r, c: 3, o: mixO(W, RAMP) });
    pieces.push({ type: 'tri', color: 'B', r, c: 2, o: HALF.O_W });
  }
  return pieces;
}

export const PRESETS = Object.freeze([
  {
    id: 'photo-1',
    name: 'Photo 1 (4×4)',
    rows: 4,
    cols: 4,
    pieces: [
      // Top row: two standing cube + prism pieces, prisms pointing left, and two loose
      // standing prisms filling the lower-left halves.
      { type: 'mix', color: 'W', r: 0, c: 1, o: mixO(W, RIGHT) },
      { type: 'tri', color: 'B', r: 0, c: 0, o: HALF.U_SW },
      { type: 'mix', color: 'B', r: 0, c: 3, o: mixO(W, RIGHT) },
      { type: 'tri', color: 'W', r: 0, c: 2, o: HALF.U_SW },
      ...brickRows(1, 4),
    ],
  },
  {
    id: 'photo-2',
    name: 'Photo 2 (8×4)',
    rows: 8,
    cols: 4,
    pieces: brickRows(0, 8),
  },
]);
