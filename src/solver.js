// Decides whether a top-view pattern can be built with the pieces of a tray, and finds an
// arrangement when it can.
//
// Facts the search relies on (all pieces must be used, which fills the tray exactly):
//   * Every cube + prism piece puts its cube in one square, so exactly
//     (number of cube + prism pieces) squares show a full cube; all other squares hold two
//     complementary halves.
//   * A square of halves gets 0, 1 or 2 of its halves from neighbouring cubes and the rest
//     from loose prisms.
//
// The search walks the squares row by row. Between a finished square and a later
// neighbour it remembers one "message" per edge:
//   WEDGE(h, colour)  the finished square is a cube whose prism goes into the neighbour as
//                     half h;
//   WANT(h, colour)   the finished square holds half h that must come from a cube in the
//                     neighbour.
// Dead ends are remembered (row-major frontier + pieces left), which keeps the search fast
// on the board sizes the app offers.

import {
  COMPLEMENT,
  DC,
  DR,
  E,
  HALVES_FROM_SIDE,
  LOOK,
  N,
  PAIRS,
  S,
  SOURCE_SIDES,
  W,
  cubeFitsLook,
  halfFitsLook,
  isCap,
  isDiagonalLook,
  isRamp,
  MIX_ORIENTS,
  mixOrientFor,
  mixWedgeHalf,
  splitLook,
} from './geometry.js';
import { colorOf, sizeProblem } from './board.js';

const WEDGE = 1;
const WANT = 2;
const message = (type, h, color) => (type << 5) | (h << 1) | color;
const msgType = (m) => m >> 5;
const msgHalf = (m) => (m >> 1) & 15;
const msgColor = (m) => m & 1;

class BudgetExceeded extends Error {}

/** Counts of each look in a pattern. */
export function patternStats(looks) {
  const stats = { white: 0, black: 0, diagonal: 0, any: 0 };
  for (const t of looks) {
    if (t === LOOK.WHITE) stats.white += 1;
    else if (t === LOOK.BLACK) stats.black += 1;
    else if (isDiagonalLook(t)) stats.diagonal += 1;
    else stats.any += 1;
  }
  return stats;
}

/**
 * Fast necessary conditions. Returns { ok: true } or { ok: false, code, reason }.
 * inventory: { mixW, mixB, triW, triB }.
 */
export function quickCheck(rows, cols, looks, inventory) {
  const problem = sizeProblem(rows, cols);
  if (problem) return { ok: false, code: 'size', reason: problem };
  if (looks.length !== rows * cols) return { ok: false, code: 'size', reason: 'The pattern does not match the board size.' };
  const { mixW, mixB, triW, triB } = inventory;
  const cubes = mixW + mixB;
  const st = patternStats(looks);
  const maxDiagonal = rows * cols - cubes;
  if (st.diagonal > maxDiagonal) {
    return {
      ok: false,
      code: 'too-many-diagonals',
      reason: `This pattern has ${st.diagonal} split squares, but at most ${maxDiagonal} are possible. Each of the ${cubes} cube + prism pieces always shows its cube as a full square, so ${cubes} squares can never be split.`,
    };
  }
  if (mixW > st.white + st.any) {
    return {
      ok: false,
      code: 'white-cubes',
      reason: `The ${mixW} white cubes always show as full white squares, but the pattern only has ${st.white + st.any} squares that can be fully white.`,
    };
  }
  if (mixB > st.black + st.any) {
    return {
      ok: false,
      code: 'black-cubes',
      reason: `The ${mixB} black cubes always show as full black squares, but the pattern only has ${st.black + st.any} squares that can be fully black.`,
    };
  }
  // Every white square not covered by a white cube needs at least one white half on top,
  // and every split square needs one white and one black half.
  const needWhite = Math.max(0, st.white - mixW) + st.diagonal;
  if (needWhite > mixW + triW) {
    return {
      ok: false,
      code: 'white-halves',
      reason: `Not enough white: the pattern needs at least ${needWhite} white prism halves on top, but there are only ${mixW + triW} white prisms (loose or attached to a cube).`,
    };
  }
  const needBlack = Math.max(0, st.black - mixB) + st.diagonal;
  if (needBlack > mixB + triB) {
    return {
      ok: false,
      code: 'black-halves',
      reason: `Not enough black: the pattern needs at least ${needBlack} black prism halves on top, but there are only ${mixB + triB} black prisms (loose or attached to a cube).`,
    };
  }
  return { ok: true };
}

