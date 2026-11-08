import test from 'node:test';
import assert from 'node:assert/strict';

import { PAPER, addChallenge, bookTray, newBook } from '../src/book.js';
import { CARD, cardBack, cardFront, cardSheet, cardSlot, cardSvg, cardsPdf } from '../src/cards.js';
import { LOOK } from '../src/geometry.js';

function sampleBook(shape, count, paper = 'a4') {
  const book = newBook(shape, 4);
  book.paper = paper;
  const { rows, cols } = bookTray(book);
  const looks = [LOOK.WHITE, LOOK.SLASH_WB, LOOK.BLACK, LOOK.BACK_BW];
  for (let i = 0; i < count; i += 1) {
    addChallenge(book, { looks: Array.from({ length: rows * cols }, (_, k) => looks[(k + i) % 4]), difficulty: 1 + (i % 3) });
  }
  return book;
}

function pdfText(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

test('cards have the shape of the tray and fill a portrait sheet with room for the marks', () => {
  assert.equal(CARD.square.w, CARD.square.h);
  assert.equal(CARD.rect.w, 2 * CARD.rect.h);
  const expected = { 'square-a4': 12, 'square-letter': 12, 'rect-a4': 12, 'rect-letter': 10 };
  for (const shape of ['square', 'rect']) {
    for (const paper of Object.keys(PAPER)) {
      const L = cardSheet(sampleBook(shape, 0, paper));
      assert.ok(L.sheetH > L.sheetW, 'portrait');
      assert.equal(L.perSheet, expected[`${shape}-${paper}`], `${shape} on ${paper}`);
      // At least 10 mm free on every side for the printer and the cut marks.
      assert.ok(L.left >= 10 && L.top >= 10, `${shape} on ${paper}: left ${L.left}, top ${L.top}`);
      assert.ok(L.sheetW - L.left - L.cols * L.w >= 10);
      assert.ok(L.sheetH - L.top - L.rows * L.h >= 10);
    }
  }
});

test('card backs are mirrored left to right, so each lands behind its front', () => {
  for (const shape of ['square', 'rect']) {
    const L = cardSheet(sampleBook(shape, 0));
    for (let k = 0; k < L.perSheet; k += 1) {
      const front = cardSlot(L, k);
      const back = cardSlot(L, k, true);
      assert.equal(back.y, front.y);
      // Flipped on the long edge, x becomes sheetW - x - w.
      assert.ok(Math.abs(back.x - (L.sheetW - front.x - L.w)) < 1e-9, `card ${k}`);
    }
  }
});

test('a card shows its number, its stars and its picture; the back shows the title', () => {
  const book = sampleBook('rect', 3);
  book.title = 'Desafios do Gonçalo';
  const front = cardFront(book, 2);
  assert.ok(front.some((it) => it.t === 'text' && it.text === '3'));
  assert.equal(front.filter((it) => it.t === 'poly' && it.fill === '#e5b20f' && it.pts.length === 10).length, 0, 'challenge 3 is hard, not medium');
  assert.equal(front.filter((it) => it.t === 'poly' && it.fill === '#d5413a' && it.pts.length === 10).length, 3, 'three red stars');
  assert.ok(cardBack(book).some((it) => it.t === 'text' && it.text === 'Desafios do Gonçalo'));
  assert.match(cardSvg(book, 0), /viewBox="0 0 2000 1000"/);
  assert.match(cardSvg(sampleBook('square', 1), null), /viewBox="0 0 1000 1000"/);
});

test('the cards PDF has a page of fronts and a page of backs per sheet', () => {
  for (const [shape, count, sheets] of [['square', 13, 2], ['rect', 12, 1], ['square', 0, 1]]) {
    const bytes = cardsPdf(sampleBook(shape, count));
    const text = pdfText(bytes);
    assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)[1]);
    assert.equal(pages, 2 * sheets, `${count} ${shape} cards`);
    assert.match(text, /\/MediaBox \[0 0 595\.276 841\.89\]/, 'A4 portrait');
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
    const xref = text.slice(xrefAt).split('\n');
    const objects = Number(xref[1].split(' ')[1]);
    for (let n = 1; n < objects; n += 1) assert.ok(text.startsWith(`${n} 0 obj`, Number(xref[2 + n].slice(0, 10))), `object ${n}`);
  }
  const letter = pdfText(cardsPdf(sampleBook('rect', 11, 'letter')));
  assert.match(letter, /\/MediaBox \[0 0 612 792\]/, 'Letter portrait');
  assert.equal(Number(/\/Count (\d+)/.exec(letter)[1]), 4, '11 cards at 10 a sheet: 2 sheets');
});
