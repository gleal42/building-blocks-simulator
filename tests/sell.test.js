import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';

import { CODE_ALPHABET, baseAddress, findCode, isCode, normalizeCode, parseLink, sampleCode, unlockLink } from '../src/links.js';
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
  const long = unlockLink('https://example.com/a/rather/long/path/to/the/app/', 'K7QM-3XTP-ZR8D');
  assert.equal(scan(long), long);
  assert.equal(scan(unlockLink('https://example.com/', 'K7QM-3XTP-ZR8D')), 'https://example.com/#u-K7QM-3XTP-ZR8D');
});

test('unlock links, and anything else is ignored', () => {
  assert.equal(baseAddress('https://x.org/app/#u-AAAA'), 'https://x.org/app/');
  assert.equal(parseLink('#d-4x4-1121112211221122'), null, 'cards have no links');
  assert.deepEqual(parseLink('#u-k7qm-3xtp-zr8d'), { kind: 'unlock', code: 'K7QM-3XTP-ZR8D' });
  assert.equal(parseLink('#u-K7QM-3XTP'), null);
  assert.equal(parseLink('#costs'), null);
  assert.equal(normalizeCode(' k7qm 3xtp zr8d '), 'K7QM-3XTP-ZR8D');
  assert.ok(isCode('K7QM-3XTP-ZR8D'));
  assert.ok(!isCode('K7QM-3XTP-ZR8O'), 'O is not used, so it cannot be mistaken for 0');
});

test('a code is found in whatever is typed or pasted', () => {
  assert.equal(findCode('k7qm 3xtp zr8d'), 'K7QM-3XTP-ZR8D');
  assert.equal(findCode('K7QM3XTPZR8D'), 'K7QM-3XTP-ZR8D');
  // A whole list of codes pasted at once: the first one is used.
  assert.equal(findCode('2D7W-DXP4-9CMC\nZ3R5-ELXB-6CWS\n7N3G-WW7V-YBUV'), '2D7W-DXP4-9CMC');
  // The same list pasted into a one-line box (the line breaks dropped): still the first one.
  assert.equal(findCode('2D7W-DXP4-9CMCZ3R5-ELXB-6CWS7N3G-WW7V-YBUV'), '2D7W-DXP4-9CMC');
  assert.equal(findCode('Your code: 2d7w-dxp4-9cmc. Enjoy!'), '2D7W-DXP4-9CMC');
  assert.equal(findCode('https://example.com/#u-2D7W-DXP4-9CMC'), '2D7W-DXP4-9CMC');
  assert.equal(findCode('hello'), '');
  assert.equal(findCode('K7QM-3XTP-ZR80'), '', '0 is not used in codes');
});

test('sample codes: one per pack, always the same, well formed', () => {
  const a = sampleCode('builtin:starter-4x4');
  assert.ok(isCode(a));
  assert.equal(sampleCode('builtin:starter-4x4'), a);
  const many = new Set(Array.from({ length: 500 }, (_, i) => sampleCode(`p${i}`)));
  assert.equal(many.size, 500);
  for (const c of many) assert.ok([...c.replace(/-/g, '')].every((ch) => CODE_ALPHABET.includes(ch)));
});
