// Page layouts of a challenge book, drawn as simple shape lists that become SVG (preview)
// or PDF (printing). Every page is 1000 x 1000 design units; a 2:1 challenge is drawn once
// across a 2000 x 1000 spread and each page shows its half.

import { DIFFICULTY, PAPER, bookPages, bookTray, imposition } from './book.js';
import { HALF_OUTLINE, LOOK } from './geometry.js';
import { textWidth, wrapText } from './fonts.js';
import { MM, PdfDocument, base64ToBytes } from './pdf.js';
import { pieceIconShapes } from './render3d.js';

const INK = '#1d1c19';
const MUTED = '#6f6a5c';
const FAINT = '#c9c2b1';
const TRAY = '#ecd9ab';
const TRAY_EDGE = '#b89d66';
const WELL = '#d3b77f';
const WHITE = '#ffffff';
const WHITE_EDGE = '#b7b0a0';
const BLACK = '#1d1f22';
const STAR_EDGE = ['', '#1f7a40', '#9c7500', '#9e2a24'];

const LOOK_PARTS = {
  [LOOK.SLASH_WB]: [[0, WHITE], [2, BLACK]],
  [LOOK.SLASH_BW]: [[0, BLACK], [2, WHITE]],
  [LOOK.BACK_WB]: [[1, WHITE], [3, BLACK]],
  [LOOK.BACK_BW]: [[1, BLACK], [3, WHITE]],
};

// ---- Shape helpers -------------------------------------------------------------------------

function insetConvex(points, d) {
  const n = points.length;
  const cx = points.reduce((a, p) => a + p[0], 0) / n;
  const cy = points.reduce((a, p) => a + p[1], 0) / n;
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: a[0] + nx * d, y: a[1] + ny * d, dx, dy };
  });
  return lines.map((l2, i) => {
    const l1 = lines[(i - 1 + n) % n];
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(det) < 1e-9) return [l2.x, l2.y];
    const t = ((l2.x - l1.x) * l2.dy - (l2.y - l1.y) * l2.dx) / det;
    return [l1.x + l1.dx * t, l1.y + l1.dy * t];
  });
}

function starPoints(cx, cy, outer) {
  const inner = outer * 0.44;
  const pts = [];
  for (let k = 0; k < 10; k += 1) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? inner : outer;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** Three star slots, the first `level` filled in the difficulty colour. */
export function starItems(level, x, cy, size, anchor = 'start') {
  const gap = size * 2.25;
  const width = gap * 2 + size * 2;
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
  const items = [];
  for (let k = 0; k < 3; k += 1) {
    const pts = starPoints(left + size + k * gap, cy, size);
    if (k < level) items.push({ t: 'poly', pts, fill: DIFFICULTY[level].color, stroke: STAR_EDGE[level], sw: size * 0.09 });
    else items.push({ t: 'poly', pts, stroke: FAINT, sw: size * 0.09 });
  }
  return items;
}

const text = (x, y, value, size, opts = {}) => ({ t: 'text', x, y, text: value, size, fill: opts.fill ?? INK, bold: !!opts.bold, anchor: opts.anchor ?? 'start' });

/** A tray with a picture: (x, y) is the top-left of the squares, cell the square size. */
export function trayItems(looks, rows, cols, x, y, cell, { empty = false } = {}) {
  const items = [];
  const rim = Math.max(10, cell * 0.22);
  const W = cols * cell;
  const H = rows * cell;
  items.push({ t: 'rect', x: x - rim, y: y - rim, w: W + 2 * rim, h: H + 2 * rim, r: rim * 0.7, fill: TRAY, stroke: TRAY_EDGE, sw: Math.max(1.5, cell * 0.015) });
  items.push({ t: 'rect', x: x - rim * 0.3, y: y - rim * 0.3, w: W + rim * 0.6, h: H + rim * 0.6, r: rim * 0.25, fill: WELL });
  const g = Math.max(1.2, cell * 0.035);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const look = empty ? LOOK.ANY : looks[r * cols + c];
      const cx = x + c * cell;
      const cy = y + r * cell;
      if (look === LOOK.ANY) {
        items.push({ t: 'rect', x: cx + 2 * g, y: cy + 2 * g, w: cell - 4 * g, h: cell - 4 * g, r: g * 2, fill: '#e9d4a5', stroke: TRAY_EDGE, sw: Math.max(1, cell * 0.012), dash: [cell * 0.06, cell * 0.05] });
      } else if (look === LOOK.WHITE || look === LOOK.BLACK) {
        items.push({ t: 'rect', x: cx + g, y: cy + g, w: cell - 2 * g, h: cell - 2 * g, r: g * 1.6, fill: look === LOOK.WHITE ? WHITE : BLACK, stroke: look === LOOK.WHITE ? WHITE_EDGE : null, sw: Math.max(0.8, cell * 0.01) });
      } else {
        for (const [h, fill] of LOOK_PARTS[look]) {
          const pts = insetConvex(HALF_OUTLINE[h].map(([u, v]) => [cx + u * cell, cy + v * cell]), g);
          items.push({ t: 'poly', pts, fill, stroke: fill === WHITE ? WHITE_EDGE : null, sw: Math.max(0.8, cell * 0.01) });
        }
      }
    }
  }
  return items;
}

