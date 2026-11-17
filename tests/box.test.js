import test from 'node:test';
import assert from 'node:assert/strict';

import { boxPdf, boxPlan, contentsDrawing, dieline, traySize } from '../src/box.js';

test('tray sizes: measured for 4×4 and 4×8, estimated otherwise', () => {
  assert.deepEqual(traySize(4, 4), { w: 112, d: 112, h: 25, measured: true });
  assert.equal(traySize(4, 8).w, 205);
  assert.equal(traySize(6, 6).measured, false);
});

test('the box fits the tray, the cards and the booklet, with room to spare', () => {
  const p = boxPlan({ rows: 4, cols: 4, cards: 48, layout: 'beside' });
  assert.ok(p.inner.l >= p.tray.w + p.deck.w + 3);
  assert.ok(p.inner.w >= p.tray.d);
  assert.ok(p.inner.h >= p.tray.h + p.booklet.h);
  assert.ok(p.lid.l > p.base.l && p.lid.w > p.base.w, 'the lid goes over the base');
  const top = boxPlan({ rows: 4, cols: 4, cards: 48, layout: 'top' });
  assert.ok(top.inner.h >= top.tray.h + top.deck.h + top.booklet.h);
  assert.ok(top.inner.l < p.inner.l, 'cards on top make a smaller footprint');
  const board = boxPlan({ rows: 4, cols: 8, cards: 24, material: 'board' });
  assert.equal(board.base.l, Math.round((board.inner.l + 3) * 10) / 10);
});

test('dielines and the PDF', () => {
  const p = boxPlan({ rows: 4, cols: 4, cards: 48 });
  const lid = dieline('lid', p, { title: 'Block Challenges', subtitle: '16 pieces · 48 cards' });
  const base = dieline('base', p, { title: 'Block Challenges', contents: ['1 tray'], maker: ['Me'] });
  const a = p.flats.lid.panel.l + 2 * p.flats.lid.wall;
  assert.ok(lid.w > a, 'the sheet holds the whole shape');
  assert.ok(lid.items.filter((i) => i.stroke === '#d0021b').length >= 14, 'cut lines');
  assert.ok(base.items.some((i) => i.text === 'Me'));
  assert.ok(contentsDrawing(p).items.length > 10);
  const bytes = boxPdf(p, { title: 'Block Challenges' });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), '%PDF-1.4');
});
