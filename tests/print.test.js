import test from 'node:test';
import assert from 'node:assert/strict';

import { boxPdf, boxPlan, dieline } from '../src/box.js';
import { packDeck, unlockCardItems, unlockCardsPdf } from '../src/cards.js';
import { drawItemsPdf, drawingSvg, itemsSvg, text } from '../src/drawing.js';
import { textWidth, wrapText, winAnsiCode } from '../src/fonts.js';
import { LEAFLET_PAGE, leafletPageSvg, leafletPages, leafletPdf } from '../src/leaflet.js';
import { PdfDocument } from '../src/pdf.js';
import { newPack } from '../src/packs.js';

const pdfText = (bytes) => Buffer.from(bytes).toString('latin1');
const pageCount = (bytes) => Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdfText(bytes))[1]);

function wellFormed(bytes) {
  const t = pdfText(bytes);
  assert.ok(t.startsWith('%PDF-1.4') && t.trimEnd().endsWith('%%EOF'));
  const xrefAt = Number(/startxref\n(\d+)/.exec(t)[1]);
  const xref = t.slice(xrefAt).split('\n');
  const objects = Number(xref[1].split(' ')[1]);
  for (let n = 1; n < objects; n += 1) assert.ok(t.startsWith(`${n} 0 obj`, Number(xref[2 + n].slice(0, 10))), `object ${n}`);
}

const finite = (items) => items.every((it) => Object.entries(it).every(([k, v]) => (typeof v === 'number' ? Number.isFinite(v) : k !== 'pts' || v.every((p) => p.every(Number.isFinite)))));

test('the rules leaflet: four pages that lay out, two leaflets per sheet, outside then inside', () => {
  for (const [rows, cols] of [[4, 4], [4, 8]]) {
    const info = { title: 'Notan', subtitle: 'Animals', rows, cols, cards: 24, maker: ['Gonçalo Leal', 'Vila Nova de Gaia, Portugal', 'hello@example.com'] };
    const pages = leafletPages(info);
    assert.equal(pages.length, 4);
    pages.forEach((items, i) => assert.ok(finite(items), `page ${i + 1}`));
    assert.ok(pages[0].some((it) => it.t === 'text' && it.text === 'Notan'));
    assert.ok(pages[3].some((it) => it.t === 'text' && it.text === 'Gonçalo Leal'));
    // Nothing runs off a page.
    for (const items of pages) {
      for (const it of items.filter((x) => x.t === 'text')) {
        const w = textWidth(it.text, it.size, it.bold);
        const left = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
        assert.ok(left >= 40 && left + w <= 960 && it.y <= 975, `"${it.text}" fits`);
      }
    }
    assert.match(leafletPageSvg(info, 2), /viewBox="0 0 1000 1000"/);
    const pdf = leafletPdf(info);
    wellFormed(pdf);
    assert.equal(pageCount(pdf), 2, 'one sheet: outside and inside');
    assert.match(pdfText(pdf), /\/MediaBox \[0 0 595\.276 841\.89\]/, 'A4 portrait');
  }
  assert.ok(LEAFLET_PAGE <= 100, 'fits on the tray in the box');
});

test('rotated text: the wall labels of the box turn, in the preview and in the PDF', () => {
  const svg = itemsSvg([text(10, 20, 'Notan', 8, { rot: 90 })]);
  assert.match(svg, /transform="rotate\(90 10 20\)"/);
  const doc = new PdfDocument();
  const page = doc.page(200, 200);
  drawItemsPdf(page, [text(10, 20, 'Notan', 8, { rot: 180, anchor: 'middle' })], new Map());
  assert.ok(page.ops.some((op) => / Tm \(Notan\) Tj/.test(op) && op.includes('-1 0 0 -1')));
});

test('the box lid has the name on all four walls, upright once folded; the base says what is inside', () => {
  const plan = boxPlan({ rows: 4, cols: 4, cards: 24 });
  const opts = { title: 'Notan', subtitle: 'Animals', contents: ['Inside: 1 tray, 16 pieces, 24 cards.'], digital: 'Scan the unlock card.', maker: ['Gonçalo Leal'] };
  const lid = dieline('lid', plan, opts);
  const names = lid.items.filter((it) => it.t === 'text' && it.text === 'Notan');
  assert.deepEqual(names.map((it) => it.rot).sort((a, b) => a - b), [-90, 0, 90, 180]);
  assert.ok(lid.items.some((it) => it.t === 'text' && it.text === 'Cover art goes here'), 'cover art is the only part missing');
  const withArt = dieline('lid', plan, { ...opts, cover: { src: 'data:image/jpeg;base64,AAAA', width: 10, height: 6 } });
  assert.ok(withArt.items.some((it) => it.t === 'image'));
  const base = dieline('base', plan, opts);
  for (const line of ['Notan', 'Animals', 'Gonçalo Leal']) assert.ok(base.items.some((it) => it.t === 'text' && it.text === line), line);
  assert.match(drawingSvg(lid, 'Lid'), /<svg viewBox="0 0 \d/);
  wellFormed(boxPdf(plan, opts));
});

test('unlock cards: a sample is marked as such; one card per code in the PDF', () => {
  assert.ok(unlockCardItems('K7QM-3XTP-ZR8D', 'https://x.org/', 'Animals', { sample: true }).some((it) => it.text === 'SAMPLE'));
  assert.ok(!unlockCardItems('K7QM-3XTP-ZR8D', 'https://x.org/', 'Animals').some((it) => it.text === 'SAMPLE'));
  const codes = Array.from({ length: 13 }, (_, i) => `K7QM-3XTP-ZR${'23456789ABCDE'[i]}D`);
  const pdf = unlockCardsPdf(codes, 'https://x.org/', 'Animals');
  wellFormed(pdf);
  assert.equal(pageCount(pdf), 2, '12 to a sheet');
});

test('a deck from a pack: its designs become cards, under the game name', () => {
  const pack = newPack({ name: 'Animals', rows: 4, cols: 8 });
  pack.designs.push({ looks: new Array(32).fill(1), stars: 2 });
  const deck = packDeck(pack, { title: 'Notan', paper: 'letter' });
  assert.deepEqual([deck.rows, deck.cols, deck.title, deck.subtitle, deck.paper, deck.cards.length], [4, 8, 'Notan', 'Animals', 'letter', 1]);
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
