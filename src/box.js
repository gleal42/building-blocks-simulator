// The game box: a base and a full-depth lid (two-piece, telescoping), sized from what goes
// inside: the tray with its pieces in it, the deck of cards and the rules booklet.
//
// Sizes in millimetres. The 4×4 and 4×8 trays are measured; the other sizes are worked out
// from them (24 mm squares and an 8 mm rim) and marked as estimates.
//
// The flat shapes to cut (dielines) are drawn with the same items as the book and the cards:
// solid red lines are cuts, dashed blue lines are folds.

import { CARD } from './cards.js';
import { defaultArt, drawItemsPdf, trayItems } from './bookpages.js';
import { MM, PdfDocument } from './pdf.js';

export const TRAYS = {
  '4x4': { w: 112, d: 112 },
  '4x8': { w: 205, d: 112 },
};
export const TRAY_HEIGHT = 15; // the tray alone
export const LOADED_HEIGHT = 25; // the tray with its pieces in it (the pieces stand 10 mm above the rim)
export const CARD_THICKNESS = 0.32; // one printed card (guess for 330 g card; measure a proof deck)
export const BOOKLET = { w: 100, d: 100, h: 2 }; // the rules booklet (guess)
const GAP = 3; // between the tray and the deck
const CLEAR = 2; // room to lift things out, on each of length, width and height
const BLEED = 3;

export const MATERIALS = {
  carton: { name: 'Folding carton, 0.5 mm', t: 0.5 },
  board: { name: 'Rigid board, 1.5 mm', t: 1.5 },
};

export const LAYOUTS = {
  beside: 'Cards beside the tray',
  top: 'Cards on top of the pieces',
};

/** Outer size of a tray: { w (along the columns), d, h, measured }. */
export function traySize(rows, cols) {
  const known = TRAYS[`${rows}x${cols}`];
  if (known) return { ...known, h: LOADED_HEIGHT, measured: true };
  return { w: cols * 24 + 16, d: rows * 24 + 16, h: LOADED_HEIGHT, measured: false };
}

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Everything about the box: the contents and where they sit, the space inside, the base and
 * the lid, and the size of each flat shape to cut.
 */
export function boxPlan({ rows, cols, cards = 24, layout = 'beside', material = 'carton', booklet = true }) {
  const tray = traySize(rows, cols);
  const card = CARD[cols > rows ? 'rect' : 'square'];
  const deck = { w: card.w, d: card.h, h: r1(Math.max(1, cards) * CARD_THICKNESS) };
  const book = booklet ? { ...BOOKLET, w: Math.min(BOOKLET.w, tray.w - 4), d: Math.min(BOOKLET.d, tray.d - 4) } : null;
  const t = (MATERIALS[material] ?? MATERIALS.carton).t;
  let inner;
  let places;
  if (layout === 'top') {
    inner = { l: tray.w + CLEAR, w: tray.d + CLEAR, h: r1(tray.h + deck.h + (book?.h ?? 0) + CLEAR) };
    places = {
      tray: { x: CLEAR / 2, y: CLEAR / 2, z: 0 },
      deck: { x: CLEAR / 2 + (tray.w - deck.w) / 2, y: CLEAR / 2 + (tray.d - deck.d) / 2, z: tray.h },
      booklet: book ? { x: CLEAR / 2 + (tray.w - book.w) / 2, y: CLEAR / 2 + (tray.d - book.d) / 2, z: tray.h + deck.h } : null,
    };
  } else {
    inner = {
      l: tray.w + GAP + deck.w + CLEAR,
      w: Math.max(tray.d, deck.d) + CLEAR,
      h: r1(Math.max(tray.h + (book?.h ?? 0), deck.h) + CLEAR),
    };
    places = {
      tray: { x: CLEAR / 2, y: CLEAR / 2, z: 0 },
      deck: { x: CLEAR / 2 + tray.w + GAP, y: CLEAR / 2 + (tray.d - deck.d) / 2, z: 0 },
      booklet: book ? { x: CLEAR / 2 + (tray.w - book.w) / 2, y: CLEAR / 2 + (tray.d - book.d) / 2, z: tray.h } : null,
    };
  }
  // Base: walls of the board thickness around the inside. Lid: 1 mm of play around the base,
  // as deep as the base, so it covers it all.
  const base = { l: r1(inner.l + 2 * t), w: r1(inner.w + 2 * t), h: r1(inner.h + t) };
  const lidInner = { l: r1(base.l + 1), w: r1(base.w + 1), h: base.h };
  const lid = { l: r1(lidInner.l + 2 * t), w: r1(lidInner.w + 2 * t), h: r1(lidInner.h + t) };
  return {
    rows,
    cols,
    cards,
    layout,
    material,
    t,
    tray,
    deck,
    booklet: book,
    inner,
    places,
    base,
    lid,
    // A flat shape is its floor (or top) with a wall folded up on each side.
    flats: {
      base: { panel: { l: inner.l, w: inner.w }, wall: inner.h },
      lid: { panel: { l: lidInner.l, w: lidInner.w }, wall: lidInner.h },
    },
  };
}

