import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOK_SIZES,
  addChallenge,
  bookPages,
  bookTray,
  exportBook,
  imposition,
  importBook,
  newBook,
  reviveBook,
  spreads,
  suggestDifficulty,
} from '../src/book.js';
import { bookPdf, pageDrawing, pageSvg } from '../src/bookpages.js';
import { textWidth, wrapText, winAnsiCode } from '../src/fonts.js';
import { Board, defaultInventory } from '../src/board.js';
import { LOOK } from '../src/geometry.js';
import { makeRng, randomArrangement } from '../src/solver.js';

// A 1x1 JPEG.
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

function sampleBook(shape, n, count, seed = 1) {
  const book = newBook(shape, n);
  const { rows, cols } = bookTray(book);
  const rng = makeRng(seed);
  for (let i = 0; i < count; i += 1) {
    const pieces = randomArrangement(rows, cols, defaultInventory(rows, cols), rng, [0.1, 0.5, 0.9][i % 3]);
    const looks = Board.fromJSON({ rows, cols, pieces }).looks();
    addChallenge(book, { looks, answer: pieces, difficulty: (i % 3) + 1 });
  }
  return book;
}

test('square books: one challenge per page, covers outside, multiple of 4 pages', () => {
  for (let count = 0; count <= 9; count += 1) {
    const book = sampleBook('square', 4, count);
    const pages = bookPages(book);
    assert.equal(pages.length % 4, 0, `${count} challenges`);
    assert.equal(pages[0].kind, 'cover');
    assert.equal(pages.at(-1).kind, 'back');
    const shown = pages.filter((p) => p.kind === 'challenge').map((p) => p.index);
    assert.deepEqual(shown, [...Array(count).keys()]);
    assert.ok(pages.length - (count + 4) < 4, 'no more than 3 blank pages');
  }
});

test('2:1 books: each challenge fills a spread whose left page is even', () => {
  for (let count = 0; count <= 6; count += 1) {
    const book = sampleBook('rect', 4, count);
    const pages = bookPages(book);
    assert.equal(pages.length % 4, 0);
    for (let i = 0; i < count; i += 1) {
      const halves = pages.filter((p) => p.kind === 'challenge' && p.index === i);
      assert.equal(halves.length, 2);
      assert.equal(halves[0].half, 'left');
      assert.equal(halves[0].number % 2, 0, 'left page has an even number');
      assert.equal(halves[1].number, halves[0].number + 1);
    }
    // Pages of a spread really face each other in the open book.
    for (const s of spreads(pages.length)) {
      if (s.length !== 2) continue;
      const [l, r] = s.map((n) => pages[n - 1]);
      if (l.kind === 'challenge' || r.kind === 'challenge') assert.equal(l.index, r.index);
    }
  }
});

test('saddle-stitch imposition: covers on sheet 1, every page once, leaves in order', () => {
  for (const P of [4, 8, 12, 16, 24, 40]) {
    const sheets = imposition(P);
    assert.equal(sheets.length, P / 4);
    assert.deepEqual(sheets[0].outside, [P, 1], 'back and front cover outside');
    assert.deepEqual(sheets[0].inside, [2, P - 1], 'first and last inside page');
    const all = sheets.flatMap((s) => [...s.outside, ...s.inside]).sort((a, b) => a - b);
    assert.deepEqual(all, Array.from({ length: P }, (_, i) => i + 1));
    for (const s of sheets) {
      // The right half of a sheet is one leaf: its outside is a right page, its inside the next page.
      assert.equal(s.inside[0], s.outside[1] + 1);
      // The left half is the matching leaf near the end of the book.
      assert.equal(s.outside[0], s.inside[1] + 1);
    }
  }
  assert.throws(() => imposition(6));
});

test('saved books open again unchanged', () => {
  const book = sampleBook('rect', 4, 3);
  book.title = 'Desafios da Gonçalo';
  book.paper = 'letter';
  book.cover.front = { src: TINY_JPEG, width: 1, height: 1 };
  const again = importBook(exportBook(book));
  assert.equal(again.title, book.title);
  assert.equal(again.shape, 'rect');
  assert.equal(again.n, 4);
  assert.equal(again.paper, 'letter');
  assert.deepEqual(again.cover.front, book.cover.front);
  assert.equal(again.cover.back, null);
  assert.deepEqual(again.challenges.map((c) => [c.looks, c.difficulty, c.answer]), book.challenges.map((c) => [c.looks, c.difficulty, c.answer]));
  assert.deepEqual(reviveBook(JSON.parse(exportBook(book)).book).challenges.length, 3);
});

