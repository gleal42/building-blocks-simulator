// Geometry of the puzzle pieces.
//
// Every square of the tray holds a unit cube of volume. A square is filled either by
//   * the cube part of a "cube + prism" piece, or
//   * two complementary half-cubes (triangular prisms). A half-cube is either a loose
//     prism or the prism part of a "cube + prism" piece that sits in the next square.
//
// A unit cube can be cut in half by 6 diagonal planes, which gives 12 half-cube shapes.
// We name them by how they sit in the square:
//   U_xx  upright prism (standing on its triangle). Seen from above it is a triangle with
//         its right angle in corner xx.
//   R_x   ramp: lying on a square face, slope facing up, full height along side x.
//   O_x   overhang ("roof"): slope facing down, flat top, full height along side x.
// Two halves fill a square only if they are complements (see COMPLEMENT).

export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;
export const SIDE_NAMES = ['N', 'E', 'S', 'W'];
export const SIDE_WORDS = ['north', 'east', 'south', 'west'];
/** Row / column step for each side (rows grow downwards = south). */
export const DR = [-1, 0, 1, 0];
export const DC = [0, 1, 0, -1];
export const opposite = (side) => (side + 2) % 4;

export const HALVES = [
  'U_NW', 'U_NE', 'U_SE', 'U_SW',
  'R_N', 'R_E', 'R_S', 'R_W',
  'O_N', 'O_E', 'O_S', 'O_W',
];
export const HALF = Object.freeze(Object.fromEntries(HALVES.map((name, i) => [name, i])));

/** The half that fills the rest of the square. */
export const COMPLEMENT = Object.freeze([2, 3, 0, 1, 10, 11, 8, 9, 6, 7, 4, 5]);

/** The 6 ways to split a square into two halves. */
export const PAIRS = Object.freeze([
  [0, 2], // upright, split along "/" (NW + SE)
  [1, 3], // upright, split along "\" (NE + SW)
  [4, 10], // lying, ramp high at N + overhang thick at S
  [5, 11],
  [6, 8],
  [7, 9],
]);

export const isUpright = (h) => h < 4;
export const isRamp = (h) => h >= 4 && h < 8;
export const isCap = (h) => h >= 8;
/** Side where a ramp / overhang is full height (-1 for upright halves). */
export const thickSide = (h) => (isUpright(h) ? -1 : (h - 4) % 4);

/**
 * Sides of the square from which the cube of a "cube + prism" piece can hold this half.
 * The prism is glued to the cube by one of its two square faces, so the half must touch
 * that whole side of the square.
 */
export const SOURCE_SIDES = Object.freeze([
  [N, W], [N, E], [S, E], [S, W],
  [N], [E], [S], [W],
  [N], [E], [S], [W],
]);

/** Halves that a cube on the given side of a square can push into that square. */
export const HALVES_FROM_SIDE = Object.freeze(
  [0, 1, 2, 3].map((side) => HALVES.map((_, h) => h).filter((h) => SOURCE_SIDES[h].includes(side))),
);

function cornerOf(a, b) {
  const has = (s) => a === s || b === s;
  if (has(N) && has(W)) return 0;
  if (has(N) && has(E)) return 1;
  if (has(S) && has(E)) return 2;
  return 3;
}

/**
 * Poses of the prism part of a "cube + prism" piece, as seen standing behind the cube and
 * looking towards the prism:
 *   left / right  the piece stands up; the prism's right angle is on that side
 *   ramp          the piece lies down, slope facing up (the cube is the high end)
 *   cap           the piece lies down, slope facing down: a flat 2-square top with an
 *                 empty wedge underneath the prism part
 */
export const POSES = ['left', 'right', 'ramp', 'cap'];

export function mixWedgeHalf(dir, pose) {
  const shared = opposite(dir); // side of the prism square that touches the cube
  if (pose === 2) return 4 + shared;
  if (pose === 3) return 8 + shared;
  const side = pose === 0 ? (dir + 3) % 4 : (dir + 1) % 4;
  return cornerOf(shared, side);
}

