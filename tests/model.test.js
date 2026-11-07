import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPLEMENT,
  HALF,
  HALVES,
  HALVES_FROM_SIDE,
  LOOK,
  MIX_ORIENTS,
  PAIRS,
  SOURCE_SIDES,
  cubeSolid,
  flipMix,
  flipTri,
  halfSolid,
  opposite,
  rotateMix,
  rotateTri,
  splitLook,
  tipMix,
  tipTri,
} from '../src/geometry.js';
import { Board, decodeBoard, defaultInventory, encodeBoard, sizeProblem } from '../src/board.js';
import { PRESETS } from '../src/presets.js';

// ---- helpers -------------------------------------------------------------------------

/** Volume of a convex polyhedron given by vertices and faces (divergence theorem). */
function volume({ verts, faces }) {
  const centre = verts.reduce((a, v) => a.map((x, i) => x + v[i] / verts.length), [0, 0, 0]);
  let vol = 0;
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k += 1) {
      const [a, b, c] = [verts[f[0]], verts[f[k]], verts[f[k + 1]]].map((v) => v.map((x, i) => x - centre[i]));
      vol += Math.abs(
        a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]),
      ) / 6;
    }
  }
  return vol;
}

/** Is point p (u, v, w) strictly inside the convex solid? */
function inside(solid, p) {
  const centre = solid.verts.reduce((a, v) => a.map((x, i) => x + v[i] / solid.verts.length), [0, 0, 0]);
  return solid.faces.every((f) => {
    const [a, b, c] = [solid.verts[f[0]], solid.verts[f[1]], solid.verts[f[2]]];
    const ab = b.map((x, i) => x - a[i]);
    const ac = c.map((x, i) => x - a[i]);
    let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const toCentre = centre.map((x, i) => x - a[i]);
    if (n.reduce((s, x, i) => s + x * toCentre[i], 0) > 0) n = n.map((x) => -x); // make it point outwards
    const d = n.reduce((s, x, i) => s + x * (p[i] - a[i]), 0);
    return d < -1e-9;
  });
}

const samplePoints = [];
for (let i = 0; i < 9; i += 1) for (let j = 0; j < 9; j += 1) for (let k = 0; k < 9; k += 1) {
  samplePoints.push([(i + 0.5 + 0.13 * k) / 10.2, (j + 0.5 + 0.07 * i) / 10.1, (k + 0.5 + 0.11 * j) / 10.3]);
}

// ---- geometry ---------------------------------------------------------------------------

test('every half is half a cube and its complement fills the rest exactly', () => {
  for (let h = 0; h < 12; h += 1) {
    const solid = halfSolid(h);
    assert.ok(Math.abs(volume(solid) - 0.5) < 1e-9, `${HALVES[h]} volume`);
    const other = halfSolid(COMPLEMENT[h]);
    assert.equal(COMPLEMENT[COMPLEMENT[h]], h);
    for (const p of samplePoints) {
      const a = inside(solid, p);
      const b = inside(other, p);
      assert.ok(!(a && b), `${HALVES[h]} overlaps its complement`);
    }
  }
  assert.ok(Math.abs(volume(cubeSolid()) - 1) < 1e-9);
});

test('two different halves that are not complements always overlap', () => {
  for (let a = 0; a < 12; a += 1) {
    for (let b = a + 1; b < 12; b += 1) {
      if (COMPLEMENT[a] === b) continue;
      const sa = halfSolid(a);
      const sb = halfSolid(b);
      assert.ok(samplePoints.some((p) => inside(sa, p) && inside(sb, p)), `${HALVES[a]} / ${HALVES[b]}`);
    }
  }
});