/** Weighted random order (Efraimidis-Spirakis). */
function weightedShuffle(list, rng, weight) {
  const keyed = list.map((item) => ({ item, key: Math.pow(rng(), 1 / Math.max(1e-6, weight(item))) }));
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((x) => x.item);
}


/**
 * Search for an arrangement whose top view matches `looks` (LOOK codes, row-major;
 * LOOK.ANY matches anything).
 *
 * Returns
 *   { status: 'possible', pieces, nodes }
 *   { status: 'impossible', code, reason, nodes }
 *   { status: 'unknown', reason, nodes }        (search budget ran out)
 *
 * options: { maxNodes } - total search budget (default 1.5 million steps).
 */
export function solvePattern(rows, cols, looks, inventory, options = {}) {
  const quick = quickCheck(rows, cols, looks, inventory);
  if (!quick.ok) return { status: 'impossible', code: quick.code, reason: quick.reason, nodes: 0 };

  const budget = options.maxNodes ?? 1500000;
  // The search sweeps the board row by row. Which way it sweeps matters a lot on big boards,
  // so it tries the board mirrored and turned (narrow side first, so the sweep front stays
  // short), then randomised restarts, then one long exhaustive run. Any run that finishes
  // without finding an arrangement has checked every possibility, which proves "impossible".
  const frames = [
    { tr: false, fv: false },
    { tr: false, fv: true },
    { tr: true, fv: false },
    { tr: true, fv: true },
  ].map((f) => ({ ...f, width: f.tr ? rows : cols }));
  frames.sort((a, b) => a.width - b.width);
  const plan = [
    ...frames.map((frame) => ({ frame, nodes: 60000, seed: 0 })),
    ...Array.from({ length: 16 }, (_, k) => ({ frame: frames[k % 4], nodes: 30000, seed: 101 + k * 37 })),
  ];
  let used = 0;
  for (const step of plan) {
    if (used >= budget) break;
    const run = solveInFrame(rows, cols, looks, inventory, step.frame, Math.min(step.nodes, budget - used), step.seed);
    used += run.nodes;
    if (run.status !== 'unknown') return { ...run, nodes: used };
  }
  if (used < budget) {
    const run = solveInFrame(rows, cols, looks, inventory, frames[0], budget - used, 0);
    used += run.nodes;
    if (run.status !== 'unknown') return { ...run, nodes: used };
  }
  return {
    status: 'unknown',
    reason: 'This picture is too complex to decide in the time allowed. Try a smaller board, or fix more squares.',
    nodes: used,
  };
}

// ---- Symmetries: the search can run on a mirrored / turned copy of the board ------------

// Mirror across the top-left to bottom-right diagonal (rows become columns).
const T_DIR = [W, S, E, N];
const T_HALF = [0, 3, 2, 1, 7, 6, 5, 4, 11, 10, 9, 8];
const T_LOOK = [LOOK.ANY, LOOK.WHITE, LOOK.BLACK, LOOK.SLASH_WB, LOOK.SLASH_BW, LOOK.BACK_BW, LOOK.BACK_WB];
// Mirror top to bottom.
const V_DIR = [S, E, N, W];
const V_HALF = [3, 2, 1, 0, 6, 5, 4, 7, 10, 9, 8, 11];
const V_LOOK = [LOOK.ANY, LOOK.WHITE, LOOK.BLACK, LOOK.BACK_BW, LOOK.BACK_WB, LOOK.SLASH_BW, LOOK.SLASH_WB];

