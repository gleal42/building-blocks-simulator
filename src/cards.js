// The cards in a box: one card per design of a pack, for players to draw a card and build its
// picture. A card has the shape of the tray (square, or 2:1) at card size. The fronts are
// printed on portrait sheets with cut marks; the next page of the PDF holds the card backs,
// mirrored so that they line up when printed on the other side of the sheet.
//
// Also the unlock card: one in each box, with the code that unlocks the pack in the app.
//
// A deck: { rows, cols, title, subtitle, cards: [{ looks, stars }], paper }.

import { defaultArt, drawItemsPdf, fitTray, itemsSvg, starItems, text, trayItems } from './drawing.js';
import { wrapText } from './fonts.js';
import { MM, PdfDocument } from './pdf.js';
import { unlockLink } from './links.js';
import { qrItems } from './qr.js';

/** Card sizes in millimetres. */
export const CARD = {
  square: { w: 63, h: 63 },
  rect: { w: 88, h: 44 },
};

/** Sheet sizes (millimetres). */
export const PAPER = {
  a4: { name: 'A4', width: 210, height: 297 },
  letter: { name: 'US Letter', width: 215.9, height: 279.4 },
};

// Space left free around the cards on each side of the sheet, for the printer and the marks.
const SHEET_MARGIN = 10;

const MUTED = '#6f6a5c';
const FRAME = '#d8d0bf';
const BACK = '#ecd9ab';
const BACK_EDGE = '#b89d66';
const MARK = '#8a8473';

/** The deck of a pack: its designs as cards. */
export function packDeck(pack, { title = 'Notan', paper = 'a4' } = {}) {
  return { rows: pack.rows, cols: pack.cols, title, subtitle: pack.name, cards: pack.designs.map((d) => ({ looks: d.looks, stars: d.stars })), paper };
}

export const cardShape = (deck) => (deck.cols > deck.rows ? 'rect' : 'square');

/** Width of a card's drawing in design units (its height is always 1000). */
export const cardWidth = (deck) => (cardShape(deck) === 'rect' ? 2000 : 1000);

/**
 * How the cards sit on a portrait sheet: { sheetW, sheetH, w, h, cols, rows, perSheet, left,
 * top }, all in millimetres. The cards touch, so one straight cut separates two of them.
 */
export function cardSheet(deck) {
  const paper = PAPER[deck.paper] ?? PAPER.a4;
  const sheetW = Math.min(paper.width, paper.height);
  const sheetH = Math.max(paper.width, paper.height);
  const { w, h } = CARD[cardShape(deck)];
  const cols = Math.max(1, Math.floor((sheetW - 2 * SHEET_MARGIN) / w));
  const rows = Math.max(1, Math.floor((sheetH - 2 * SHEET_MARGIN) / h));
  // Centred across; a little above the middle, so the line under the cards has room.
  return { sheetW, sheetH, w, h, cols, rows, perSheet: cols * rows, left: (sheetW - cols * w) / 2, top: (sheetH - rows * h) * 0.42 };
}

/**
 * Where card k of a sheet goes (top-left corner, millimetres). Backs are mirrored left to
 * right: printed on the other side with a flip on the long edge, each back lands behind its
 * front.
 */
export function cardSlot(layout, k, back = false) {
  const row = Math.floor(k / layout.cols);
  const col = k % layout.cols;
  const c = back ? layout.cols - 1 - col : col;
  return { x: layout.left + c * layout.w, y: layout.top + row * layout.h };
}

/** Front of card `index`: its number, its stars and its picture. */
export function cardFront(deck, index) {
  const card = deck.cards[index];
  const W = cardWidth(deck);
  const items = [{ t: 'rect', x: 34, y: 34, w: W - 68, h: 932, r: 60, fill: '#ffffff', stroke: FRAME, sw: 6 }];
  items.push(text(96, 168, String(index + 1), 112, { bold: true }));
  items.push(...starItems(card.stars, W - 96, 126, 40, 'end'));
  const fit = fitTray(deck.rows, deck.cols, { x: 96, y: 214, w: W - 192, h: 716 });
  items.push(...trayItems(card.looks, deck.rows, deck.cols, fit.x, fit.y, fit.cell));
  return items;
}

