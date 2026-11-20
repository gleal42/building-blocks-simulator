// Make packs from the book of designs: node scripts/book-packs.mjs [4x4 ...]
//
// Reads book/<size>.json (the designs read from photos of the book, with their stars) and
// writes packs/book-<size>-<n>.json. Every pack has the same number of designs of each star
// level (9 by default), so the packs are equally hard. As many packs are made as the scarcest
// level allows. The designs of a level are spread over the packs in book order (pack 1 gets
// the 1st, 6th, 11th... of 5 packs), so each pack has designs from all over the book. A design
// that appears twice in the book is used once. What is left over is listed at the end.

import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePack, packToCode } from '../src/packs.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PER_LEVEL = Number(process.env.PER_LEVEL ?? 9);

function makePacks(size) {
  const book = JSON.parse(readFileSync(path.join(root, 'book', `${size}.json`), 'utf8'));
  const seen = new Set();
  const byLevel = new Map();
  for (const d of book.designs) {
    const key = d.looks.replace(/\//g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byLevel.has(d.stars)) byLevel.set(d.stars, []);
    byLevel.get(d.stars).push(d);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const count = Math.min(...levels.map((s) => Math.floor(byLevel.get(s).length / PER_LEVEL)));
  if (!count) throw new Error(`${size}: not enough designs for ${PER_LEVEL} of each star level.`);
  const packs = Array.from({ length: count }, () => []);
  const left = [];
  for (const s of levels) {
    const all = byLevel.get(s);
    const take = count * PER_LEVEL;
    // Evenly spread over the book when there are more than needed.
    const picked = new Set(Array.from({ length: take }, (_, i) => Math.floor((i * all.length) / take)));
    let k = 0;
    all.forEach((d, i) => {
      if (picked.has(i)) packs[k++ % count].push(d);
      else left.push(d);
    });
  }
  for (const f of readdirSync(path.join(root, 'packs'))) {
    if (f.startsWith(`book-${size}-`) && f.endsWith('.json')) unlinkSync(path.join(root, 'packs', f));
  }
  packs.forEach((designs, i) => {
    designs.sort((a, b) => a.stars - b.stars || a.n - b.n);
    const label = size.replace('x', '×');
    const raw = { id: `book-${size}-${i + 1}`, name: `${label} · Pack ${i + 1}`, rows: book.rows, cols: book.cols, designs };
    const pack = normalizePack(raw, { builtIn: true });
    writeFileSync(path.join(root, 'packs', `book-${size}-${i + 1}.json`), `${packToCode(pack)}\n`);
    console.log(`packs/book-${size}-${i + 1}.json: ${designs.length} designs (book ${designs.map((d) => d.n).join(', ')})`);
  });
  const unused = levels.map((s) => `${left.filter((d) => d.stars === s).length}×${s}★`).join(', ');
  console.log(`${size}: ${count} packs of ${PER_LEVEL} per level; not used: ${unused}${left.length ? ` (book ${left.map((d) => d.n).join(', ')})` : ''}`);
}

const sizes = process.argv.slice(2);
for (const size of sizes.length ? sizes : readdirSync(path.join(root, 'book')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))) makePacks(size);
