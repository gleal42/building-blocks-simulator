// Packs: named sets of designs (pictures) for one tray size, to fill challenge books and
// card decks. A pack in memory:
//   { id, name, rows, cols, builtIn, designs: [{ looks: number[], stars: 1 | 2 | 3 }] }
// As text (to save, share or paste into src/builtinpacks.js) each design's looks is a string
// of digits, one per square, rows separated by "/" (see builtinpacks.js for the digits).

import { BOOK_SIZES, suggestDifficulty } from './book.js';
import { LOOK } from './geometry.js';
import { BUILT_IN_PACKS } from './builtinpacks.js';

export const PACK_FORMAT = 'building-blocks-pack';
export const PACK_VERSION = 1;
export const MAX_PACK_NAME = 60;

/** Tray sizes a pack can have: the challenge book sizes. */
export const PACK_SIZES = Object.freeze([
  ...BOOK_SIZES.square.map((n) => ({ shape: 'square', n, rows: n, cols: n })),
  ...BOOK_SIZES.rect.map((n) => ({ shape: 'rect', n, rows: n, cols: 2 * n })),
]);

export const sizeLabel = (rows, cols) => `${rows}×${cols}`;
export const isPackSize = (rows, cols) => PACK_SIZES.some((s) => s.rows === rows && s.cols === cols);
/** The challenge book (shape and n) that takes designs of this size, or null. */
export function bookShapeFor(rows, cols) {
  const s = PACK_SIZES.find((x) => x.rows === rows && x.cols === cols);
  return s ? { shape: s.shape, n: s.n } : null;
}

export const designKey = (rows, cols, looks) => `${rows}x${cols}:${looks.join('')}`;

export function slugify(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';
}

export function looksToText(looks, cols) {
  const rows = [];
  for (let i = 0; i < looks.length; i += cols) rows.push(looks.slice(i, i + cols).join(''));
  return rows.join('/');
}

/** Parse "1213/2112/..." (spaces, commas and line breaks also separate rows). */
export function textToLooks(text, rows, cols) {
  const digits = String(text).replace(/[\s/,|]+/g, '');
  if (!/^[1-6]*$/.test(digits)) throw new Error('A design may only use the digits 1 to 6.');
  if (digits.length !== rows * cols) throw new Error(`A ${sizeLabel(rows, cols)} design needs ${rows * cols} squares; this one has ${digits.length}.`);
  return [...digits].map(Number);
}

export function newPack({ id, name = 'New pack', rows = 4, cols = 4 } = {}) {
  if (!isPackSize(rows, cols)) throw new Error(`Packs can be ${PACK_SIZES.map((s) => sizeLabel(s.rows, s.cols)).join(', ')}.`);
  return { id: id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, rows, cols, builtIn: false, designs: [] };
}

/** Check and clean a pack from any source. Throws an Error with a readable message. */
export function normalizePack(raw, { builtIn = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('That is not a pack.');
  const rows = Number(raw.rows);
  const cols = Number(raw.cols);
  if (!isPackSize(rows, cols)) {
    throw new Error(`The pack is ${raw.rows}×${raw.cols}; packs can be ${PACK_SIZES.map((s) => sizeLabel(s.rows, s.cols)).join(', ')}.`);
  }
  if (!Array.isArray(raw.designs)) throw new Error('The pack has no list of designs.');
  const designs = raw.designs.map((d, i) => {
    let looks;
    try {
      looks = Array.isArray(d?.looks) ? d.looks.map(Number) : textToLooks(d?.looks ?? '', rows, cols);
    } catch (err) {
      throw new Error(`Design ${i + 1}: ${err.message}`);
    }
    if (looks.length !== rows * cols || !looks.every((l) => Number.isInteger(l) && l >= LOOK.WHITE && l <= LOOK.BACK_BW)) {
      throw new Error(`Design ${i + 1} does not fit a ${sizeLabel(rows, cols)} tray.`);
    }
    const stars = [1, 2, 3].includes(Number(d.stars)) ? Number(d.stars) : suggestDifficulty(looks);
    return { looks, stars };
  });
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, MAX_PACK_NAME) : 'Pack';
  const id = typeof raw.id === 'string' && raw.id ? raw.id : slugify(name);
  return { id: builtIn ? `builtin:${id}` : id, name, rows, cols, builtIn, designs };
}

export const builtInPacks = () => BUILT_IN_PACKS.map((p) => normalizePack(p, { builtIn: true }));

/**
 * The pack as text: valid JSON and valid JavaScript, so it can be saved as a .json file,
 * opened again, or pasted straight into the list in src/builtinpacks.js.
 */
export function packToCode(pack) {
  const id = pack.builtIn ? pack.id.replace(/^builtin:/, '') : slugify(pack.name);
  const lines = pack.designs.map((d) => `    { "looks": ${JSON.stringify(looksToText(d.looks, pack.cols))}, "stars": ${d.stars} }`);
  return `{
  "format": "${PACK_FORMAT}",
  "version": ${PACK_VERSION},
  "id": ${JSON.stringify(id)},
  "name": ${JSON.stringify(pack.name)},
  "rows": ${pack.rows},
  "cols": ${pack.cols},
  "designs": [
${lines.join(',\n')}
  ]
}`;
}

/**
 * Read packs from text: one pack, a list of packs, or a saved pack file. Comments and
 * trailing commas (as in a JavaScript file) are allowed. Returns a list of packs.
 */
export function parsePacks(text) {
  const cleaned = String(text)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*export\s+const\s+\w+\s*=\s*/m, '')
    .replace(/;\s*$/, '')
    .replace(/,\s*([\]}])/g, '$1')
    .replace(/,\s*$/, '')
    .trim();
  if (!cleaned) throw new Error('There is nothing to read.');
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    // Unquoted keys, as in a JavaScript object: { looks: '1213', stars: 2 }.
    try {
      data = JSON.parse(cleaned.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'([^'\\]*)'/g, '"$1"'));
    } catch {
      throw new Error('That text is not a pack (it should look like what “Copy as code” gives).');
    }
  }
  if (data && data.format && data.format !== PACK_FORMAT) throw new Error('That file is not a pack from this app.');
  if (data && data.version > PACK_VERSION) throw new Error('That pack was saved by a newer version of the app.');
  const list = Array.isArray(data) ? data : data?.pack ? [data.pack] : Array.isArray(data?.packs) ? data.packs : [data];
  if (!list.length) throw new Error('There are no packs in that text.');
  return list.map((p) => normalizePack(p));
}

/** Add designs that the pack does not have yet. Returns { added, duplicates }. */
export function addDesigns(pack, designs) {
  const seen = new Set(pack.designs.map((d) => d.looks.join('')));
  let added = 0;
  let duplicates = 0;
  for (const d of designs) {
    const key = d.looks.join('');
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    pack.designs.push({ looks: d.looks.slice(), stars: [1, 2, 3].includes(d.stars) ? d.stars : suggestDifficulty(d.looks) });
    added += 1;
  }
  return { added, duplicates };
}

/** A pack holding the challenges of a book. */
export function packFromBook(book, id) {
  const rows = book.n;
  const cols = book.shape === 'rect' ? 2 * book.n : book.n;
  const pack = newPack({ id, name: book.title || 'From the book', rows, cols });
  addDesigns(pack, book.challenges.map((c) => ({ looks: c.looks, stars: c.difficulty })));
  return pack;
}