/** The back of every card: a pattern of pieces, the game's name and the pack's. */
export function cardBack(deck) {
  const { rows, cols } = deck;
  const W = cardWidth(deck);
  const items = [
    { t: 'rect', x: 0, y: 0, w: W, h: 1000, fill: BACK },
    { t: 'rect', x: 50, y: 50, w: W - 100, h: 900, r: 56, stroke: BACK_EDGE, sw: 10 },
  ];
  const title = wrapText(deck.title || 'Notan', 76, W - 220, true).slice(0, 2);
  const titleTop = 1000 - 170 - (title.length - 1) * 84;
  const fit = fitTray(rows, cols, { x: 140, y: 110, w: W - 280, h: titleTop - 190 });
  items.push(...trayItems(defaultArt(rows, cols), rows, cols, fit.x, fit.y, fit.cell));
  title.forEach((line, i) => items.push(text(W / 2, titleTop + i * 84, line, 76, { bold: true, anchor: 'middle' })));
  items.push(text(W / 2, titleTop + (title.length - 1) * 84 + 72, deck.subtitle || `${rows}×${cols} tray`, 46, { fill: MUTED, anchor: 'middle' }));
  return items;
}

/** SVG of a card: the front of card `index`, or the back when index is null. */
export function cardSvg(deck, index) {
  const W = cardWidth(deck);
  const back = index === null;
  const items = back ? cardBack(deck) : cardFront(deck, index);
  const label = back ? 'Back of the cards' : `Card ${index + 1}`;
  return `<svg viewBox="0 0 ${W} 1000" xmlns="http://www.w3.org/2000/svg" class="card-svg" role="img" aria-label="${label}"><rect width="${W}" height="1000" fill="#ffffff"/>${itemsSvg(items)}</svg>`;
}

function drawCard(canvas, items, xMm, yMm, layout, width, images) {
  canvas.setFrame(xMm * MM, yMm * MM, layout.h * MM, 1000);
  canvas.save();
  canvas.clipRect(0, 0, width, 1000);
  drawItemsPdf(canvas, items, images);
  canvas.restore();
}

/** Cut marks along every line between cards, outside the block of cards. */
export function cutMarks(canvas, layout, count) {
  canvas.setFrame(0, 0, 1000, 1000); // design units = points
  const style = { stroke: MARK, sw: 0.5 };
  const gap = 2 * MM;
  const len = 5 * MM;
  const usedRows = Math.ceil(count / layout.cols);
  const x0 = layout.left * MM;
  const y0 = layout.top * MM;
  const x1 = x0 + layout.cols * layout.w * MM;
  const y1 = y0 + usedRows * layout.h * MM;
  for (let i = 0; i <= layout.cols; i += 1) {
    const x = x0 + i * layout.w * MM;
    canvas.line(x, y0 - gap, x, y0 - gap - len, style);
    canvas.line(x, y1 + gap, x, y1 + gap + len, style);
  }
  for (let j = 0; j <= usedRows; j += 1) {
    const y = y0 + j * layout.h * MM;
    canvas.line(x0 - gap, y, x0 - gap - len, y, style);
    canvas.line(x1 + gap, y, x1 + gap + len, y, style);
  }
  return y1;
}

/**
 * The deck as a PDF: for each sheet, a page of fronts and then a page of backs. Printed on
 * both sides (flip on the long edge), every card gets its back; cut along the marks.
 */