/** Fit a rows x cols tray (with its rim) into a box; returns { x, y, cell } of the squares. */
export function fitTray(rows, cols, box, centreX = null) {
  const cell = Math.min(box.w / (cols + 0.44), box.h / (rows + 0.44));
  const x = (centreX ?? box.x + box.w / 2) - (cols * cell) / 2;
  const y = box.y + (box.h - rows * cell) / 2;
  return { x, y, cell };
}

function pageNumber(number) {
  if (number % 2 === 0) return [text(70, 955, String(number), 24, { fill: MUTED })];
  return [text(930, 955, String(number), 24, { fill: MUTED, anchor: 'end' })];
}

function paragraph(value, x, y, width, size, opts = {}) {
  const lines = wrapText(value, size, width, opts.bold);
  const lead = size * (opts.lead ?? 1.3);
  return { items: lines.map((line, i) => text(x, y + i * lead, line, size, opts)), height: lines.length * lead };
}

// ---- Default art ----------------------------------------------------------------------------

export function defaultArt(rows, cols) {
  // A pinwheel of splits: decoration only.
  const looks = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const top = r < rows / 2;
      const left = c < cols / 2;
      const ring = Math.min(r, c, rows - 1 - r, cols - 1 - c) % 2 === 0;
      if (top && left) looks.push(ring ? LOOK.SLASH_BW : LOOK.WHITE);
      else if (top) looks.push(ring ? LOOK.BACK_BW : LOOK.BLACK);
      else if (left) looks.push(ring ? LOOK.BACK_WB : LOOK.BLACK);
      else looks.push(ring ? LOOK.SLASH_WB : LOOK.WHITE);
    }
  }
  return looks;
}

// ---- Pages -----------------------------------------------------------------------------

function coverPage(book) {
  const { rows, cols } = bookTray(book);
  if (book.cover.front) return [{ t: 'image', x: 0, y: 0, w: 1000, h: 1000, ...book.cover.front }];
  const items = [];
  const titleLines = wrapText(book.title || 'Block Challenges', 84, 840, true).slice(0, 3);
  titleLines.forEach((line, i) => items.push(text(500, 180 + i * 92, line, 84, { bold: true, anchor: 'middle' })));
  const subY = 180 + (titleLines.length - 1) * 92 + 70;
  const count = book.challenges.length;
  items.push(text(500, subY, `${count} challenge${count === 1 ? '' : 's'} for the ${rows}×${cols} tray`, 32, { fill: MUTED, anchor: 'middle' }));
  const art = book.challenges[0]?.looks ?? defaultArt(rows, cols);
  const top = subY + 50;
  const fit = fitTray(rows, cols, { x: 110, y: top, w: 780, h: 880 - top });
  items.push(...trayItems(art, rows, cols, fit.x, fit.y, fit.cell));
  [1, 2, 3].forEach((level, i) => items.push(...starItems(level, 500 + (i - 1) * 240, 935, 15, 'middle')));
  return items;
}

