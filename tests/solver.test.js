import test from 'node:test';
import assert from 'node:assert/strict';

import { COMPLEMENT, LOOK, MIX_ORIENTS, PAIRS, DR, DC } from '../src/geometry.js';
import { Board, KINDS, defaultInventory } from '../src/board.js';
import { makeRng, quickCheck, randomArrangement, solveInFrame, solvePattern } from '../src/solver.js';
import { PRESETS } from '../src/presets.js';

function buildAndCheck(rows, cols, pieces) {
  const board = Board.fromJSON({ rows, cols, pieces });
  assert.ok(board.isComplete(), 'tray is full');
  for (const kind of KINDS) assert.equal(board.remaining(kind), 0, `all ${kind} used`);
  return board;
}

// Exhaustive list of every picture the real pieces can make on a small tray, found by
// trying every piece in every orientation with the Board model (independent of the solver).
// Canonical order: always fill the first open square; in an empty square either put a cube
// or cover the lower-numbered half of a pair (for lying pairs that is the ramp). Every
// arrangement is reached exactly once.
function allPictures(rows, cols) {
  const board = new Board(rows, cols);
  const pictures = new Set();
  const kinds = KINDS.map((kind) => ({ type: kind.slice(0, 3), color: kind[3], kind }));
  let arrangements = 0;
  function walk() {
    let open = -1;
    for (let i = 0; i < rows * cols; i += 1) {
      if (!board.isCellFull(Math.floor(i / cols), i % cols)) { open = i; break; }
    }
    if (open < 0) {
      arrangements += 1;
      pictures.add(board.looks().join(''));
      return;
    }
    const r = Math.floor(open / cols);
    const c = open % cols;
    const cell = board.cell(r, c);
    const halvesToCover = cell.halves.length === 1 ? [COMPLEMENT[cell.halves[0].h]] : PAIRS.map(([a]) => a);
    const tryPlace = (piece) => {
      const res = board.place(piece);
      if (!res.ok) return;
      walk();
      board.remove(res.id);
    };
    for (const { type, color, kind } of kinds) {
      if (board.remaining(kind) <= 0) continue;
      if (type === 'mix') {
        for (const m of MIX_ORIENTS) {
          if (cell.halves.length === 0) tryPlace({ type, color, r, c, o: m.o }); // cube here
          if (halvesToCover.includes(m.half)) tryPlace({ type, color, r: r - DR[m.dir], c: c - DC[m.dir], o: m.o });
        }
      } else {
        for (const h of halvesToCover) tryPlace({ type, color, r, c, o: h });
      }
    }
  }
  walk();
  return { pictures, arrangements };
}

test('a picture made only of split squares is impossible', () => {
  const looks = new Array(16).fill(LOOK.BACK_WB);
  const res = solvePattern(4, 4, looks, defaultInventory(4, 4));
  assert.equal(res.status, 'impossible');
  assert.equal(res.code, 'too-many-diagonals');
  assert.match(res.reason, /at most 8/);
});

test('colour budget checks', () => {
  assert.equal(quickCheck(2, 2, [1, 1, 1, 1], defaultInventory(2, 2)).code, 'black-cubes');
  assert.equal(quickCheck(2, 2, [2, 2, 2, 2], defaultInventory(2, 2)).code, 'white-cubes');
  assert.equal(quickCheck(4, 4, new Array(16).fill(0), defaultInventory(4, 4)).ok, true);
});

test('the photos can be rebuilt from their pictures alone', () => {
  for (const preset of PRESETS) {
    const target = Board.fromJSON(preset).looks();
    const res = solvePattern(preset.rows, preset.cols, target, defaultInventory(preset.rows, preset.cols));
    assert.equal(res.status, 'possible', preset.id);
    const board = buildAndCheck(preset.rows, preset.cols, res.pieces);
    assert.deepEqual(board.looks(), target);
  }
});

test('2×2 tray: the solver agrees with an exhaustive search of the real pieces', () => {
  const { pictures } = allPictures(2, 2);
  assert.ok(pictures.size > 10);
  const inv = defaultInventory(2, 2);
  let possible = 0;
  for (let n = 0; n < 6 ** 4; n += 1) {
    const looks = [0, 1, 2, 3].map((k) => (Math.floor(n / 6 ** k) % 6) + 1);
    const res = solvePattern(2, 2, looks, inv);
    assert.notEqual(res.status, 'unknown');
    assert.equal(res.status === 'possible', pictures.has(looks.join('')), `picture ${looks.join('')}`);
    if (res.status === 'possible') {
      possible += 1;
      assert.deepEqual(buildAndCheck(2, 2, res.pieces).looks(), looks);
    }
  }
  assert.equal(possible, pictures.size);
});