test('the prism of a cube + prism always touches the whole side shared with the cube', () => {
  for (const m of MIX_ORIENTS) {
    const side = opposite(m.dir);
    assert.ok(SOURCE_SIDES[m.half].includes(side), `orientation ${m.o}`);
    // The face of the half on that side must be a full unit square: check corners.
    const solid = halfSolid(m.half);
    const onSide = solid.verts.filter(([u, v]) => (side === 0 ? v === 1 : side === 1 ? u === 1 : side === 2 ? v === 0 : u === 0));
    assert.equal(new Set(onSide.map((p) => p.join(','))).size, 4, `orientation ${m.o} glue face`);
  }
  assert.equal(new Set(MIX_ORIENTS.map((m) => `${m.dir}:${m.half}`)).size, 16);
  for (let side = 0; side < 4; side += 1) assert.equal(HALVES_FROM_SIDE[side].length, 4);
});

test('pairs cover every half once', () => {
  const seen = PAIRS.flat().sort((a, b) => a - b);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const [a, b] of PAIRS) assert.equal(COMPLEMENT[a], b);
});

test('rotate / flip / tip shortcuts visit every orientation', () => {
  const seenMix = new Set();
  for (let o = 0; o < 16; o += 1) {
    assert.equal(rotateMix(rotateMix(rotateMix(rotateMix(o)))), o);
    assert.equal(flipMix(flipMix(o)), o);
    assert.equal(tipMix(tipMix(tipMix(tipMix(o)))), o);
    seenMix.add(rotateMix(o));
  }
  assert.equal(seenMix.size, 16);
  for (let h = 0; h < 12; h += 1) {
    assert.equal(rotateTri(rotateTri(rotateTri(rotateTri(h)))), h);
    assert.equal(flipTri(flipTri(h)), h);
    assert.equal(tipTri(tipTri(tipTri(h))), h);
  }
});

test('looks of split squares', () => {
  assert.equal(splitLook(HALF.U_NE, 0, HALF.U_SW, 1), LOOK.BACK_WB);
  assert.equal(splitLook(HALF.U_SW, 0, HALF.U_NE, 1), LOOK.BACK_BW);
  assert.equal(splitLook(HALF.U_NW, 1, HALF.U_SE, 0), LOOK.SLASH_BW);
  assert.equal(splitLook(HALF.U_NW, 1, HALF.U_SE, 1), LOOK.BLACK);
  assert.equal(splitLook(HALF.R_E, 1, HALF.O_W, 0), LOOK.WHITE, 'overhang hides the ramp');
  assert.throws(() => splitLook(HALF.U_NE, 0, HALF.U_NW, 0));
});

// ---- board ---------------------------------------------------------------------------

test('board sizes must split evenly into white and black sets', () => {
  assert.equal(sizeProblem(4, 4), null);
  assert.equal(sizeProblem(8, 4), null);
  assert.equal(sizeProblem(2, 2), null);
  assert.match(sizeProblem(3, 3), /multiple of 4/);
  assert.match(sizeProblem(2, 3), /multiple of 4/);
  assert.match(sizeProblem(0, 4), /between/);
  assert.deepEqual(defaultInventory(8, 4), { mixW: 8, mixB: 8, triW: 8, triB: 8 });
});

test('placing, overlapping and taking pieces out', () => {
  const b = new Board(2, 2);
  // White cube in the top-left, prism standing in the top-right square.
  const mix = { type: 'mix', color: 'W', r: 0, c: 0, o: MIX_ORIENTS.find((m) => m.dir === 1 && m.half === HALF.U_NW).o };
  assert.deepEqual(b.place(mix), { ok: true, id: 1 });
  assert.equal(b.remaining('mixW'), 0);
  assert.equal(b.check(mix).code, 'none-left');
  // The other half of the top-right square must be the complement.
  assert.equal(b.check({ type: 'tri', color: 'B', r: 0, c: 1, o: HALF.U_NE }).code, 'clash');
  assert.equal(b.check({ type: 'tri', color: 'B', r: 0, c: 0, o: HALF.U_NE }).code, 'taken');
  assert.ok(b.place({ type: 'tri', color: 'B', r: 0, c: 1, o: HALF.U_SE }).ok);
  assert.equal(b.lookAt(0, 1), LOOK.SLASH_WB);
  assert.equal(b.lookAt(0, 0), LOOK.WHITE);
  assert.equal(b.check({ type: 'tri', color: 'W', r: 0, c: 1, o: HALF.U_SE }).code, 'taken');
  // Prism sticking out of the tray.
  const out = { type: 'mix', color: 'B', r: 1, c: 1, o: MIX_ORIENTS.find((m) => m.dir === 1).o };
  assert.equal(b.check(out).code, 'outside');
  // Picking the right triangle by where you touch.
  assert.equal(b.pieceAt(0, 1, 0.1, 0.1), 1);
  assert.equal(b.pieceAt(0, 1, 0.9, 0.9), 2);
  assert.deepEqual(b.remove(1), [1]);
  assert.equal(b.cell(0, 0).cube, 0);
  assert.equal(b.cell(0, 1).halves.length, 1);
});

