import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultInventory } from '../src/board.js';
import {
  PACK_SIZES,
  TRAY_SIZES,
  addDesigns,
  looksToText,
  newPack,
  normalizePack,
  packToCode,
  packToFile,
  parsePacks,
  suggestDifficulty,
  textToLooks,
} from '../src/packs.js';
import { solvePattern } from '../src/solver.js';

const packsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packs');
/** The packs that ship with the app: the files in packs/. */
const packFiles = () => readdirSync(packsDir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: f, raw: JSON.parse(readFileSync(path.join(packsDir, f), 'utf8')) }));

test('pack sizes: square and long trays; new packs are made for the trays that exist', () => {
  assert.deepEqual(PACK_SIZES.map((s) => `${s.rows}x${s.cols}`), ['2x2', '4x4', '6x6', '8x8', '2x4', '4x8', '6x12']);
  assert.deepEqual(TRAY_SIZES.map((s) => `${s.rows}x${s.cols}`), ['4x4', '4x8']);
  assert.throws(() => newPack({ rows: 8, cols: 4 }));
});

test('the pack files in packs/ are packs, and every design in them can be built', () => {
  const files = packFiles();
  assert.ok(files.length >= 1);
  const ids = new Set();
  for (const { file, raw } of files) {
    assert.equal(raw.format, 'building-blocks-pack', file);
    const pack = normalizePack(raw, { builtIn: true });
    assert.ok(pack.builtIn && pack.id.startsWith('builtin:'));
    assert.ok(pack.builtIn && pack.id.startsWith('builtin:'));
    assert.ok(!ids.has(pack.id), `duplicate id ${pack.id} (${file})`);
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

test('a pack as a file, and read back', () => {
  const pack = newPack({ name: 'Mine ✓', rows: 2, cols: 4 });
  addDesigns(pack, [{ looks: [1, 2, 3, 4, 5, 6, 1, 2], stars: 3 }, { looks: [1, 1, 1, 1, 2, 2, 2, 2] }]);
  const code = packToCode(pack);
  assert.doesNotThrow(() => JSON.parse(code));
  const [back] = parsePacks(code);
  assert.equal(back.name, 'Mine ✓');
  assert.equal(back.rows, 2);
  assert.equal(back.cols, 4);
  assert.deepEqual(back.designs, pack.designs);
  // The file object (packs/*.json, the artifact's database) reads back the same.
  const file = packToFile(pack);
  assert.equal(file.designs[0].looks, '1234/5612');
  assert.deepEqual(parsePacks(JSON.stringify(file))[0].designs, pack.designs);
  // Written by hand, with comments, unquoted keys and trailing commas.
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

test('designs can have from one to five stars', () => {
  const p = normalizePack({ name: 'A', rows: 2, cols: 2, designs: [1, 2, 3, 4, 5, 6, 0].map((stars) => ({ looks: '11/22', stars })) });
  assert.deepEqual(p.designs.slice(0, 5).map((d) => d.stars), [1, 2, 3, 4, 5]);
  assert.ok([1, 2, 3].includes(p.designs[5].stars), 'six stars falls back to the suggestion');
  assert.ok([1, 2, 3].includes(p.designs[6].stars));
});

test('the packs made from the book have nine designs of each star level', () => {
  for (const { file, raw } of packFiles().filter((f) => f.file.startsWith('book-'))) {
    const pack = normalizePack(raw, { builtIn: true });
    for (const level of [1, 2, 3, 4, 5]) assert.equal(pack.designs.filter((d) => d.stars === level).length, 9, `${file}, ${level} stars`);
  }
});

test('addDesigns skips designs the pack already has', () => {
  const pack = newPack({ rows: 2, cols: 2 });
  assert.deepEqual(addDesigns(pack, [{ looks: [1, 2, 2, 1] }, { looks: [1, 2, 2, 1] }, { looks: [2, 1, 1, 2] }]), { added: 2, duplicates: 1 });
  assert.equal(pack.designs.length, 2);
});

test('suggested stars follow the share of split squares', () => {
  assert.equal(suggestDifficulty([1, 1, 2, 2, 1, 1, 2, 2]), 1);
  assert.equal(suggestDifficulty([3, 4, 2, 2, 1, 1, 2, 2]), 2);
  assert.equal(suggestDifficulty([3, 4, 5, 2, 1, 1, 2, 2]), 3);
});
