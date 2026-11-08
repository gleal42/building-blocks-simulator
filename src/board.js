// Board model: a tray of rows x cols squares and the pieces placed in it.
//
// Pieces
//   { id, type: 'mix' | 'tri', color: 'W' | 'B', r, c, o }
//   type 'mix' = cube + prism glued together. (r, c) is the square of the cube and o is an
//                index into MIX_ORIENTS (prism direction + pose).
//   type 'tri' = loose triangular prism (half cube). o is the half index (0..11).

import {
  COMPLEMENT,
  DC,
  DR,
  HALVES,
  MIX_ORIENTS,
  isCap,
  isRamp,
  isUpright,
  splitLook,
  solidLook,
  uprightContains,
} from './geometry.js';

export const KINDS = Object.freeze(['mixW', 'mixB', 'triW', 'triB']);
export const kindOf = (piece) => `${piece.type}${piece.color}`;
export const colorBit = (color) => (color === 'W' ? 0 : 1);
export const colorOf = (bit) => (bit === 0 ? 'W' : 'B');

export const MIN_SIZE = 1;
export const MAX_SIZE = 12;

/** Why a board size is not allowed, or null if it is fine. */
export function sizeProblem(rows, cols) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) return 'Rows and columns must be whole numbers.';
  if (rows < MIN_SIZE || cols < MIN_SIZE || rows > MAX_SIZE || cols > MAX_SIZE) {
    return `Rows and columns must be between ${MIN_SIZE} and ${MAX_SIZE}.`;
  }
  if ((rows * cols) % 4 !== 0) {
    return 'The number of squares must be a multiple of 4: every 2 squares take one cube + prism and one loose prism, and white and black get the same number of each.';
  }
  return null;
}

/** Pieces that come with a tray: per 2 squares one cube + prism and one loose prism, half white and half black. */
export function defaultInventory(rows, cols) {
  const problem = sizeProblem(rows, cols);
  if (problem) throw new Error(problem);
  const q = (rows * cols) / 4;
  return { mixW: q, mixB: q, triW: q, triB: q };
}

/** Squares (and which part) that a piece would occupy. */
export function occupancy(piece) {
  if (piece.type === 'tri') return [{ r: piece.r, c: piece.c, cube: false, h: piece.o }];
  const m = MIX_ORIENTS[piece.o];
  return [
    { r: piece.r, c: piece.c, cube: true, h: -1 },
    { r: piece.r + DR[m.dir], c: piece.c + DC[m.dir], cube: false, h: m.half },
  ];
}

/** Halves from the top down: roofs, then standing prisms, then ramps. */
const halfRank = (h) => (isCap(h) ? 0 : isUpright(h) ? 1 : 2);

/** Does the piece cover point (fx, fy) of square (r, c), seen from above? */
export function pieceCovers(piece, r, c, fx = 0.5, fy = 0.5) {
  return occupancy(piece).some((part) => part.r === r && part.c === c && (part.cube || !isUpright(part.h) || uprightContains(part.h, fx, fy)));
}

export class Board {
  constructor(rows, cols, inventory = defaultInventory(rows, cols)) {
    this.rows = rows;
    this.cols = cols;
    this.inventory = { ...inventory };
    this.pieces = new Map();
    // Each square: cube = id of the cube+prism whose cube is here (0 = none),
    // halves = [{ h, id }] (at most two, always complementary).
    this.cells = Array.from({ length: rows * cols }, () => ({ cube: 0, halves: [] }));
    this.nextId = 1;
  }

  index(r, c) {
    return r * this.cols + c;
  }

  inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
  }

  cell(r, c) {
    return this.cells[this.index(r, c)];
  }

  placedCount(kind) {
    let n = 0;
    for (const p of this.pieces.values()) if (kindOf(p) === kind) n += 1;
    return n;
  }

  remaining(kind) {
    return this.inventory[kind] - this.placedCount(kind);
  }

  totalPieces() {
    return KINDS.reduce((sum, k) => sum + this.inventory[k], 0);
  }

  /**
   * Can this piece go in? Returns { ok: true } or { ok: false, code, r, c, otherId }.
   * Codes: none-left, outside, taken, clash, needs-ramp.
   */
  check(piece) {
    if (this.remaining(kindOf(piece)) <= 0) return { ok: false, code: 'none-left' };
    const occ = occupancy(piece);
    for (const part of occ) {
      if (!this.inBounds(part.r, part.c)) return { ok: false, code: 'outside', r: part.r, c: part.c };
    }
    for (const part of occ) {
      const cell = this.cell(part.r, part.c);
      if (cell.cube) return { ok: false, code: 'taken', r: part.r, c: part.c, otherId: cell.cube };
      if (part.cube) {
        if (cell.halves.length) return { ok: false, code: 'taken', r: part.r, c: part.c, otherId: cell.halves[0].id };
        continue;
      }
      if (cell.halves.length >= 2) return { ok: false, code: 'taken', r: part.r, c: part.c, otherId: cell.halves[0].id };
      if (cell.halves.length === 1 && cell.halves[0].h !== COMPLEMENT[part.h]) {
        return { ok: false, code: 'clash', r: part.r, c: part.c, otherId: cell.halves[0].id };
      }
      // A loose prism lying slope-down only rests on a ramp; on its own it would tip over.
      if (piece.type === 'tri' && isCap(part.h) && cell.halves.length === 0) {
        return { ok: false, code: 'needs-ramp', r: part.r, c: part.c };
      }
    }
    return { ok: true };
  }

  /** Place a piece. Returns { ok, id } or the failed check. */
  place(piece) {
    const res = this.check(piece);
    if (!res.ok) return res;
    const id = piece.id && !this.pieces.has(piece.id) ? piece.id : this.nextId;
    this.nextId = Math.max(this.nextId, id + 1);
    const stored = { id, type: piece.type, color: piece.color, r: piece.r, c: piece.c, o: piece.o };
    this.pieces.set(id, stored);
    for (const part of occupancy(stored)) {
      const cell = this.cell(part.r, part.c);
      if (part.cube) cell.cube = id;
      else cell.halves.push({ h: part.h, id });
    }
    return { ok: true, id };
  }

  /**
   * Take a piece out. A loose prism resting on its ramp part would fall, so it comes out
   * too. Returns the ids removed (the piece first).
   */
  remove(id) {
    const piece = this.pieces.get(id);
    if (!piece) return [];
    const removed = [id];
    for (const part of occupancy(piece)) {
      const cell = this.cell(part.r, part.c);
      if (part.cube) {
        cell.cube = 0;
        continue;
      }
      cell.halves = cell.halves.filter((x) => x.id !== id);
      if (isRamp(part.h)) {
        const top = cell.halves.find((x) => isCap(x.h) && this.pieces.get(x.id)?.type === 'tri');
        if (top) removed.push(...this.remove(top.id));
      }
    }
    this.pieces.delete(id);
    return removed;
  }

  clear() {
    this.pieces.clear();
    for (const cell of this.cells) {
      cell.cube = 0;
      cell.halves = [];
    }
  }

  /** The piece you would pick up when touching point (fx, fy) of square (r, c). */
  pieceAt(r, c, fx = 0.5, fy = 0.5) {
    if (!this.inBounds(r, c)) return 0;
    const cell = this.cell(r, c);
    if (cell.cube) return cell.cube;
    if (cell.halves.length === 0) return 0;
    if (cell.halves.length === 1) return cell.halves[0].id;
    const [a, b] = cell.halves;
    if (isUpright(a.h)) return uprightContains(a.h, fx, fy) ? a.id : b.id;
    return isCap(a.h) ? a.id : b.id;
  }

  /**
   * The pieces under point (fx, fy) of square (r, c), seen from above, top first: a roof
   * before the ramp it rests on. A standing prism only counts where the point is inside it.
   */
  piecesAt(r, c, fx = 0.5, fy = 0.5) {
    if (!this.inBounds(r, c)) return [];
    const cell = this.cell(r, c);
    if (cell.cube) return [cell.cube];
    return cell.halves
      .filter((x) => !isUpright(x.h) || uprightContains(x.h, fx, fy))
      .sort((a, b) => halfRank(a.h) - halfRank(b.h))
      .map((x) => x.id);
  }

  /**
   * The pieces stacked with piece `id` in square (r, c), top first: a roof and the ramp under
   * it. A piece with nothing above or below it is a stack of one.
   */
  stackWith(r, c, id) {
    if (!this.inBounds(r, c)) return [id];
    const lying = this.cell(r, c).halves.filter((x) => !isUpright(x.h));
    if (lying.length < 2 || !lying.some((x) => x.id === id)) return [id];
    return lying.sort((a, b) => halfRank(a.h) - halfRank(b.h)).map((x) => x.id);
  }

  isCellFull(r, c) {
    const cell = this.cell(r, c);
    return cell.cube !== 0 || cell.halves.length === 2;
  }

  isComplete() {
    for (let r = 0; r < this.rows; r += 1) for (let c = 0; c < this.cols; c += 1) if (!this.isCellFull(r, c)) return false;
    return true;
  }

  /** Look code of a finished square (see LOOK), or -1 while it is not full. */
  lookAt(r, c) {
    const cell = this.cell(r, c);
    if (cell.cube) return solidLook(colorBit(this.pieces.get(cell.cube).color));
    if (cell.halves.length < 2) return -1;
    const [a, b] = cell.halves;
    return splitLook(a.h, colorBit(this.pieces.get(a.id).color), b.h, colorBit(this.pieces.get(b.id).color));
  }

  looks() {
    const out = [];
    for (let r = 0; r < this.rows; r += 1) for (let c = 0; c < this.cols; c += 1) out.push(this.lookAt(r, c));
    return out;
  }

  /** Squares with an overhang that has nothing underneath yet. */
  hollowCells() {
    const out = [];
    this.cells.forEach((cell, i) => {
      if (cell.halves.length === 1 && isCap(cell.halves[0].h)) out.push({ r: Math.floor(i / this.cols), c: i % this.cols });
    });
    return out;
  }

  /**
   * What can be seen in square (r, c) from above, top layer first:
   * { cube: piece|null, halves: [{ h, piece, visible }] }.
   */
  describeCell(r, c) {
    const cell = this.cell(r, c);
    return {
      cube: cell.cube ? this.pieces.get(cell.cube) : null,
      halves: cell.halves.map(({ h, id }) => ({
        h,
        piece: this.pieces.get(id),
        visible: !(isRamp(h) && cell.halves.length === 2),
      })),
    };
  }

  /** Is the ramp part (half h) of a piece in square (r, c) covered by an overhang? */
  isCovered(r, c, h) {
    if (!isRamp(h)) return false;
    return this.cell(r, c).halves.some((x) => x.h === COMPLEMENT[h]);
  }

  /** Pieces in an order that can be placed back one by one (overhangs after their ramps). */
  orderedPieces() {
    const rank = (p) => (p.type === 'mix' ? 0 : isCap(p.o) ? 2 : 1);
    return [...this.pieces.values()].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  }

  toJSON() {
    return {
      rows: this.rows,
      cols: this.cols,
      inventory: { ...this.inventory },
      pieces: this.orderedPieces().map(({ type, color, r, c, o }) => ({ type, color, r, c, o })),
    };
  }

  static fromJSON(data) {
    const board = new Board(data.rows, data.cols, data.inventory ?? defaultInventory(data.rows, data.cols));
    for (const p of data.pieces ?? []) {
      const res = board.place(p);
      if (!res.ok) throw new Error(`Cannot place ${p.type}${p.color} at ${p.r},${p.c}: ${res.code}`);
    }
    return board;
  }

  /** A copy with the same piece ids. */
  clone() {
    const copy = new Board(this.rows, this.cols, this.inventory);
    for (const p of this.orderedPieces()) copy.place({ ...p });
    copy.nextId = this.nextId;
    return copy;
  }

  /**
   * Could piece `id` be lifted out and put back as `piece` (moved, turned or both)? Returns
   * the check, plus `fallen`: loose prisms resting on it that would come out with it.
   */
  checkMove(id, piece) {
    const trial = this.clone();
    const fallen = trial.remove(id).slice(1);
    return { ...trial.check(piece), fallen };
  }

  /** Move or turn piece `id` (it keeps its id). Returns { ok, id, fallen } or the failed check. */
  move(id, piece) {
    const res = this.checkMove(id, piece);
    if (!res.ok) return res;
    const fallen = this.remove(id).slice(1);
    this.place({ ...piece, id });
    return { ok: true, id, fallen };
  }
}

