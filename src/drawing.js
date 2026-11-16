// Drawings for print (cards, the box, the rules leaflet) as simple lists of shapes that
// become SVG (preview) or PDF (printing). Shapes:
//   { t: 'rect', x, y, w, h, r?, fill?, stroke?, sw?, dash? }
//   { t: 'poly', pts: [[x, y], ...], fill?, stroke?, sw? }
//   { t: 'circle', cx, cy, r, fill?, stroke?, sw? }
//   { t: 'line', x1, y1, x2, y2, stroke, sw, dash? }
//   { t: 'text', x, y, text, size, fill, bold, anchor: start | middle | end, rot? (degrees, clockwise) }
//   { t: 'image', src (JPEG data URL), width, height, x, y, w, h } (covers the box, cropped)

import { DIFFICULTY } from './packs.js';
import { HALF_OUTLINE, LOOK } from './geometry.js';
import { wrapText } from './fonts.js';
import { base64ToBytes } from './pdf.js';

export const INK = '#1d1c19';
export const MUTED = '#6f6a5c';
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

/** A text shape. opts: { fill, bold, anchor, rot }. */
export const text = (x, y, value, size, opts = {}) => ({ t: 'text', x, y, text: value, size, fill: opts.fill ?? INK, bold: !!opts.bold, anchor: opts.anchor ?? 'start', rot: opts.rot ?? 0 });

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

/** Wrapped text: { items, height }. */
export function paragraph(value, x, y, width, size, opts = {}) {
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
        const turn = it.rot ? ` transform="rotate(${n1(it.rot)} ${n1(it.x)} ${n1(it.y)})"` : '';
        return `<text x="${n1(it.x)}" y="${n1(it.y)}" font-size="${n1(it.size)}" font-family="${FONT}" font-weight="${it.bold ? 700 : 400}" text-anchor="${anchor}" fill="${it.fill}"${turn}>${esc(it.text)}</text>`;
      }
      case 'image':
        return `<image href="${it.src}" x="${n1(it.x)}" y="${n1(it.y)}" width="${n1(it.w)}" height="${n1(it.h)}" preserveAspectRatio="xMidYMid slice"/>`;
      default:
        return '';
    }
  }).join('');
}

/** An SVG of a drawing in its own units (fits the width it is given). */
export function drawingSvg(drawing, label, className = 'print-svg') {
  return `<svg viewBox="0 0 ${n1(drawing.w)} ${n1(drawing.h)}" xmlns="http://www.w3.org/2000/svg" class="${className}" role="img" aria-label="${esc(label)}"><rect width="${n1(drawing.w)}" height="${n1(drawing.h)}" fill="#ffffff"/>${itemsSvg(drawing.items)}</svg>`;
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
        canvas.text(it.x, it.y, it.text, { size: it.size, bold: it.bold, fill: it.fill, anchor: it.anchor, rot: it.rot });
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