export function cardsPdf(deck) {
  const layout = cardSheet(deck);
  const doc = new PdfDocument();
  const images = new Map();
  const W = cardWidth(deck);
  const total = deck.cards.length;
  const sheets = Math.max(1, Math.ceil(total / layout.perSheet));
  const back = cardBack(deck);
  for (let s = 0; s < sheets; s += 1) {
    const first = s * layout.perSheet;
    const count = Math.max(0, Math.min(layout.perSheet, total - first));
    for (const side of ['front', 'back']) {
      const canvas = doc.page(layout.sheetW * MM, layout.sheetH * MM);
      for (let k = 0; k < count; k += 1) {
        const { x, y } = cardSlot(layout, k, side === 'back');
        drawCard(canvas, side === 'front' ? cardFront(deck, first + k) : back, x, y, layout, W, images);
      }
      const bottom = cutMarks(canvas, layout, Math.max(1, count));
      const cards = count > 1 ? `cards ${first + 1} to ${first + count}` : count === 1 ? `card ${first + 1}` : 'no cards yet';
      const label = side === 'front'
        ? `Sheet ${s + 1} of ${sheets}, fronts: ${cards}. Print the next page on the back.`
        : `Sheet ${s + 1} of ${sheets}, backs (other side of the same sheet, flip on the long edge).`;
      canvas.text((layout.sheetW * MM) / 2, bottom + 12 * MM, label, { size: 8, fill: MARK, anchor: 'middle' });
    }
  }
  return doc.toBytes();
}

// ---- Unlock cards: one goes in each box ----------------------------------------------------

/** The card with a box's unlock code: a QR code to scan, and the code to type. */
export function unlockCardItems(code, base, packName, { sample = false } = {}) {
  const items = [
    { t: 'rect', x: 0, y: 0, w: 1000, h: 1000, fill: '#ffffff' },
    { t: 'rect', x: 34, y: 34, w: 932, h: 932, r: 60, fill: '#ffffff', stroke: BACK_EDGE, sw: 8 },
    text(500, 120, 'Your digital pack', 54, { bold: true, anchor: 'middle' }),
  ];
  const name = wrapText(packName || 'Notan', 44, 800, false).slice(0, 2);
  name.forEach((line, i) => items.push(text(500, 180 + i * 52, line, 44, { fill: MUTED, anchor: 'middle' })));
  const side = 460;
  items.push(...qrItems(unlockLink(base, code), 270, 250, side));
  items.push(text(500, 800, code, 76, { bold: true, anchor: 'middle' }));
  items.push(text(500, 870, 'Scan it with your phone camera,', 36, { fill: MUTED, anchor: 'middle' }));
  items.push(text(500, 914, 'or type the code in the app.', 36, { fill: MUTED, anchor: 'middle' }));
  if (sample) items.push(text(500, 236, 'SAMPLE', 30, { bold: true, fill: '#b3261e', anchor: 'middle' }));
  return items;
}

export function unlockCardSvg(code, base, packName, opts = {}) {
  return `<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" class="card-svg" role="img" aria-label="Unlock card ${code}">${itemsSvg(unlockCardItems(code, base, packName, opts))}</svg>`;
}

/** Unlock cards, card size, on sheets with cut marks (one side only). */
export function unlockCardsPdf(codes, base, packName, { paper = 'a4', sample = false } = {}) {
  const layout = cardSheet({ rows: 1, cols: 1, paper });
  const doc = new PdfDocument();
  const images = new Map();
  const sheets = Math.max(1, Math.ceil(codes.length / layout.perSheet));
  for (let s = 0; s < sheets; s += 1) {
    const canvas = doc.page(layout.sheetW * MM, layout.sheetH * MM);
    const first = s * layout.perSheet;
    const count = Math.min(layout.perSheet, codes.length - first);
    for (let k = 0; k < count; k += 1) {
      const { x, y } = cardSlot(layout, k);
      drawCard(canvas, unlockCardItems(codes[first + k], base, packName, { sample }), x, y, layout, 1000, images);
    }
    const bottom = cutMarks(canvas, layout, Math.max(1, count));
    canvas.text((layout.sheetW * MM) / 2, bottom + 12 * MM, `Unlock cards for ${packName}: sheet ${s + 1} of ${sheets}. One card goes in each box.`, { size: 8, fill: MARK, anchor: 'middle' });
  }
  return doc.toBytes();
}
