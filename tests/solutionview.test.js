import test from 'node:test';
import assert from 'node:assert/strict';

import { Board, defaultInventory, occupancy } from '../src/board.js';
import { isCap } from '../src/geometry.js';
import { boardAfter, buildOrder, describePiece } from '../src/solutionview.js';
import { makeRng, randomArrangement, solvePattern } from '../src/solver.js';

const hasRoof = (p) => occupancy(p).some((part) => !part.cube && isCap(part.h));

test('a solution goes in piece by piece: floor first, roofs last, and every step fits', () => {
  const rng = makeRng(7);
  for (const [rows, cols] of [[4, 4], [4, 8], [2, 4]]) {
    for (let k = 0; k < 40; k += 1) {
      const pieces = randomArrangement(rows, cols, defaultInventory(rows, cols), rng, [0.1, 0.5, 0.9][k % 3]);
      const order = buildOrder(pieces);
      assert.equal(order.length, pieces.length);
      const firstRoof = order.findIndex(hasRoof);
      if (firstRoof >= 0) assert.ok(order.slice(firstRoof).every(hasRoof), 'no floor piece after a roof');
      for (let n = 0; n <= order.length; n += 1) assert.ok(boardAfter(rows, cols, order, n), `${rows}×${cols} #${k}: step ${n}`);
      const done = boardAfter(rows, cols, order, order.length).board;
      assert.deepEqual(done.looks(), Board.fromJSON({ rows, cols, pieces }).looks(), 'the same picture at the end');
    }
  }
});

test('the solver\'s answers go in piece by piece too', () => {
  const looks = [2, 4, 1, 1, 2, 2, 2, 1, 5, 1, 2, 2, 1, 1, 2, 4];
  const res = solvePattern(4, 4, looks, defaultInventory(4, 4));
  assert.equal(res.status, 'possible');
  const order = buildOrder(res.pieces);
  assert.deepEqual(boardAfter(4, 4, order, order.length).board.looks(), looks);
});

test('pieces are described the way they lie', () => {
  assert.equal(describePiece({ type: 'tri', color: 'W', r: 0, c: 0, o: 1 }), 'White prism, standing');
  assert.equal(describePiece({ type: 'tri', color: 'B', r: 0, c: 0, o: 5 }), 'Black prism, lying as a ramp');
  assert.equal(describePiece({ type: 'tri', color: 'B', r: 0, c: 0, o: 9 }), 'Black prism, lying as a roof');
  assert.match(describePiece({ type: 'mix', color: 'W', r: 1, c: 1, o: 3 }), /^White cube \+ prism, its prism lying as a (roof|ramp)$/);
});
