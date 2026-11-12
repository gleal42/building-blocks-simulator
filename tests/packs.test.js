import test from 'node:test';
import assert from 'node:assert/strict';

import { addChallenge, newBook } from '../src/book.js';
import { defaultInventory } from '../src/board.js';
import { BUILT_IN_PACKS } from '../src/builtinpacks.js';
import {
  PACK_SIZES,
  addDesigns,
  bookShapeFor,
  builtInPacks,
  looksToText,
  newPack,
  normalizePack,
  packFromBook,
  packToCode,
  parsePacks,
  textToLooks,
} from '../src/packs.js';
import { solvePattern } from '../src/solver.js';

test('pack sizes are the book sizes', () => {
  assert.deepEqual(PACK_SIZES.map((s) => `${s.rows}x${s.cols}`), ['2x2', '4x4', '6x6', '8x8', '2x4', '4x8', '6x12']);
  assert.deepEqual(bookShapeFor(4, 8), { shape: 'rect', n: 4 });
  assert.equal(bookShapeFor(8, 4), null);
  assert.throws(() => newPack({ rows: 8, cols: 4 }));
});

test('every built-in design can be built', () => {
  const packs = builtInPacks();
  assert.equal(packs.length, BUILT_IN_PACKS.length);
  const ids = new Set();
  for (const pack of packs) {
    assert.ok(pack.builtIn && pack.id.startsWith('builtin:'));
    assert.ok(!ids.has(pack.id), `duplicate id ${pack.id}`);
    ids.add(pack.id);
    pack.designs.forEach((d, i) => {
      const res = solvePattern(pack.rows, pack.cols, d.looks, defaultInventory(pack.rows, pack.cols), { maxNodes: 8000000 });
      assert.equal(res.status, 'possible', `${pack.name}, design ${i + 1}: ${res.reason ?? ''}`);
    });
  }
});

test('looks as text', () => {
  assert.equal(looksToText([1, 2, 3, 4, 5, 6, 1, 2], 4), '1234/5612');
  assert.deepEqual(textToLooks('1234/5612', 2, 4), [1, 2, 3, 4, 5, 6, 1, 2]);
  assert.deepEqual(textToLooks('12 34\n56,12', 2, 4), [1, 2, 3, 4, 5, 6, 1, 2]);
  assert.throws(() => textToLooks('1230/5612', 2, 4), /digits 1 to 6/);
  assert.throws(() => textToLooks('123/5612', 2, 4), /needs 8 squares/);
});

test('copy as code and read it back', () => {
  const pack = newPack({ name: 'Mine ✓', rows: 2, cols: 4 });
  addDesigns(pack, [{ looks: [1, 2, 3, 4, 5, 6, 1, 2], stars: 3 }, { looks: [1, 1, 1, 1, 2, 2, 2, 2] }]);
  const code = packToCode(pack);
  assert.doesNotThrow(() => JSON.parse(code));
  const [back] = parsePacks(code);
  assert.equal(back.name, 'Mine ✓');
  assert.equal(back.rows, 2);
  assert.equal(back.cols, 4);
  assert.deepEqual(back.designs, pack.designs);
  // As pasted into src/builtinpacks.js, with comments, unquoted keys and trailing commas.
  const js = `export const BUILT_IN_PACKS = [
  // my pack
  { id: 'x', name: 'X', rows: 2, cols: 2, designs: [ { looks: '12/21', stars: 1, }, ], },
];`;
  const [x] = parsePacks(js);
  assert.deepEqual(x.designs, [{ looks: [1, 2, 2, 1], stars: 1 }]);
  assert.throws(() => parsePacks('hello'), /not a pack/);
  assert.throws(() => parsePacks('{"format":"something-else"}'), /not a pack from this app/);
  assert.throws(() => parsePacks('{"rows":3,"cols":3,"designs":[]}'), /packs can be/);
});

test('normalizePack fixes stars and rejects bad designs', () => {
  const p = normalizePack({ name: 'A', rows: 2, cols: 2, designs: [{ looks: '11/22' }] });
  assert.ok([1, 2, 3].includes(p.designs[0].stars));
  assert.throws(() => normalizePack({ name: 'A', rows: 2, cols: 2, designs: [{ looks: '11/2' }] }), /Design 1/);
});

test('addDesigns skips designs the pack already has', () => {
  const pack = newPack({ rows: 2, cols: 2 });
  assert.deepEqual(addDesigns(pack, [{ looks: [1, 2, 2, 1] }, { looks: [1, 2, 2, 1] }, { looks: [2, 1, 1, 2] }]), { added: 2, duplicates: 1 });
  assert.equal(pack.designs.length, 2);
});

test('a pack from a book keeps the pictures and stars', () => {
  const book = newBook('square', 2);
  book.title = 'Tiny';
  addChallenge(book, { looks: [1, 2, 2, 1], difficulty: 3 });
  const pack = packFromBook(book);
  assert.equal(pack.name, 'Tiny');
  assert.deepEqual(pack.designs, [{ looks: [1, 2, 2, 1], stars: 3 }]);
});