function backPage(book) {
  if (book.cover.back) return [{ t: 'image', x: 0, y: 0, w: 1000, h: 1000, ...book.cover.back }];
  const { rows, cols } = bookTray(book);
  const items = [text(500, 120, 'All challenges', 46, { bold: true, anchor: 'middle' })];
  const list = book.challenges;
  const box = { x: 70, y: 165, w: 860, h: 720 };
  if (!list.length) {
    items.push(text(500, 500, 'No challenges yet.', 30, { fill: MUTED, anchor: 'middle' }));
  } else {
    // Largest thumbnails that fit the grid.
    let best = null;
    for (let perRow = 1; perRow <= 12; perRow += 1) {
      const slotW = box.w / perRow;
      const cell = Math.min((slotW * 0.86) / (cols + 0.44), (slotW * 0.86) / (rows + 0.44));
      const slotH = cell * (rows + 0.44) + 52;
      const lines = Math.ceil(list.length / perRow);
      if (lines * slotH <= box.h && (!best || cell > best.cell)) best = { perRow, slotW, slotH, cell };
    }
    best = best ?? { perRow: 12, slotW: box.w / 12, slotH: box.h / Math.ceil(list.length / 12), cell: 6 };
    list.forEach((ch, i) => {
      const col = i % best.perRow;
      const line = Math.floor(i / best.perRow);
      const cx = box.x + col * best.slotW + best.slotW / 2;
      const y = box.y + line * best.slotH;
      items.push(...trayItems(ch.looks, rows, cols, cx - (cols * best.cell) / 2, y + best.cell * 0.22, best.cell));
      const labelY = y + best.cell * (rows + 0.44) + 34;
      const size = Math.min(24, best.slotW * 0.16);
      items.push(text(cx - size * 0.2, labelY, String(i + 1), size, { bold: true, anchor: 'end' }));
      items.push(...starItems(ch.difficulty, cx + size * 0.15, labelY - size * 0.35, size * 0.42, 'start'));
    });
  }
  items.push(text(500, 955, 'Made with Building Blocks Simulator', 22, { fill: MUTED, anchor: 'middle' }));
  return items;
}

function howToPage(book, number) {
  const items = [text(80, 150, 'How to play', 56, { bold: true })];
  const steps = [
    'Choose a challenge. The stars show how hard it is.',
    'Put every piece in the tray so that, seen from above, the tray looks exactly like the picture.',
    'Pieces can stand up or lie down. A prism lying slope-down needs a ramp under it.',
    'A cube always shows as a full square, so a split square is always made of two standing prisms.',
  ];
  let y = 250;
  steps.forEach((step, i) => {
    items.push({ t: 'circle', cx: 104, cy: y - 10, r: 24, fill: INK });
    items.push(text(104, y - 1, String(i + 1), 26, { bold: true, anchor: 'middle', fill: WHITE }));
    const p = paragraph(step, 150, y, 760, 30);
    items.push(...p.items);
    y += Math.max(p.height, 40) + 34;
  });
  y = Math.max(y + 20, 690);
  items.push(text(80, y, 'Difficulty', 32, { bold: true }));
  [1, 2, 3].forEach((level, i) => {
    const rowY = y + 62 + i * 60;
    items.push(...starItems(level, 80, rowY - 10, 18));
    items.push(text(240, rowY, DIFFICULTY[level].name, 30, { bold: true, fill: INK }));
    items.push(text(400, rowY, ['', 'a few split squares', 'more split squares', 'many split squares'][level], 28, { fill: MUTED }));
  });
  items.push(...pageNumber(number));
  return items;
}

function piecesPage(book, number) {
  const { rows, cols } = bookTray(book);
  const each = (rows * cols) / 4;
  const items = [text(80, 150, 'The pieces', 56, { bold: true })];
  items.push(...paragraph(`A ${rows}×${cols} tray holds ${each} of each piece.`, 80, 220, 840, 30).items);
  const kinds = [
    ['mix', 'W', 5, 'White cube + prism'],
    ['mix', 'B', 5, 'Black cube + prism'],
    ['tri', 'W', 3, 'White prism'],
    ['tri', 'B', 3, 'Black prism'],
  ];
  kinds.forEach(([type, color, o, label], i) => {
    const cx = 290 + (i % 2) * 420;
    const top = 275 + Math.floor(i / 2) * 285;
    const { floor, faces, box } = pieceIconShapes(type, color, o);
    // Same scale for both kinds, so the prism looks half as big as the cube + prism.
    const scale = Math.min(330 / 2.16, 200 / box.h);
    const ox = cx - (box.w * scale) / 2 - box.x * scale;
    const oy = top + (200 - box.h * scale) / 2 - box.y * scale;
    const map = ([px, py]) => [ox + px * scale, oy + py * scale];
    for (const quad of floor) items.push({ t: 'poly', pts: quad.map(map), fill: '#ece5d4' });
    for (const f of faces) items.push({ t: 'poly', pts: f.pts.map(map), fill: f.fill, stroke: f.stroke, sw: 2 });
    items.push(text(cx, top + 238, `${label}  ×${each}`, 26, { anchor: 'middle', bold: true }));
  });
  const note = 'Every two squares of the tray take one cube + prism and one loose prism. A cube always shows as a full square, so at most half of the squares can be split.';
  items.push(...paragraph(note, 80, 850, 840, 25, { fill: MUTED }).items);
  items.push(...pageNumber(number));
  return items;
}

function challengeHeader(index, x, anchor) {
  return [
    text(x, 92, 'Challenge', 24, { fill: MUTED, anchor }),
    text(x, 162, String(index + 1), 66, { bold: true, anchor }),
  ];
}

