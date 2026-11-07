// Challenge books: a printable booklet of pictures to rebuild in the tray.
//
// Pages are square. A square tray (n x n) gets one challenge per page; a 2:1 tray (n x 2n)
// gets one challenge per spread (two facing pages), so its picture runs across the fold.
// The booklet is printed on landscape sheets, two pages per side, then folded and stapled
// (saddle stitch). Page 1 is the front cover and the last page the back cover, so the first
// sheet carries both covers on its outside and the first and last inside pages on its
// inside.

import { LOOK, isDiagonalLook } from './geometry.js';

export const BOOK_FORMAT = 'building-blocks-challenge-book';
export const BOOK_VERSION = 1;
export const MAX_TITLE = 60;

export const DIFFICULTY = [
  null,
  { stars: 1, name: 'Easy', color: '#2f9e57' },
  { stars: 2, name: 'Medium', color: '#e5b20f' },
  { stars: 3, name: 'Hard', color: '#d5413a' },
];

/** Sheet sizes (landscape, millimetres) and the square page size used on them. */
export const PAPER = {
  a4: { name: 'A4', width: 297, height: 210, page: 140 },
  letter: { name: 'US Letter', width: 279.4, height: 215.9, page: 130 },
};

/** Tray sizes offered for books: square n x n, or 2:1 n x 2n. */
export const BOOK_SIZES = {
  square: [2, 4, 6, 8],
  rect: [2, 4, 6],
};

export const bookKey = (shape, n) => `${shape}-${n}`;

export function bookTray(book) {
  return { rows: book.n, cols: book.shape === 'rect' ? 2 * book.n : book.n };
}

export function newBook(shape = 'square', n = 4) {
  return {
    title: 'Block Challenges',
    shape,
    n,
    paper: 'a4',
    challenges: [],
    cover: { front: null, back: null },
    nextId: 1,
  };
}

/** Suggested difficulty from how many squares show a split. */
export function suggestDifficulty(looks) {
  const split = looks.filter((l) => isDiagonalLook(l)).length;
  const share = split / looks.length;
  if (share < 0.15) return 1;
  if (share < 0.32) return 2;
  return 3;
}

export function addChallenge(book, { looks, answer = null, difficulty = suggestDifficulty(looks) }) {
  const { rows, cols } = bookTray(book);
  if (looks.length !== rows * cols) throw new Error(`This picture is ${looks.length} squares; the book needs ${rows}×${cols}.`);
  if (looks.some((l) => l === LOOK.ANY || l < 0)) throw new Error('Every square of a challenge must be painted.');
  const challenge = { id: book.nextId, looks: looks.slice(), difficulty, answer };
  book.nextId += 1;
  book.challenges.push(challenge);
  return challenge;
}

/**
 * Pages in reading order: [{ number, kind, index?, half? }].
 * kinds: cover, howto, pieces, challenge, own (blank tray to draw on), back.
 * For 2:1 books, challenge and own pages come in pairs with half 'left' / 'right'; the
 * left page always has an even number, so the pair faces each other in the open book.
 */
export function bookPages(book) {
  const pages = [{ kind: 'cover' }, { kind: 'howto' }, { kind: 'pieces' }];
  if (book.shape === 'rect') {
    book.challenges.forEach((_, index) => {
      pages.push({ kind: 'challenge', index, half: 'left' });
      pages.push({ kind: 'challenge', index, half: 'right' });
    });
    while ((pages.length + 1) % 4 !== 0) {
      pages.push({ kind: 'own', half: 'left' });
      pages.push({ kind: 'own', half: 'right' });
    }
  } else {
    book.challenges.forEach((_, index) => pages.push({ kind: 'challenge', index }));
    while ((pages.length + 1) % 4 !== 0) pages.push({ kind: 'own' });
  }
  pages.push({ kind: 'back' });
  return pages.map((page, i) => ({ ...page, number: i + 1 }));
}

