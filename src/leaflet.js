// The rules leaflet that goes in every box: four square pages folded from one strip (the
// cards hold the pictures, so the leaflet only has to explain the game).
//   page 1  cover        page 2  the pieces and the goal
//   page 3  ways to play page 4  the digital pack, and who made it
// Pages are drawn in 1000 × 1000 design units. To print: two leaflets per portrait sheet,
// the outside ([4 | 1]) on the first PDF page and the inside ([2 | 3]) on the second; print
// on both sides (flip on the long edge), cut along the marks and fold in the middle.

import { DIFFICULTY } from './packs.js';
import { MODES } from './game.js';
import { INK, MUTED, defaultArt, drawItemsPdf, fitTray, itemsSvg, paragraph, starItems, text, trayItems } from './drawing.js';
import { MM, PdfDocument } from './pdf.js';
import { pieceIconShapes } from './render3d.js';
import { PAPER } from './cards.js';

/** Size of a folded leaflet page, in millimetres (it lies on the tray in the box). */
export const LEAFLET_PAGE = 95;

const RULE = '#d8d0bf';

/**
 * What the leaflet needs: { title, subtitle, rows, cols, cards, art (looks), maker: [lines], maxStars }.
 * Missing parts get sensible defaults.
 */
function infoOf(raw = {}) {
  const rows = raw.rows ?? 4;
  const cols = raw.cols ?? 4;
  return {
    title: raw.title || 'Notan',
    subtitle: raw.subtitle ?? '',
    rows,
    cols,
    cards: raw.cards ?? 0,
    art: raw.art && raw.art.length === rows * cols ? raw.art : defaultArt(rows, cols),
    maker: raw.maker ?? [],
    maxStars: raw.maxStars > 3 ? 5 : 3,
  };
}

function heading(value, y = 130) {
  return [text(80, y, value, 64, { bold: true }), { t: 'rect', x: 80, y: y + 28, w: 120, h: 8, fill: INK }];
}

function pageNumber(n) {
  return text(n % 2 ? 920 : 80, 955, String(n), 26, { fill: MUTED, anchor: n % 2 ? 'end' : 'start' });
}

function coverPage(info) {
  const items = [text(500, 190, info.title, 150, { bold: true, anchor: 'middle' })];
  if (info.subtitle) items.push(text(500, 270, info.subtitle, 46, { fill: MUTED, anchor: 'middle' }));
  const fit = fitTray(info.rows, info.cols, { x: 120, y: 330, w: 760, h: 450 });
  items.push(...trayItems(info.art, info.rows, info.cols, fit.x, fit.y, fit.cell));
  items.push(text(500, 870, 'How to play', 52, { bold: true, anchor: 'middle' }));
  const pieces = info.rows * info.cols;
  items.push(text(500, 930, `1 tray · ${pieces} pieces${info.cards ? ` · ${info.cards} cards` : ''}`, 32, { fill: MUTED, anchor: 'middle' }));
  return items;
}

function piecesPage(info) {
  const items = heading('Build the picture');
  const each = (info.rows * info.cols) / 4;
  const kinds = [
    ['mix', 'W', 5, 'Cube + prism'],
    ['mix', 'B', 5, 'Cube + prism'],
    ['tri', 'W', 3, 'Prism'],
    ['tri', 'B', 3, 'Prism'],
  ];
  const slot = 210;
  kinds.forEach(([type, color, o, label], i) => {
    const cx = 80 + slot / 2 + i * slot;
    const top = 200;
    const { floor, faces, box } = pieceIconShapes(type, color, o);
    // One scale for both kinds, so a prism looks half the size of a cube + prism.
    const scale = Math.min((slot - 20) / 2.16, 150 / box.h);
    const ox = cx - (box.w * scale) / 2 - box.x * scale;
    const oy = top + (150 - box.h * scale) / 2 - box.y * scale;
    const map = ([px, py]) => [ox + px * scale, oy + py * scale];
    for (const quad of floor) items.push({ t: 'poly', pts: quad.map(map), fill: '#ece5d4' });
    for (const f of faces) items.push({ t: 'poly', pts: f.pts.map(map), fill: f.fill, stroke: f.stroke, sw: 1.6 });
    items.push(text(cx, top + 190, label, 26, { anchor: 'middle', bold: true }));
    items.push(text(cx, top + 222, `${color === 'W' ? 'white' : 'black'} ×${each}`, 26, { anchor: 'middle', fill: MUTED }));
  });
  const steps = [
    'Draw a card. Its stars show how hard it is.',
    'Put every piece in the tray so that, seen from above, the tray looks exactly like the card.',
    'Pieces can stand up or lie down. A prism lying on its slope needs a ramp under it.',
  ];
  let y = 520;
  steps.forEach((step, i) => {
    items.push({ t: 'circle', cx: 102, cy: y - 11, r: 22, fill: INK });
    items.push(text(102, y - 1, String(i + 1), 26, { bold: true, anchor: 'middle', fill: '#ffffff' }));
    const p = paragraph(step, 145, y, 775, 36);
    items.push(...p.items);
    y += Math.max(p.height, 44) + 30;
  });
  items.push(...paragraph('A cube always shows as a full square, so a split square is made of two prisms.', 80, Math.max(y + 10, 850), 840, 30, { fill: MUTED }).items);
  items.push(pageNumber(2));
  return items;
}