/** Short human description of a piece, for messages. */
export function pieceName(piece) {
  const color = piece.color === 'W' ? 'white' : 'black';
  return piece.type === 'mix' ? `${color} cube + prism` : `${color} prism`;
}

export function halfName(h) {
  return HALVES[h];
}

// ---- Compact text codes for sharing a board ---------------------------------------------
// Format: "<rows>x<cols>:" then 3 characters per piece: kind+orientation, row, column.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function encodeBoard(board) {
  let s = `${board.rows}x${board.cols}:`;
  for (const p of board.orderedPieces()) {
    // 0..15 white mix, 16..31 black mix, 32..43 white prism, 44..55 black prism
    const base = p.type === 'mix' ? (p.color === 'W' ? 0 : 16) : p.color === 'W' ? 32 : 44;
    s += ALPHABET[base + p.o] + ALPHABET[p.r] + ALPHABET[p.c];
  }
  return s;
}

export function decodeBoard(text) {
  const m = /^\s*(\d+)x(\d+):([0-9a-zA-Z]*)\s*$/.exec(text ?? '');
  if (!m) throw new Error('That does not look like a board code (it should start like "4x4:").');
  const rows = Number(m[1]);
  const cols = Number(m[2]);
  const problem = sizeProblem(rows, cols);
  if (problem) throw new Error(problem);
  const body = m[3];
  if (body.length % 3 !== 0) throw new Error('The board code is cut off.');
  const board = new Board(rows, cols);
  for (let i = 0; i < body.length; i += 3) {
    const k = ALPHABET.indexOf(body[i]);
    const r = ALPHABET.indexOf(body[i + 1]);
    const c = ALPHABET.indexOf(body[i + 2]);
    if (k < 0 || k > 55) throw new Error('The board code has an unknown piece.');
    const piece = k < 32
      ? { type: 'mix', color: k < 16 ? 'W' : 'B', o: k % 16, r, c }
      : { type: 'tri', color: k < 44 ? 'W' : 'B', o: (k - 32) % 12, r, c };
    const res = board.place(piece);
    if (!res.ok) throw new Error('The board code has pieces that do not fit together.');
  }
  return board;
}