/**
 * Saddle-stitch imposition for a booklet of pageCount pages (a multiple of 4).
 * Sheet i (from the outside in) prints [last - 2i | 1 + 2i] on its outside and
 * [2 + 2i | last - 1 - 2i] on its inside. Pages are 1-based; [left, right].
 */
export function imposition(pageCount) {
  if (pageCount % 4 !== 0 || pageCount < 4) throw new Error('A booklet needs a multiple of 4 pages.');
  const sheets = [];
  for (let i = 0; i < pageCount / 4; i += 1) {
    sheets.push({
      sheet: i + 1,
      outside: [pageCount - 2 * i, 1 + 2 * i],
      inside: [2 + 2 * i, pageCount - 1 - 2 * i],
    });
  }
  return sheets;
}

/** Facing pages in reading order: [[1], [2, 3], ..., [last]]. */
export function spreads(pageCount) {
  const out = [[1]];
  for (let p = 2; p < pageCount; p += 2) out.push([p, p + 1]);
  out.push([pageCount]);
  return out;
}

// ---- Saving and loading ------------------------------------------------------------------

export function exportBook(book) {
  return JSON.stringify(
    {
      format: BOOK_FORMAT,
      version: BOOK_VERSION,
      savedAt: new Date().toISOString(),
      book: {
        title: book.title,
        shape: book.shape,
        n: book.n,
        paper: book.paper,
        cover: book.cover,
        challenges: book.challenges.map(({ looks, difficulty, answer }) => ({ looks, difficulty, answer })),
      },
    },
    null,
    1,
  );
}

function isCover(c) {
  return c === null || (typeof c === 'object' && typeof c.src === 'string' && /^data:image\/jpeg;base64,/.test(c.src)
    && Number.isFinite(c.width) && Number.isFinite(c.height) && c.width > 0 && c.height > 0);
}

function isPieceList(list) {
  return Array.isArray(list) && list.every((p) => p && (p.type === 'mix' || p.type === 'tri') && (p.color === 'W' || p.color === 'B')
    && Number.isInteger(p.r) && Number.isInteger(p.c) && Number.isInteger(p.o));
}

/** Parse a saved book. Throws an Error with a readable message when the file is not usable. */
export function importBook(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || data.format !== BOOK_FORMAT) throw new Error('That file is not a challenge book from this app.');
  if (data.version > BOOK_VERSION) throw new Error('That book was saved by a newer version of the app.');
  const b = data.book ?? {};
  const shape = b.shape === 'rect' ? 'rect' : b.shape === 'square' ? 'square' : null;
  if (!shape || !BOOK_SIZES[shape].includes(b.n)) throw new Error('The book has a tray size this app does not support.');
  const book = newBook(shape, b.n);
  book.title = typeof b.title === 'string' ? b.title.slice(0, MAX_TITLE) : book.title;
  book.paper = PAPER[b.paper] ? b.paper : 'a4';
  book.cover = {
    front: isCover(b.cover?.front ?? null) ? b.cover?.front ?? null : null,
    back: isCover(b.cover?.back ?? null) ? b.cover?.back ?? null : null,
  };
  const { rows, cols } = bookTray(book);
  if (!Array.isArray(b.challenges)) throw new Error('The book has no list of challenges.');
  b.challenges.forEach((ch, i) => {
    const looks = ch?.looks;
    if (!Array.isArray(looks) || looks.length !== rows * cols || !looks.every((l) => Number.isInteger(l) && l >= 1 && l <= 6)) {
      throw new Error(`Challenge ${i + 1} does not fit a ${rows}×${cols} tray.`);
    }
    const difficulty = [1, 2, 3].includes(ch.difficulty) ? ch.difficulty : suggestDifficulty(looks);
    addChallenge(book, { looks, difficulty, answer: isPieceList(ch.answer) ? ch.answer : null });
  });
  return book;
}

/** Rebuild a book kept in browser storage; null when it is not usable. */
export function reviveBook(raw) {
  try {
    return importBook(JSON.stringify({ format: BOOK_FORMAT, version: BOOK_VERSION, book: raw }));
  } catch {
    return null;
  }
}