test('1×4 tray: the solver agrees with an exhaustive search of the real pieces', () => {
  const { pictures } = allPictures(1, 4);
  const inv = defaultInventory(1, 4);
  for (let n = 0; n < 6 ** 4; n += 1) {
    const looks = [0, 1, 2, 3].map((k) => (Math.floor(n / 6 ** k) % 6) + 1);
    const res = solvePattern(1, 4, looks, inv);
    assert.equal(res.status === 'possible', pictures.has(looks.join('')), `picture ${looks.join('')}`);
  }
});

test('2×4 tray: every picture the real pieces can make is found by the solver', () => {
  const { pictures, arrangements } = allPictures(2, 4);
  assert.ok(pictures.size > 1000, `found ${pictures.size} pictures in ${arrangements} arrangements`);
  const inv = defaultInventory(2, 4);
  for (const pic of pictures) {
    const looks = [...pic].map(Number);
    const res = solvePattern(2, 4, looks, inv);
    assert.equal(res.status, 'possible', pic);
  }
  // And a sample of pictures it cannot make is reported impossible.
  const rng = makeRng(7);
  let checked = 0;
  while (checked < 400) {
    const looks = Array.from({ length: 8 }, () => 1 + Math.floor(rng() * 6));
    if (pictures.has(looks.join(''))) continue;
    assert.equal(solvePattern(2, 4, looks, inv).status, 'impossible', looks.join(''));
    checked += 1;
  }
});

test('random arrangements fill trays of many sizes, and their pictures solve again', () => {
  const sizes = [[2, 2], [1, 4], [2, 4], [4, 4], [3, 4], [4, 6], [6, 4], [8, 4], [4, 8], [6, 6], [8, 8], [10, 10]];
  for (const [rows, cols] of sizes) {
    for (const split of [0.1, 0.5, 0.9]) {
      const rng = makeRng(rows * 1000 + cols * 10 + Math.round(split * 10));
      const pieces = randomArrangement(rows, cols, defaultInventory(rows, cols), rng, split);
      const board = buildAndCheck(rows, cols, pieces);
      const looks = board.looks();
      const res = solvePattern(rows, cols, looks, defaultInventory(rows, cols));
      assert.equal(res.status, 'possible', `${rows}x${cols} split ${split}`);
      assert.deepEqual(buildAndCheck(rows, cols, res.pieces).looks(), looks);
    }
  }
});

test('12×12 trays get random arrangements', () => {
  for (const split of [0.1, 0.5, 0.9]) {
    const pieces = randomArrangement(12, 12, defaultInventory(12, 12), makeRng(Math.round(split * 100)), split);
    buildAndCheck(12, 12, pieces);
  }
});

test('"any" squares let the solver choose', () => {
  const looks = new Array(16).fill(LOOK.ANY);
  looks[5] = LOOK.SLASH_BW;
  looks[6] = LOOK.SLASH_WB;
  const res = solvePattern(4, 4, looks, defaultInventory(4, 4));
  assert.equal(res.status, 'possible');
  const board = buildAndCheck(4, 4, res.pieces);
  assert.equal(board.lookAt(1, 1), LOOK.SLASH_BW);
  assert.equal(board.lookAt(1, 2), LOOK.SLASH_WB);
});

test('a big checkerboard of diagonals is decided quickly', () => {
  // 8x8 with half the squares split: exactly at the limit.
  const looks = [];
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) looks.push((r + c) % 2 ? LOOK.BACK_WB : r % 2 ? LOOK.WHITE : LOOK.BLACK);
  const res = solvePattern(8, 8, looks, defaultInventory(8, 8));
  assert.notEqual(res.status, 'unknown');
  if (res.status === 'possible') assert.deepEqual(buildAndCheck(8, 8, res.pieces).looks(), looks);
});

test('mirrored and turned searches map their answers back correctly', () => {
  for (const [rows, cols] of [[4, 4], [8, 4], [4, 6]]) {
    for (let seed = 1; seed <= 3; seed += 1) {
      const pieces = randomArrangement(rows, cols, defaultInventory(rows, cols), makeRng(seed * 13 + rows), 0.7);
      const looks = buildAndCheck(rows, cols, pieces).looks();
      for (const tr of [false, true]) {
        for (const fv of [false, true]) {
          const res = solveInFrame(rows, cols, looks, defaultInventory(rows, cols), { tr, fv }, 500000, 0);
          assert.equal(res.status, 'possible', `${rows}x${cols} tr=${tr} fv=${fv}`);
          assert.deepEqual(buildAndCheck(rows, cols, res.pieces).looks(), looks);
        }
      }
    }
  }
});