function mapPiece(p, dirMap, halfMap, r, c) {
  if (p.type === 'tri') return { ...p, r, c, o: halfMap[p.o] };
  const m = MIX_ORIENTS[p.o];
  return { ...p, r, c, o: mixOrientFor(dirMap[m.dir], halfMap[m.half]) };
}

export function solveInFrame(rows, cols, looks, inventory, frame, maxNodes, seed) {
  let R = rows;
  let C = cols;
  let L = looks;
  if (frame.tr) {
    const next = [];
    for (let c = 0; c < C; c += 1) for (let r = 0; r < R; r += 1) next.push(T_LOOK[L[r * C + c]]);
    L = next;
    [R, C] = [C, R];
  }
  if (frame.fv) {
    const next = [];
    for (let r = R - 1; r >= 0; r -= 1) for (let c = 0; c < C; c += 1) next.push(V_LOOK[L[r * C + c]]);
    L = next;
  }
  const run = searchOnce(R, C, L, inventory, maxNodes, seed ? makeRng(seed) : null);
  if (run.pieces) {
    let pieces = run.pieces;
    if (frame.fv) pieces = pieces.map((p) => mapPiece(p, V_DIR, V_HALF, R - 1 - p.r, p.c));
    if (frame.tr) pieces = pieces.map((p) => mapPiece(p, T_DIR, T_HALF, p.c, p.r));
    run.pieces = pieces;
  }
  return run;
}

