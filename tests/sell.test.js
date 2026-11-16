import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';

import { baseAddress, designLink, isCode, normalizeCode, parseLink, unlockLink } from '../src/links.js';
import { isLockedPack, lockPack, makeCodes, unlockAny, unlockPack } from '../src/lock.js';
import { newPack } from '../src/packs.js';
import { qrItems, qrMatrix } from '../src/qr.js';

/** Paint QR items into RGBA pixels and read them back with a real QR reader. */
function scan(text, px = 4) {
  const { size } = qrMatrix(text);
  const side = (size + 8) * px;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const it of qrItems(text, 0, 0, side)) {
    if (it.fill !== '#000000') continue;
    for (let y = Math.round(it.y); y < Math.round(it.y + it.h); y += 1) {
      for (let x = Math.round(it.x); x < Math.round(it.x + it.w); x += 1) {
        if (x >= side || y >= side) continue;
        const i = (y * side + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return jsQR(data, side, side)?.data ?? null;
}

test('QR codes read back as the same text', () => {
  const link = designLink('https://example.com/play/', 4, 4, [1, 1, 2, 1, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2]);
  assert.equal(scan(link), link);
  const long = designLink('https://example.com/', 6, 12, new Array(72).fill(5));
  assert.equal(scan(long), long);
  assert.equal(scan(unlockLink('https://example.com/', 'K7QM-3XTP-ZR8D')), 'https://example.com/#u-K7QM-3XTP-ZR8D');
});

test('links: design and unlock, and anything else is ignored', () => {
  assert.equal(baseAddress('https://x.org/app/#u-AAAA'), 'https://x.org/app/');
  const d = parseLink('#d-4x4-1121112211221122');
  assert.deepEqual(d, { kind: 'design', rows: 4, cols: 4, looks: [1, 1, 2, 1, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2] });
  assert.equal(parseLink('#d-4x4-112'), null, 'wrong length');
  assert.equal(parseLink('#d-3x3-111111111'), null, 'not a tray size');
  assert.equal(parseLink('#d-4x4-1121112211221170'), null, 'bad look');
  assert.deepEqual(parseLink('#u-k7qm-3xtp-zr8d'), { kind: 'unlock', code: 'K7QM-3XTP-ZR8D' });
  assert.equal(parseLink('#u-K7QM-3XTP'), null);
  assert.equal(parseLink('#costs'), null);
  assert.equal(normalizeCode(' k7qm 3xtp zr8d '), 'K7QM-3XTP-ZR8D');
  assert.ok(isCode('K7QM-3XTP-ZR8D'));
  assert.ok(!isCode('K7QM-3XTP-ZR8O'), 'O is not used, so it cannot be mistaken for 0');
});

test('codes are well formed and all different', () => {
  const codes = makeCodes(200);
  assert.equal(new Set(codes).size, 200);
  assert.ok(codes.every(isCode));
});

test('a locked pack opens with any of its codes and nothing else', async () => {
  const pack = newPack({ id: 'p1', name: 'Secret 2×2', rows: 2, cols: 2 });
  pack.designs = [{ looks: [1, 2, 2, 1], stars: 2 }, { looks: [2, 1, 1, 2], stars: 3 }];
  const codes = makeCodes(5);
  const locked = await lockPack(pack, codes, { iterations: 1000 });
  assert.ok(isLockedPack(locked));
  assert.equal(locked.keys.length, 5);
  assert.equal(locked.count, 2);
  const json = JSON.stringify(locked);
  assert.ok(!json.includes('1221') && !json.includes('Secret 2×2 design'), 'designs are not readable');
  for (const code of codes) {
    const open = await unlockPack(JSON.parse(json), code.toLowerCase().replace(/-/g, ' '));
    assert.deepEqual(open.designs, pack.designs);
    assert.equal(open.name, 'Secret 2×2');
  }
  assert.equal(await unlockPack(locked, makeCodes(1)[0]), null);
  const other = await lockPack({ ...pack, id: 'p2', name: 'Other' }, makeCodes(2), { iterations: 1000 });
  const found = await unlockAny([other, locked], codes[3]);
  assert.equal(found.locked.id, 'p1');
  assert.equal(await unlockAny([other], codes[3]), null);
});