/** Items of a page, plus the x offset of its view (1000 for the right half of a spread). */
export function pageDrawing(book, page) {
  const { rows, cols } = bookTray(book);
  switch (page.kind) {
    case 'cover':
      return { items: coverPage(book), offsetX: 0 };
    case 'back':
      return { items: backPage(book), offsetX: 0 };
    case 'howto':
      return { items: howToPage(book, page.number), offsetX: 0 };
    case 'pieces':
      return { items: piecesPage(book, page.number), offsetX: 0 };
    default:
      break;
  }
  const own = page.kind === 'own';
  const ch = own ? null : book.challenges[page.index];
  if (book.shape !== 'rect') {
    const items = own ? [text(70, 150, 'Make your own', 52, { bold: true })] : challengeHeader(page.index, 70, 'start');
    if (!own) items.push(...starItems(ch.difficulty, 930, 130, 26, 'end'));
    const fit = fitTray(rows, cols, { x: 80, y: 215, w: 840, h: own ? 640 : 690 });
    items.push(...trayItems(own ? [] : ch.looks, rows, cols, fit.x, fit.y, fit.cell, { empty: own }));
    if (own) items.push(text(500, 925, 'Draw a picture here, then try to build it.', 26, { fill: MUTED, anchor: 'middle' }));
    items.push(...pageNumber(page.number));
    return { items, offsetX: 0 };
  }
  // 2:1 trays: one drawing across both pages of the spread (left page = even number).
  const leftNumber = page.half === 'left' ? page.number : page.number - 1;
  const items = own ? [text(70, 150, 'Make your own', 52, { bold: true })] : challengeHeader(page.index, 70, 'start');
  if (!own) items.push(...starItems(ch.difficulty, 1930, 130, 26, 'end'));
  const fit = fitTray(rows, cols, { x: 80, y: 215, w: 1840, h: own ? 640 : 690 }, 1000);
  items.push(...trayItems(own ? [] : ch.looks, rows, cols, fit.x, fit.y, fit.cell, { empty: own }));
  if (own) items.push(text(1500, 925, 'Draw a picture here, then try to build it.', 26, { fill: MUTED, anchor: 'middle' }));
  items.push(...pageNumber(leftNumber));
  items.push(...pageNumber(leftNumber + 1).map((it) => ({ ...it, x: it.x + 1000 })));
  return { items, offsetX: page.half === 'right' ? 1000 : 0 };
}

// ---- SVG ---------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (v) => (Math.round(v * 10) / 10).toString();
const FONT = 'Helvetica, Arial, &quot;Liberation Sans&quot;, sans-serif';

function paintAttrs(it) {
  let a = ` fill="${it.fill ?? 'none'}"`;
  if (it.stroke) a += ` stroke="${it.stroke}" stroke-width="${n1(it.sw ?? 1)}" stroke-linejoin="round"`;
  if (it.dash) a += ` stroke-dasharray="${it.dash.map(n1).join(' ')}"`;
  return a;
}

export function itemsSvg(items) {
  return items.map((it) => {
    switch (it.t) {
      case 'rect':
        return `<rect x="${n1(it.x)}" y="${n1(it.y)}" width="${n1(it.w)}" height="${n1(it.h)}"${it.r ? ` rx="${n1(it.r)}"` : ''}${paintAttrs(it)}/>`;
      case 'poly':
        return `<polygon points="${it.pts.map((p) => `${n1(p[0])},${n1(p[1])}`).join(' ')}"${paintAttrs(it)}/>`;
      case 'circle':
        return `<circle cx="${n1(it.cx)}" cy="${n1(it.cy)}" r="${n1(it.r)}"${paintAttrs(it)}/>`;
      case 'line':
        return `<line x1="${n1(it.x1)}" y1="${n1(it.y1)}" x2="${n1(it.x2)}" y2="${n1(it.y2)}"${paintAttrs({ ...it, fill: null })}/>`;
      case 'text': {
        const anchor = it.anchor === 'middle' ? 'middle' : it.anchor === 'end' ? 'end' : 'start';
        return `<text x="${n1(it.x)}" y="${n1(it.y)}" font-size="${n1(it.size)}" font-family="${FONT}" font-weight="${it.bold ? 700 : 400}" text-anchor="${anchor}" fill="${it.fill}">${esc(it.text)}</text>`;
      }
      case 'image':
        return `<image href="${it.src}" x="${n1(it.x)}" y="${n1(it.y)}" width="${n1(it.w)}" height="${n1(it.h)}" preserveAspectRatio="xMidYMid slice"/>`;
      default:
        return '';
    }
  }).join('');
}