/** The 16 orientations of a "cube + prism" piece. dir = direction from cube to prism. */
export const MIX_ORIENTS = Object.freeze(
  Array.from({ length: 16 }, (_, o) => {
    const dir = o >> 2;
    const pose = o & 3;
    return Object.freeze({ o, dir, pose, half: mixWedgeHalf(dir, pose) });
  }),
);

export function mixOrientFor(dir, half) {
  const found = MIX_ORIENTS.find((m) => m.dir === dir && m.half === half);
  if (!found) throw new Error(`No cube+prism orientation puts half ${HALVES[half]} towards ${SIDE_NAMES[dir]}`);
  return found.o;
}

// ---- Orientation shortcuts used by the UI ---------------------------------------------

/** Turn a piece a quarter turn clockwise, seen from above. */
export const rotateMix = (o) => (((o >> 2) + 1) % 4) * 4 + (o & 3);
/** Turn a piece over (upside down) around its long axis. */
export const flipMix = (o) => (o & ~3) | [1, 0, 3, 2][o & 3];
/** Tip a piece a quarter turn around its long axis: standing -> lying -> standing... */
export const tipMix = (o) => (o & ~3) | [3, 2, 0, 1][o & 3];

export function rotateTri(h) {
  const group = h >> 2;
  return group * 4 + (((h & 3) + 1) % 4);
}
export function flipTri(h) {
  if (isUpright(h)) return [1, 0, 3, 2][h];
  return isRamp(h) ? h + 4 : h - 4;
}
export const tipTri = (h) => (h + 4) % 12;

// ---- What a square looks like from above ------------------------------------------------

/**
 * Appearance codes of a finished square (also used for target patterns).
 * Colours: 0 = white, 1 = black.
 */
export const LOOK = Object.freeze({
  ANY: 0,
  WHITE: 1,
  BLACK: 2,
  SLASH_WB: 3, // split along "/" : white top-left, black bottom-right
  SLASH_BW: 4, // split along "/" : black top-left, white bottom-right
  BACK_WB: 5, // split along "\" : white top-right, black bottom-left
  BACK_BW: 6, // split along "\" : black top-right, white bottom-left
});
export const LOOK_NAMES = ['any', 'white', 'black', 'slash-wb', 'slash-bw', 'back-wb', 'back-bw'];
export const isDiagonalLook = (look) => look >= 3;

export const solidLook = (color) => (color === 0 ? LOOK.WHITE : LOOK.BLACK);

/** Appearance of a square holding two complementary halves h1 (colour c1) and h2 (c2). */
export function splitLook(h1, c1, h2, c2) {
  if (COMPLEMENT[h1] !== h2) throw new Error(`${HALVES[h1]} and ${HALVES[h2]} do not fill a square`);
  if (isUpright(h1)) {
    if (h1 === 0 || h1 === 2) {
      const nw = h1 === 0 ? c1 : c2;
      const se = h1 === 0 ? c2 : c1;
      if (nw === se) return solidLook(nw);
      return nw === 0 ? LOOK.SLASH_WB : LOOK.SLASH_BW;
    }
    const ne = h1 === 1 ? c1 : c2;
    const sw = h1 === 1 ? c2 : c1;
    if (ne === sw) return solidLook(ne);
    return ne === 0 ? LOOK.BACK_WB : LOOK.BACK_BW;
  }
  // Lying halves: the overhang covers the ramp completely.
  return solidLook(isCap(h1) ? c1 : c2);
}

/**
 * Colour that a diagonal look requires for upright half h, or -1 if h is not part of it.
 */