// ---- Drawing --------------------------------------------------------------------------------

const CUT = '#d0021b';
const FOLD = '#1f6feb';
const INK = '#1d1c19';
const MUTED = '#6f6a5c';
const ART = '#efe7d6';

const txt = (x, y, text, size, opts = {}) => ({ t: 'text', x, y, text, size, fill: opts.fill ?? INK, bold: !!opts.bold, anchor: opts.anchor ?? 'middle' });
const cut = (x1, y1, x2, y2) => ({ t: 'line', x1, y1, x2, y2, stroke: CUT, sw: 0.35 });
const fold = (x1, y1, x2, y2) => ({ t: 'line', x1, y1, x2, y2, stroke: FOLD, sw: 0.35, dash: [3, 2] });

/**
 * The flat shape of the base or the lid: { w, h, items } in millimetres, with a margin round it.
 * opts: { title, subtitle, cover: { src, width, height } | null, maker: [lines] }
 */
export function dieline(kind, plan, opts = {}) {
  const { panel, wall: h } = plan.flats[kind];
  const a = panel.l;
  const b = panel.w;
  const m = 15; // margin around the shape
  const ox = m;
  const oy = m;
  const W = a + 2 * h;
  const H = b + 2 * h;
  const fw = Math.max(4, h - 2); // glue flap width
  const taper = Math.min(4, fw / 3);
  const items = [];
  const X = (x) => ox + x;
  const Y = (y) => oy + y;

  // Printed areas first (under the lines), with bleed past the cut edges.
  if (kind === 'lid') {
    items.push({ t: 'rect', x: X(h - BLEED), y: Y(-BLEED), w: a + 2 * BLEED, h: H + 2 * BLEED, fill: ART });
    items.push({ t: 'rect', x: X(-BLEED), y: Y(h - BLEED), w: W + 2 * BLEED, h: b + 2 * BLEED, fill: ART });
    if (opts.cover?.src) {
      items.push({ t: 'image', src: opts.cover.src, width: opts.cover.width, height: opts.cover.height, x: X(h - BLEED), y: Y(h - BLEED), w: a + 2 * BLEED, h: b + 2 * BLEED });
    } else {
      items.push(txt(X(h + a / 2), Y(h + b / 2 - 6), 'Cover art goes here', Math.min(9, a / 18), { bold: true, fill: MUTED }));
      items.push(txt(X(h + a / 2), Y(h + b / 2 + 4), `${a} × ${b} mm, plus ${BLEED} mm bleed on every side`, Math.min(5, a / 34), { fill: MUTED }));
    }
    // The front wall (the bottom one on the sheet): the name of the game, upright when the lid is on.
    const front = Y(h + b + h / 2);
    items.push(txt(X(h + a / 2), front + Math.min(4, h / 6), opts.title ?? 'Building Blocks', Math.min(8, h / 2.6), { bold: true }));
    if (opts.subtitle) items.push(txt(X(h + a / 2), front + Math.min(4, h / 6) + Math.min(6, h / 3.6), opts.subtitle, Math.min(4.5, h / 5.5), { fill: MUTED }));
  } else {
    // The underside of the base: what is inside and who made it.
    const lines = [opts.title ?? 'Building Blocks', ...(opts.contents ?? []), '', ...(opts.maker ?? [])];
    const size = Math.min(4.2, b / 22);
    lines.forEach((line, i) => {
      if (line) items.push(txt(X(h + a / 2), Y(h + 10 + i * size * 1.5), line, i === 0 ? size * 1.4 : size, { bold: i === 0, fill: i === 0 ? INK : MUTED }));
    });
    items.push(txt(X(h + a / 2), Y(h + b - 6), 'This side is the outside of the bottom of the box', Math.min(3.4, b / 30), { fill: MUTED }));
  }

  // Folds: the edges of the floor (or top), and the hinges of the glue flaps.
  items.push(fold(X(h), Y(h), X(h + a), Y(h)), fold(X(h), Y(h + b), X(h + a), Y(h + b)));
  items.push(fold(X(h), Y(h), X(h), Y(h + b)), fold(X(h + a), Y(h), X(h + a), Y(h + b)));
  items.push(fold(X(h), Y(0), X(h), Y(h)), fold(X(h + a), Y(0), X(h + a), Y(h)));
  items.push(fold(X(h), Y(h + b), X(h), Y(H)), fold(X(h + a), Y(h + b), X(h + a), Y(H)));

  // Cuts. The long walls (top and bottom on the sheet) carry a glue flap at each end, in the
  // corners of the cross; the short walls (left and right) fold up between them.
  items.push(cut(X(h), Y(0), X(h + a), Y(0)), cut(X(h), Y(H), X(h + a), Y(H)));
  // Each flap: hinge on the wall's end, tapered at the outer edge.
  items.push(cut(X(h), Y(0), X(h - fw), Y(taper)), cut(X(h - fw), Y(taper), X(h - fw), Y(h)));
  items.push(cut(X(h + a), Y(0), X(h + a + fw), Y(taper)), cut(X(h + a + fw), Y(taper), X(h + a + fw), Y(h)));
  items.push(cut(X(h), Y(H), X(h - fw), Y(H - taper)), cut(X(h - fw), Y(H - taper), X(h - fw), Y(h + b)));
  items.push(cut(X(h + a), Y(H), X(h + a + fw), Y(H - taper)), cut(X(h + a + fw), Y(H - taper), X(h + a + fw), Y(h + b)));
  // The short walls: their outer edges, and their ends (which also free the flaps).
  items.push(cut(X(0), Y(h), X(0), Y(h + b)), cut(X(W), Y(h), X(W), Y(h + b)));
  items.push(cut(X(0), Y(h), X(h), Y(h)), cut(X(0), Y(h + b), X(h), Y(h + b)));
  items.push(cut(X(h + a), Y(h), X(W), Y(h)), cut(X(h + a), Y(h + b), X(W), Y(h + b)));

  // Labels outside the shape.
  const name = kind === 'lid' ? 'Lid' : 'Base';
  const outer = plan[kind];
  items.push(txt(X(0), Y(-6), `${name}: ${outer.l} × ${outer.w} × ${outer.h} mm outside`, 4, { bold: true, anchor: 'start' }));
  items.push(txt(X(W), Y(-6), `${MATERIALS[plan.material].name} · glue the flaps inside the short walls`, 3.2, { fill: MUTED, anchor: 'end' }));
  items.push(txt(X(0), Y(H + 9), 'Red: cut · Blue dashed: fold · Shaded: print area (with bleed)', 3.2, { fill: MUTED, anchor: 'start' }));
  return { w: W + 2 * m, h: H + 2 * m + 4, items };
}