test('a loose overhang needs a ramp and falls out with it', () => {
  const b = new Board(2, 2);
  assert.equal(b.check({ type: 'tri', color: 'W', r: 1, c: 1, o: HALF.O_E }).code, 'needs-ramp');
  const ramp = b.place({ type: 'tri', color: 'B', r: 1, c: 1, o: HALF.R_W });
  assert.ok(ramp.ok);
  const cap = b.place({ type: 'tri', color: 'W', r: 1, c: 1, o: HALF.O_E });
  assert.ok(cap.ok);
  assert.equal(b.lookAt(1, 1), LOOK.WHITE);
  assert.equal(b.pieceAt(1, 1), cap.id, 'the top piece is picked first');
  assert.deepEqual(b.remove(ramp.id), [ramp.id, cap.id]);
  assert.equal(b.pieces.size, 0);
});

test('an overhang that belongs to a cube + prism holds itself up', () => {
  const b = new Board(2, 2);
  const o = MIX_ORIENTS.find((m) => m.dir === 1 && m.pose === 3).o; // prism to the east, lying slope-down
  const mix = b.place({ type: 'mix', color: 'B', r: 1, c: 0, o });
  assert.ok(mix.ok);
  assert.deepEqual(b.hollowCells(), [{ r: 1, c: 1 }]);
  assert.equal(b.lookAt(1, 1), -1);
  const ramp = b.place({ type: 'tri', color: 'W', r: 1, c: 1, o: HALF.R_E });
  assert.ok(ramp.ok);
  assert.equal(b.lookAt(1, 1), LOOK.BLACK);
  assert.deepEqual(b.remove(ramp.id), [ramp.id]);
  assert.equal(b.pieces.size, 1);
});

test('the photo presets fill their trays and look like the photos', () => {
  for (const preset of PRESETS) {
    const b = Board.fromJSON({ rows: preset.rows, cols: preset.cols, pieces: preset.pieces });
    assert.ok(b.isComplete(), preset.id);
    for (const kind of ['mixW', 'mixB', 'triW', 'triB']) assert.equal(b.remaining(kind), 0, `${preset.id} ${kind}`);
  }
  const photo1 = Board.fromJSON(PRESETS[0]);
  assert.deepEqual(photo1.looks(), [
    LOOK.BACK_WB, LOOK.WHITE, LOOK.BACK_BW, LOOK.BLACK,
    LOOK.WHITE, LOOK.WHITE, LOOK.BLACK, LOOK.BLACK,
    LOOK.WHITE, LOOK.WHITE, LOOK.BLACK, LOOK.BLACK,
    LOOK.WHITE, LOOK.WHITE, LOOK.BLACK, LOOK.BLACK,
  ]);
  const photo2 = Board.fromJSON(PRESETS[1]);
  assert.deepEqual(photo2.looks(), Array.from({ length: 32 }, (_, i) => (i % 4 < 2 ? LOOK.WHITE : LOOK.BLACK)));
});

test('board codes round-trip', () => {
  const b = Board.fromJSON(PRESETS[0]);
  const code = encodeBoard(b);
  assert.match(code, /^4x4:/);
  const back = decodeBoard(code);
  assert.deepEqual(back.looks(), b.looks());
  assert.equal(encodeBoard(back), code);
  assert.throws(() => decodeBoard('hello'), /board code/);
  assert.throws(() => decodeBoard('3x3:'), /multiple of 4/);
});