/** SVG of one page (1-based page number). */
export function pageSvg(book, number, pages = bookPages(book)) {
  const page = pages[number - 1];
  const { items, offsetX } = pageDrawing(book, page);
  return `<svg viewBox="${offsetX} 0 1000 1000" xmlns="http://www.w3.org/2000/svg" class="book-page" role="img" aria-label="Page ${number}"><rect x="${offsetX}" y="0" width="1000" height="1000" fill="#ffffff"/>${itemsSvg(items)}</svg>`;
}

// ---- PDF ---------------------------------------------------------------------------------

export function drawItemsPdf(canvas, items, images) {
  for (const it of items) {
    const paint = { fill: it.fill ?? null, stroke: it.stroke ?? null, sw: it.sw, dash: it.dash };
    switch (it.t) {
      case 'rect':
        canvas.rect(it.x, it.y, it.w, it.h, { ...paint, r: it.r });
        break;
      case 'poly':
        canvas.polygon(it.pts, paint);
        break;
      case 'circle':
        canvas.circle(it.cx, it.cy, it.r, paint);
        break;
      case 'line':
        canvas.line(it.x1, it.y1, it.x2, it.y2, { stroke: it.stroke, sw: it.sw, dash: it.dash });
        break;
      case 'text':
        canvas.text(it.x, it.y, it.text, { size: it.size, bold: it.bold, fill: it.fill, anchor: it.anchor });
        break;
      case 'image': {
        let img = images.get(it.src);
        if (!img) {
          img = { bytes: base64ToBytes(it.src.slice(it.src.indexOf(',') + 1)), width: it.width, height: it.height };
          images.set(it.src, img);
        }
        canvas.image(it.x, it.y, it.w, it.h, img);
        break;
      }
      default:
        break;
    }
  }
}

function drawPagePdf(canvas, book, page, left, top, side, images) {
  const { items, offsetX } = pageDrawing(book, page);
  canvas.setFrame(left - (offsetX / 1000) * side, top, side);
  canvas.save();
  canvas.clipRect(offsetX, 0, 1000, 1000);
  drawItemsPdf(canvas, items, images);
  canvas.restore();
}

/**
 * The book as a PDF.
 * layout 'sheets': landscape sheets, two pages per side, in printing order (sheet 1
 *   outside, sheet 1 inside, sheet 2 outside, ...), with crop and fold marks.
 * layout 'pages': one square page per PDF page, in reading order.
 */
export function bookPdf(book, layout = 'sheets') {
  const paper = PAPER[book.paper] ?? PAPER.a4;
  const pages = bookPages(book);
  const doc = new PdfDocument();
  const images = new Map();
  const side = paper.page * MM;
  if (layout === 'pages') {
    for (const page of pages) {
      const canvas = doc.page(side, side);
      drawPagePdf(canvas, book, page, 0, 0, side, images);
    }
    return doc.toBytes();
  }
  const W = paper.width * MM;
  const H = paper.height * MM;
  const left = (W - 2 * side) / 2;
  const top = (H - side) / 2;
  const sheets = imposition(pages.length);
  sheets.forEach((sheet) => {
    for (const face of ['outside', 'inside']) {
      const canvas = doc.page(W, H);
      const [l, r] = sheet[face];
      drawPagePdf(canvas, book, pages[l - 1], left, top, side, images);
      drawPagePdf(canvas, book, pages[r - 1], left + side, top, side, images);
      // Marks, in points.
      canvas.setFrame(0, 0, 1000, 1000);
      const mark = { stroke: '#8a8473', sw: 0.5 };
      const gap = 4;
      const len = 14;
      for (const [x, y, sx, sy] of [[left, top, -1, -1], [left + 2 * side, top, 1, -1], [left, top + side, -1, 1], [left + 2 * side, top + side, 1, 1]]) {
        canvas.line(x + sx * gap, y, x + sx * (gap + len), y, mark);
        canvas.line(x, y + sy * gap, x, y + sy * (gap + len), mark);
      }
      const fold = { stroke: '#8a8473', sw: 0.5, dash: [2, 2] };
      canvas.line(left + side, top - gap, left + side, top - gap - len, fold);
      canvas.line(left + side, top + side + gap, left + side, top + side + gap + len, fold);
      const label = `Sheet ${sheet.sheet} of ${sheets.length}, ${face === 'outside' ? 'outside (print first)' : 'inside (back of the same sheet)'}: pages ${l} and ${r}`;
      canvas.text(W / 2, top + side + gap + len + 14, label, { size: 8, fill: '#8a8473', anchor: 'middle' });
    }
  });
  return doc.toBytes();
}