test('broken book files are refused with a clear message', () => {
  assert.throws(() => importBook('not json'), /not valid JSON/);
  assert.throws(() => importBook('{"format":"other"}'), /not a challenge book/);
  const good = JSON.parse(exportBook(sampleBook('square', 4, 1)));
  assert.throws(() => importBook(JSON.stringify({ ...good, version: 99 })), /newer version/);
  assert.throws(() => importBook(JSON.stringify({ ...good, book: { ...good.book, n: 5 } })), /tray size/);
  const bad = structuredClone(good);
  bad.book.challenges[0].looks = [1, 2, 3];
  assert.throws(() => importBook(JSON.stringify(bad)), /Challenge 1/);
  assert.equal(reviveBook({ shape: 'triangle' }), null);
});

test('challenges must fit the book and be fully painted', () => {
  const book = newBook('square', 4);
  assert.throws(() => addChallenge(book, { looks: new Array(32).fill(LOOK.WHITE) }), /needs 4×4/);
  assert.throws(() => addChallenge(book, { looks: new Array(16).fill(LOOK.ANY) }), /painted/);
  assert.equal(suggestDifficulty(new Array(16).fill(LOOK.WHITE)), 1);
  assert.equal(suggestDifficulty([...new Array(8).fill(LOOK.WHITE), ...new Array(8).fill(LOOK.BACK_WB)]), 3);
});

test('every page of every book size lays out with finite coordinates', () => {
  const check = (v, where) => assert.ok(Number.isFinite(v), where);
  for (const shape of ['square', 'rect']) {
    for (const n of BOOK_SIZES[shape]) {
      const book = sampleBook(shape, n, 3, n);
      const pages = bookPages(book);
      for (const page of pages) {
        const { items } = pageDrawing(book, page);
        for (const it of items) {
          for (const key of ['x', 'y', 'w', 'h', 'cx', 'cy', 'r', 'size']) if (it[key] !== undefined) check(it[key], `${shape}${n} p${page.number} ${it.t}.${key}`);
          for (const p of it.pts ?? []) p.forEach((v) => check(v, `${shape}${n} p${page.number} poly`));
        }
        assert.match(pageSvg(book, page.number, pages), /^<svg viewBox="(0|1000) 0 1000 1000"/);
      }
    }
  }
});

function pdfPageCount(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  return Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)[1]);
}

test('PDFs: booklet sheets in print order, single pages, cover pictures embedded', () => {
  const book = sampleBook('square', 4, 5);
  book.cover.back = { src: TINY_JPEG, width: 1, height: 1 };
  const P = bookPages(book).length;
  const sheets = bookPdf(book, 'sheets');
  const text = Buffer.from(sheets).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.equal(pdfPageCount(sheets), P / 2, 'two sides per sheet');
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.276\]/, 'A4 landscape');
  // Every cross-reference entry points at its object.
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
  const xref = text.slice(xrefAt).split('\n');
  const count = Number(xref[1].split(' ')[1]);
  for (let n = 1; n < count; n += 1) {
    const offset = Number(xref[2 + n].slice(0, 10));
    assert.ok(text.startsWith(`${n} 0 obj`, offset), `object ${n}`);
  }
  const single = bookPdf(book, 'pages');
  assert.equal(pdfPageCount(single), P);
  book.paper = 'letter';
  assert.match(Buffer.from(bookPdf(book, 'sheets')).toString('latin1'), /\/MediaBox \[0 0 792 612\]/, 'Letter landscape');
});

test('text widths and wrapping use the PDF font metrics', () => {
  assert.equal(textWidth('ii', 1000), 444);
  assert.ok(textWidth('Block', 10, true) > textWidth('Block', 10, false));
  assert.equal(textWidth('ção', 1000), textWidth('cao', 1000));
  assert.deepEqual(wrapText('one two three four', 100, 450), ['one two', 'three four']);
  assert.equal(winAnsiCode('é'), 0xe9);
  assert.equal(winAnsiCode('—'), 0x97);
  assert.equal(winAnsiCode('★'), 63);
});