export function diagonalHalfColor(look, h) {
  switch (look) {
    case LOOK.SLASH_WB: return h === 0 ? 0 : h === 2 ? 1 : -1;
    case LOOK.SLASH_BW: return h === 0 ? 1 : h === 2 ? 0 : -1;
    case LOOK.BACK_WB: return h === 1 ? 0 : h === 3 ? 1 : -1;
    case LOOK.BACK_BW: return h === 1 ? 1 : h === 3 ? 0 : -1;
    default: return -1;
  }
}

/** Could a square with target look `look` contain half h of colour `color`? */
export function halfFitsLook(look, h, color) {
  if (look === LOOK.ANY) return true;
  if (isUpright(h)) {
    if (look === LOOK.WHITE || look === LOOK.BLACK) return solidLook(color) === look;
    return diagonalHalfColor(look, h) === color;
  }
  if (isRamp(h)) return look === LOOK.WHITE || look === LOOK.BLACK; // hidden under an overhang
  return solidLook(color) === look;
}

export const cubeFitsLook = (look, color) => look === LOOK.ANY || look === solidLook(color);

// ---- 2D outlines (square-local, x to the right, y downwards) ---------------------------

const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];
export const HALF_OUTLINE = Object.freeze([
  [[0, 0], [1, 0], [0, 1]], // U_NW
  [[0, 0], [1, 0], [1, 1]], // U_NE
  [[1, 0], [1, 1], [0, 1]], // U_SE
  [[0, 0], [1, 1], [0, 1]], // U_SW
  FULL, FULL, FULL, FULL,
  FULL, FULL, FULL, FULL,
]);

/** Is point (fx, fy) of a square (0..1, y downwards) inside upright half h? */
export function uprightContains(h, fx, fy) {
  switch (h) {
    case 0: return fx + fy <= 1;
    case 1: return fx >= fy;
    case 2: return fx + fy >= 1;
    case 3: return fx <= fy;
    default: return true;
  }
}

// ---- 3D solids (square-local: u east, v north, w up; all in 0..1) -----------------------

function prism(tri2d, to3d) {
  // tri2d: 3 points of the cross-section; to3d(a, b, t) maps section point (a, b) at
  // extrusion position t (0 or 1) to [u, v, w].
  const bottom = tri2d.map(([a, b]) => to3d(a, b, 0));
  const top = tri2d.map(([a, b]) => to3d(a, b, 1));
  const verts = [...bottom, ...top];
  const faces = [
    [0, 1, 2],
    [3, 4, 5],
    [0, 1, 4, 3],
    [1, 2, 5, 4],
    [2, 0, 3, 5],
  ];
  return { verts, faces };
}

const UPRIGHT_TRI = [
  [[0, 1], [1, 1], [0, 0]], // U_NW (u, v)
  [[1, 1], [0, 1], [1, 0]], // U_NE
  [[1, 0], [1, 1], [0, 0]], // U_SE
  [[0, 0], [0, 1], [1, 0]], // U_SW
];
// Cross-sections of lying halves in the (along, w) plane, "along" running from the
// opposite side (0) to the named side (1).
const RAMP_SECTION = [[0, 0], [1, 0], [1, 1]];
const CAP_SECTION = [[1, 0], [1, 1], [0, 1]];

/** Convex solid of half h inside the unit square: { verts: [[u,v,w]], faces: [[i...]] }. */
export function halfSolid(h) {
  if (isUpright(h)) return prism(UPRIGHT_TRI[h], (u, v, t) => [u, v, t]);
  const side = thickSide(h);
  const section = isRamp(h) ? RAMP_SECTION : CAP_SECTION;
  switch (side) {
    case E: return prism(section, (a, w, t) => [a, t, w]);
    case W: return prism(section, (a, w, t) => [1 - a, t, w]);
    case N: return prism(section, (a, w, t) => [t, a, w]);
    default: return prism(section, (a, w, t) => [t, 1 - a, w]);
  }
}

export function cubeSolid() {
  const verts = [];
  for (const w of [0, 1]) for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) verts.push([u, v, w]);
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return { verts, faces };
}