/** What goes where: a view from above and a cut through the side, with the sizes. */
export function contentsDrawing(plan) {
  const { inner, tray, deck, booklet, places, rows, cols } = plan;
  const m = 12;
  const items = [];
  const top = { x: m, y: m + 8 };
  items.push(txt(top.x, top.y - 4, `Inside the box, from above: ${inner.l} × ${inner.w} mm`, 4.2, { bold: true, anchor: 'start' }));
  items.push({ t: 'rect', x: top.x, y: top.y, w: inner.l, h: inner.w, fill: '#f6f1e6', stroke: INK, sw: 0.5 });
  // The tray with a picture in it.
  const tx = top.x + places.tray.x;
  const ty = top.y + places.tray.y;
  items.push({ t: 'rect', x: tx, y: ty, w: tray.w, h: tray.d, r: 3, fill: '#e8cf93', stroke: '#b89d66', sw: 0.4 });
  const cell = Math.min((tray.w - 16) / cols, (tray.d - 16) / rows);
  items.push(...trayItems(defaultArt(rows, cols), rows, cols, tx + (tray.w - cell * cols) / 2, ty + (tray.d - cell * rows) / 2, cell));
  items.push(txt(tx + tray.w / 2, ty + tray.d + 5, `Tray with pieces ${tray.w} × ${tray.d} mm${tray.measured ? '' : ' (estimate)'}`, 3.2, { fill: MUTED }));
  const dx = top.x + places.deck.x;
  const dy = top.y + places.deck.y;
  items.push({ t: 'rect', x: dx, y: dy, w: deck.w, h: deck.d, r: 3, fill: '#ecd9ab', stroke: '#b89d66', sw: 0.5, dash: plan.layout === 'top' ? [2, 1.5] : undefined });
  items.push(txt(dx + deck.w / 2, dy + deck.d / 2, `${plan.cards} cards`, 3.6, { bold: true }));
  items.push(txt(dx + deck.w / 2, dy + deck.d / 2 + 5, `${deck.w} × ${deck.d} × ${deck.h} mm`, 3, { fill: MUTED }));
  if (booklet) {
    const bx = top.x + places.booklet.x;
    const by = top.y + places.booklet.y;
    items.push({ t: 'rect', x: bx, y: by, w: booklet.w, h: booklet.d, stroke: MUTED, sw: 0.4, dash: [1.5, 1.5] });
    items.push(txt(bx + booklet.w / 2, by + 6, `Rules booklet on top (${booklet.w} × ${booklet.d} mm)`, 3, { fill: MUTED }));
  }

  // A cut through the side, heights to scale.
  const side = { x: m, y: top.y + inner.w + 28 };
  items.push(txt(side.x, side.y - 4, `From the side: ${inner.h} mm high inside`, 4.2, { bold: true, anchor: 'start' }));
  items.push({ t: 'rect', x: side.x, y: side.y, w: inner.l, h: inner.h, fill: '#f6f1e6', stroke: INK, sw: 0.5 });
  const floor = side.y + inner.h;
  items.push({ t: 'rect', x: side.x + places.tray.x, y: floor - TRAY_HEIGHT, w: tray.w, h: TRAY_HEIGHT, fill: '#e8cf93', stroke: '#b89d66', sw: 0.4 });
  items.push({ t: 'rect', x: side.x + places.tray.x + 8, y: floor - tray.h, w: tray.w - 16, h: tray.h - TRAY_HEIGHT + 2, fill: '#1d1c19' });
  items.push({ t: 'rect', x: side.x + places.deck.x, y: floor - places.deck.z - deck.h, w: deck.w, h: deck.h, fill: '#ecd9ab', stroke: '#b89d66', sw: 0.4 });
  if (booklet) items.push({ t: 'rect', x: side.x + places.booklet.x, y: floor - places.booklet.z - booklet.h, w: booklet.w, h: booklet.h, fill: '#ffffff', stroke: MUTED, sw: 0.3 });
  items.push(txt(side.x + inner.l + 3, floor - TRAY_HEIGHT / 2 + 1, `tray ${TRAY_HEIGHT}`, 3, { fill: MUTED, anchor: 'start' }));
  items.push(txt(side.x + inner.l + 3, floor - tray.h + 1, `pieces ${tray.h}`, 3, { fill: MUTED, anchor: 'start' }));
  const w = Math.max(inner.l + 2 * m + 22, 120);
  const h = side.y + inner.h + m;
  return { w, h, items };
}

/** SVG for a drawing in millimetres (fits the width it is given). */
export function drawingSvg(drawing, itemsSvg, label) {
  return `<svg viewBox="0 0 ${drawing.w.toFixed(1)} ${drawing.h.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" class="box-svg" role="img" aria-label="${label}"><rect width="${drawing.w.toFixed(1)}" height="${drawing.h.toFixed(1)}" fill="#ffffff"/>${itemsSvg(drawing.items)}</svg>`;
}

/** The box as a PDF at full size: the lid, the base, then what goes inside. */
export function boxPdf(plan, opts = {}) {
  const doc = new PdfDocument();
  const images = new Map();
  for (const drawing of [dieline('lid', plan, opts), dieline('base', plan, opts), contentsDrawing(plan)]) {
    const page = doc.page(drawing.w * MM, drawing.h * MM);
    page.setFrame(0, 0, 1000 * MM, 1000); // 1 design unit = 1 mm
    drawItemsPdf(page, drawing.items, images);
  }
  return doc.toBytes();
}