function searchOnce(rows, cols, looks, inventory, maxNodes, rng) {
  const total = rows * cols;
  // res: white cubes left, black cubes left, white prisms left, black prisms left,
  // hidden loose ramps placed so far (their colour does not show, it is chosen at the end).
  const res = [inventory.mixW, inventory.mixB, inventory.triW, inventory.triB, 0];
  const down = new Uint8Array(cols); // message below the last finished square of each column
  let right = 0; // message right of the last finished square
  const chosen = new Array(total);
  const deadEnds = new Set();
  let nodes = 0;

  const sufWhite = new Int32Array(total + 1); // squares that must look white
  const sufBlack = new Int32Array(total + 1);
  const sufAny = new Int32Array(total + 1);
  const sufDiag = new Int32Array(total + 1);
  for (let i = total - 1; i >= 0; i -= 1) {
    const t = looks[i];
    sufWhite[i] = sufWhite[i + 1] + (t === LOOK.WHITE ? 1 : 0);
    sufBlack[i] = sufBlack[i + 1] + (t === LOOK.BLACK ? 1 : 0);
    sufAny[i] = sufAny[i + 1] + (t === LOOK.ANY ? 1 : 0);
    sufDiag[i] = sufDiag[i + 1] + (isDiagonalLook(t) ? 1 : 0);
  }

  const fits = (uses) => res[0] >= uses[0] && res[1] >= uses[1] && res[2] >= uses[2] && res[3] >= uses[3]
    && res[4] + uses[4] <= res[2] - uses[2] + res[3] - uses[3];

  function fillersFor(h, r, c) {
    // Ways to fill half h of square (r, c), other than a wedge arriving from above / left.
    const out = [];
    if (isRamp(h)) out.push({ src: 'tri', color: -1 }); // hidden: any colour will do
    else {
      out.push({ src: 'tri', color: 0 });
      out.push({ src: 'tri', color: 1 });
    }
    const sides = SOURCE_SIDES[h];
    if (c + 1 < cols && sides.includes(E)) {
      const t = looks[r * cols + c + 1];
      for (const color of [0, 1]) if (res[color] > 0 && cubeFitsLook(t, color)) out.push({ src: 'E', color });
    }
    if (r + 1 < rows && sides.includes(S)) {
      const t = looks[(r + 1) * cols + c];
      for (const color of [0, 1]) if (res[color] > 0 && cubeFitsLook(t, color)) out.push({ src: 'S', color });
    }
    return out;
  }

  function splitOption(t, a, b) {
    // a, b: { h, src: 'in' | 'tri' | 'E' | 'S', color } (color -1 = hidden ramp, any colour)
    if (a.src === b.src && (a.src === 'E' || a.src === 'S')) return null;
    const look = splitLook(a.h, Math.max(0, a.color), b.h, Math.max(0, b.color));
    if (t !== LOOK.ANY && look !== t) return null;
    const uses = [0, 0, 0, 0, 0];
    let outRight = 0;
    let outDown = 0;
    for (const p of [a, b]) {
      if (p.src === 'tri') {
        if (p.color < 0) uses[4] += 1;
        else uses[2 + p.color] += 1;
      } else if (p.src === 'E') outRight = message(WANT, p.h, p.color);
      else if (p.src === 'S') outDown = message(WANT, p.h, p.color);
    }
    if (!fits(uses)) return null;
    const fromCubes = (a.src === 'tri' ? 0 : 1) + (b.src === 'tri' ? 0 : 1);
    const score = fromCubes === 1 ? (a.src === 'in' || b.src === 'in' ? 0 : 1) : fromCubes === 2 && a.src === 'in' && b.src === 'in' ? 0 : 3;
    return { kind: 'split', parts: [a, b], uses, outRight, outDown, score };
  }

  function optionsAt(r, c) {
    const i = r * cols + c;
    const t = looks[i];
    const up = r > 0 ? down[c] : 0;
    const left = c > 0 ? right : 0;
    const upType = msgType(up);
    const leftType = msgType(left);
    const out = [];

    // Two halves here.
    if (upType !== WANT && leftType !== WANT) {
      const incoming = [];
      if (upType === WEDGE) incoming.push({ h: msgHalf(up), src: 'in', color: msgColor(up) });
      if (leftType === WEDGE) incoming.push({ h: msgHalf(left), src: 'in', color: msgColor(left) });
      if (incoming.length === 2) {
        if (COMPLEMENT[incoming[0].h] === incoming[1].h) {
          const op = splitOption(t, incoming[0], incoming[1]);
          if (op) out.push(op);
        }
      } else if (incoming.length === 1) {
        const h1 = COMPLEMENT[incoming[0].h];
        for (const f of fillersFor(h1, r, c)) {
          const op = splitOption(t, incoming[0], { h: h1, ...f });
          if (op) out.push(op);
        }
      } else {
        for (const [ha, hb] of PAIRS) {
          const fb = fillersFor(hb, r, c);
          for (const fa of fillersFor(ha, r, c)) {
            for (const f2 of fb) {
              const op = splitOption(t, { h: ha, ...fa }, { h: hb, ...f2 });
              if (op) out.push(op);
            }
          }
        }
      }
    }

    // A full cube here.
    if (upType !== WEDGE && leftType !== WEDGE && !(upType === WANT && leftType === WANT)) {
      if (upType === WANT || leftType === WANT) {
        const m = upType === WANT ? up : left;
        const color = msgColor(m);
        if (res[color] > 0 && cubeFitsLook(t, color)) {
          const uses = [0, 0, 0, 0, 0];
          uses[color] = 1;
          out.push({ kind: 'cube', color, dir: upType === WANT ? N : W, h: msgHalf(m), uses, outRight: 0, outDown: 0, score: 0 });
        }
      } else {
        for (const color of [0, 1]) {
          if (res[color] === 0 || !cubeFitsLook(t, color)) continue;
          const uses = [0, 0, 0, 0, 0];
          uses[color] = 1;
          if (c + 1 < cols) {
            const tr = looks[i + 1];
            for (const h of HALVES_FROM_SIDE[W]) {
              if (halfFitsLook(tr, h, color)) out.push({ kind: 'cube', color, dir: E, h, uses, outRight: message(WEDGE, h, color), outDown: 0, score: 1 });
            }
          }
          if (r + 1 < rows) {
            const td = looks[i + cols];
            for (const h of HALVES_FROM_SIDE[N]) {
              if (halfFitsLook(td, h, color)) out.push({ kind: 'cube', color, dir: S, h, uses, outRight: 0, outDown: message(WEDGE, h, color), score: 1 });
            }
          }
        }
      }
    }
    return out;
  }

  /** Can the rest of the board still work out, counting pieces only? */
  function hopeful(i, c) {
    const left = total - i;
    const cw = res[0];
    const cb = res[1];
    if (cw + cb > left) return false;
    if (cw > sufWhite[i] + sufAny[i] || cb > sufBlack[i] + sufAny[i]) return false;
    if (sufDiag[i] > left - cw - cb) return false;
    let inW = 0;
    let inB = 0;
    let wantW = 0;
    let wantB = 0;
    const tally = (m) => {
      const type = msgType(m);
      if (type === WEDGE) {
        if (msgColor(m)) inB += 1;
        else inW += 1;
      } else if (type === WANT) {
        if (msgColor(m)) wantB += 1;
        else wantW += 1;
      }
    };
    for (let k = 0; k < cols; k += 1) tally(down[k]);
    if (c > 0) tally(right);
    if (wantW > cw || wantB > cb) return false;
    // Squares that must look white need a white cube or a white half on top; split squares
    // need one white and one black half.
    const needW = Math.max(0, sufWhite[i] - cw) + sufDiag[i];
    if (needW > res[2] + cw - wantW + inW) return false;
    const needB = Math.max(0, sufBlack[i] - cb) + sufDiag[i];
    if (needB > res[3] + cb - wantB + inB) return false;
    return true;
  }

  function dfs(i) {
    if (i === total) return true;
    nodes += 1;
    if (nodes > maxNodes) throw new BudgetExceeded();
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    if (!hopeful(i, c)) return false;
    const key = `${i}|${c > 0 ? right : 0}|${down.join(',')}|${res.join(',')}`;
    if (deadEnds.has(key)) return false;

    let opts = optionsAt(r, c);
    // Try "domino-like" choices first: a cube that pushes its prism into the next square, or
    // a split square made of one prism from a cube and one loose prism. Squares with two loose
    // prisms (or two prisms from cubes) are rarer in solutions. On top of that, make a cube
    // here more likely when many cubes of this colour are still waiting for few squares.
    const t = looks[i];
    let lean = 0;
    if (t === LOOK.WHITE) lean = res[0] / Math.max(1, sufWhite[i] + sufAny[i]) - 0.5;
    else if (t === LOOK.BLACK) lean = res[1] / Math.max(1, sufBlack[i] + sufAny[i]) - 0.5;
    else if (t === LOOK.ANY) lean = (res[0] + res[1]) / Math.max(1, total - i) - 0.5;
    for (const op of opts) op.rank = op.score + (op.kind === 'cube' ? -4 : 4) * lean;
    if (rng) opts = weightedShuffle(opts, rng, (op) => 1 / (1 + Math.max(0, 3 * op.rank + 6)));
    else opts.sort((a, b) => a.rank - b.rank);
    const savedDown = down[c];
    const savedRight = right;
    for (const op of opts) {
      for (let k = 0; k < 5; k += 1) res[k] -= k < 4 ? op.uses[k] : -op.uses[k];
      down[c] = op.outDown;
      right = op.outRight;
      chosen[i] = op;
      if (dfs(i + 1)) return true;
      for (let k = 0; k < 5; k += 1) res[k] += k < 4 ? op.uses[k] : -op.uses[k];
    }
    down[c] = savedDown;
    right = savedRight;
    deadEnds.add(key);
    return false;
  }

  try {
    if (!dfs(0)) {
      return {
        status: 'impossible',
        code: 'search',
        reason: 'No arrangement of the pieces gives this picture (every possibility was checked).',
        nodes,
      };
    }
  } catch (err) {
    if (err instanceof BudgetExceeded) return { status: 'unknown', nodes };
    throw err;
  }
  // Hidden ramps take whatever prisms are left: white first, then black.
  let whiteLeft = res[2];
  const pieces = [];
  chosen.forEach((op, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (op.kind === 'cube') {
      pieces.push({ type: 'mix', color: colorOf(op.color), r, c, o: mixOrientFor(op.dir, op.h) });
      return;
    }
    for (const p of op.parts) {
      if (p.src !== 'tri') continue;
      let color = p.color;
      if (color < 0) {
        color = whiteLeft > 0 ? 0 : 1;
        if (color === 0) whiteLeft -= 1;
      }
      pieces.push({ type: 'tri', color: colorOf(color), r, c, o: p.h });
    }
  });
  const rank = (p) => (p.type === 'mix' ? 0 : isCap(p.o) ? 2 : 1);
  pieces.sort((a, b) => rank(a) - rank(b));
  return { status: 'possible', pieces, nodes };
}