function waysPage(info) {
  const items = heading('Ways to play');
  let y = 230;
  const block = (name, body) => {
    items.push(text(80, y, name, 34, { bold: true }));
    const p = paragraph(body, 80, y + 40, 840, 30);
    items.push(...p.items);
    y += 40 + p.height + 14;
  };
  block('Alone', 'Draw the cards one by one and build them. Beat your time on the hard ones.');
  items.push({ t: 'line', x1: 80, y1: y - 4, x2: 920, y2: y - 4, stroke: RULE, sw: 3 });
  y += 30;
  for (const id of ['trial', 'memory', 'race']) block(MODES[id].name, MODES[id].short);
  items.push(...paragraph('Score the stars of every card you build. Most stars wins.', 80, y + 4, 840, 30, { fill: MUTED }).items);
  if (info.maxStars > 3) {
    // Five levels: just the filled stars of each, on two lines.
    [1, 2, 3, 4, 5].forEach((level, i) => {
      const row = i < 3 ? 0 : 1;
      const x = 80 + (row ? i - 3 : i) * 290;
      const y = 872 + row * 52;
      items.push(...starItems(level, x, y - 10, 11, 'start', level));
      items.push(text(x + 26 * level + 6, y, DIFFICULTY[level].name, 26, { bold: true }));
    });
  } else {
    const legendY = 905;
    [1, 2, 3].forEach((level, i) => {
      const x = 80 + i * 290;
      items.push(...starItems(level, x, legendY - 10, 13));
      items.push(text(x + 95, legendY, DIFFICULTY[level].name, 28, { bold: true }));
    });
  }
  items.push(pageNumber(3));
  return items;
}

function backPage(info) {
  const items = heading('The digital pack');
  const body = [
    'Scan the unlock card in this box with your phone camera, or type its code in the app.',
    'The app unlocks the cards of this box. It deals them, keeps time and score for games together, and shows one way to build any card when you are stuck.',
  ];
  let y = 240;
  for (const para of body) {
    const p = paragraph(para, 80, y, 840, 34);
    items.push(...p.items);
    y += p.height + 24;
  }
  const maker = info.maker.slice(0, 6);
  let my = 900 - Math.max(0, maker.length - 1) * 36;
  const artBottom = my - 100;
  if (artBottom - (y + 10) > 120) {
    const fit = fitTray(info.rows, info.cols, { x: 300, y: y + 10, w: 400, h: Math.min(260, artBottom - y - 10) });
    items.push(...trayItems(defaultArt(info.rows, info.cols), info.rows, info.cols, fit.x, fit.y, fit.cell));
  }
  items.push(text(80, my - 46, `${info.title}${info.subtitle ? ` · ${info.subtitle}` : ''}`, 30, { bold: true }));
  for (const line of maker) {
    items.push(text(80, my, line, 28, { fill: MUTED }));
    my += 36;
  }
  return items;
}

/** The four pages: arrays of drawing shapes, each page 1000 × 1000. */
export function leafletPages(raw) {
  const info = infoOf(raw);
  return [coverPage(info), piecesPage(info), waysPage(info), backPage(info)];
}

/** SVG of page n (1 to 4). */
export function leafletPageSvg(raw, n, pages = leafletPages(raw)) {
  return `<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" class="leaflet-page" role="img" aria-label="Rules, page ${n}"><rect width="1000" height="1000" fill="#ffffff"/>${itemsSvg(pages[n - 1])}</svg>`;
}

/**
 * The leaflet as a PDF: two leaflets per portrait sheet. PDF page 1 is the outside of the
 * sheet ([4 | 1] twice), page 2 the inside ([2 | 3] twice).
 */
export function leafletPdf(raw, paperId = 'a4') {
  const pages = leafletPages(raw);
  const paper = PAPER[paperId] ?? PAPER.a4;
  const W = Math.min(paper.width, paper.height);
  const H = Math.max(paper.width, paper.height);
  const side = LEAFLET_PAGE;
  const gap = 24;
  const left = (W - 2 * side) / 2;
  const tops = [(H - (2 * side + gap)) / 2, (H - (2 * side + gap)) / 2 + side + gap];
  const doc = new PdfDocument();
  const images = new Map();
  for (const [face, pair] of [['outside', [4, 1]], ['inside', [2, 3]]]) {
    const canvas = doc.page(W * MM, H * MM);
    for (const top of tops) {
      pair.forEach((number, k) => {
        canvas.setFrame((left + k * side) * MM, top * MM, side * MM, 1000);
        canvas.save();
        canvas.clipRect(0, 0, 1000, 1000);
        drawItemsPdf(canvas, pages[number - 1], images);
        canvas.restore();
      });
      // Crop marks at the corners and fold marks at the middle, in points.
      canvas.setFrame(0, 0, 1000, 1000);
      const mark = { stroke: '#8a8473', sw: 0.5 };
      const g = 2 * MM;
      const len = 5 * MM;
      const x0 = left * MM;
      const x1 = (left + 2 * side) * MM;
      const y0 = top * MM;
      const y1 = (top + side) * MM;
      for (const [x, y, sx, sy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
        canvas.line(x + sx * g, y, x + sx * (g + len), y, mark);
        canvas.line(x, y + sy * g, x, y + sy * (g + len), mark);
      }
      const mid = (left + side) * MM;
      const fold = { ...mark, dash: [2, 2] };
      canvas.line(mid, y0 - g, mid, y0 - g - len, fold);
      canvas.line(mid, y1 + g, mid, y1 + g + len, fold);
    }
    const note = face === 'outside'
      ? 'Rules leaflet, outside (covers). Print the next page on the back: both sides, flip on the long edge.'
      : 'Rules leaflet, inside (back of the same sheet). Cut along the marks, fold in the middle.';
    canvas.text((W * MM) / 2, (tops[1] + side + 14) * MM, note, { size: 8, fill: '#8a8473', anchor: 'middle' });
  }
  return doc.toBytes();
}