/** Small seeded random generator (mulberry32). */
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** A random tiling of the board by dominoes: partner[i] = the other square of i's domino. */
export function randomDominoes(rows, cols, rng) {
  const partner = new Int32Array(rows * cols);
  const at = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (cols % 2 === 0) partner[at(r, c)] = at(r, c ^ 1);
      else partner[at(r, c)] = at(r ^ 1, c);
    }
  }
  // Random "flips" of 2x2 blocks covered by two parallel dominoes mix the tiling well.
  const flips = rows > 1 && cols > 1 ? 30 * rows * cols : 0;
  for (let k = 0; k < flips; k += 1) {
    const r = Math.floor(rng() * (rows - 1));
    const c = Math.floor(rng() * (cols - 1));
    const a = at(r, c);
    const b = at(r, c + 1);
    const d = at(r + 1, c);
    const e = at(r + 1, c + 1);
    if (partner[a] === b && partner[d] === e) {
      partner[a] = d; partner[d] = a; partner[b] = e; partner[e] = b;
    } else if (partner[a] === d && partner[b] === e) {
      partner[a] = b; partner[b] = a; partner[d] = e; partner[e] = d;
    }
  }
  return partner;
}

/**
 * A random complete arrangement: the board is cut into dominoes and each domino gets one
 * cube + prism (cube in one square, prism in the other) and one loose prism that fills the
 * rest of the prism's square. `split` (0..1) is how often the pieces stand up, which is
 * what makes diagonal splits appear.
 */
export function randomArrangement(rows, cols, inventory, rng = makeRng(), split = 0.5) {
  const partner = randomDominoes(rows, cols, rng);
  const dominoes = [];
  for (let i = 0; i < rows * cols; i += 1) if (i < partner[i]) dominoes.push([i, partner[i]]);
  const cubeColors = shuffle([...Array(inventory.mixW).fill('W'), ...Array(inventory.mixB).fill('B')], rng);
  const triColors = shuffle([...Array(inventory.triW).fill('W'), ...Array(inventory.triB).fill('B')], rng);
  if (cubeColors.length !== dominoes.length || triColors.length !== dominoes.length) {
    throw new Error('The pieces do not match the board size.');
  }
  const mixes = [];
  const loose = [];
  dominoes.forEach(([x, y], k) => {
    const [a, b] = rng() < 0.5 ? [x, y] : [y, x];
    const ar = Math.floor(a / cols);
    const ac = a % cols;
    const br = Math.floor(b / cols);
    const bc = b % cols;
    const dir = [N, E, S, W].find((d) => ar + DR[d] === br && ac + DC[d] === bc);
    const pose = rng() < split ? (rng() < 0.5 ? 0 : 1) : rng() < 0.5 ? 2 : 3;
    const o = dir * 4 + pose;
    const half = mixWedgeHalf(dir, pose);
    mixes.push({ type: 'mix', color: cubeColors[k], r: ar, c: ac, o });
    loose.push({ type: 'tri', color: triColors[k], r: br, c: bc, o: COMPLEMENT[half] });
  });
  // Ramps before the overhangs that rest on them.
  loose.sort((p, q) => (isCap(p.o) ? 1 : 0) - (isCap(q.o) ? 1 : 0));
  return [...mixes, ...loose];
}
