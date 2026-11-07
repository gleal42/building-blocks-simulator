// Top view of the tray, drawn to look like the real puzzle: a tan plastic tray with glossy
// white and black pieces, thin dark seams between pieces and none inside a piece.

import { DC, DR, HALF_OUTLINE, LOOK, MIX_ORIENTS, isCap, isRamp, isUpright, thickSide } from './geometry.js';

export const CELL = 100;
export const RIM = 34;
const GAP = 1.7; // each piece shrinks by this much, leaving a seam twice as wide
const RADIUS = 7;

const SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];
const f1 = (n) => (Math.round(n * 10) / 10).toString();

export function trayFrame(rows, cols) {
  return { width: cols * CELL + 2 * RIM, height: rows * CELL + 2 * RIM };
}

const at = (r, c, [x, y]) => [RIM + (c + x) * CELL, RIM + (r + y) * CELL];

function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${f1(p[0])},${f1(p[1])}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Move every edge of a convex polygon inwards by d. */
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

function roundedPath(points, radius) {
  const n = points.length;
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const l1 = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]);
    const l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const t1 = Math.min(radius / l1, 0.45);
    const t2 = Math.min(radius / l2, 0.45);
    const a = [cur[0] + (prev[0] - cur[0]) * t1, cur[1] + (prev[1] - cur[1]) * t1];
    const b = [cur[0] + (next[0] - cur[0]) * t2, cur[1] + (next[1] - cur[1]) * t2];
    d += `${i === 0 ? 'M' : 'L'}${f1(a[0])} ${f1(a[1])}Q${f1(cur[0])} ${f1(cur[1])} ${f1(b[0])} ${f1(b[1])}`;
  }
  return `${d}Z`;
}

const outlinePath = (points) => roundedPath(insetConvex(points, GAP), RADIUS);

/**
 * How a piece shows from above.
 * { outline, slope: null | { r, c, side }, under: bool (hidden ramp, drawn only in x-ray),
 *   capped: bool (has a part lying slope-down), hollow: null | { r, c } }
 */
export function pieceShape(board, piece, { xray = false } = {}) {
  if (piece.type === 'tri') {
    const h = piece.o;
    if (isUpright(h)) return { outline: HALF_OUTLINE[h].map((p) => at(piece.r, piece.c, p)), slope: null, under: false, capped: false };
    const square = SQUARE.map((p) => at(piece.r, piece.c, p));
    if (isRamp(h)) {
      const covered = board ? board.isCovered(piece.r, piece.c, h) : false;
      if (covered && !xray) return null;
      return { outline: square, slope: { r: piece.r, c: piece.c, side: thickSide(h) }, under: covered, capped: false };
    }
    return { outline: square, slope: null, under: false, capped: true };
  }
  const m = MIX_ORIENTS[piece.o];
  const r2 = piece.r + DR[m.dir];
  const c2 = piece.c + DC[m.dir];
  const cube = SQUARE.map((p) => at(piece.r, piece.c, p));
  if (isUpright(m.half)) {
    return { outline: convexHull([...cube, ...HALF_OUTLINE[m.half].map((p) => at(r2, c2, p))]), slope: null, under: false, capped: false };
  }
  const both = convexHull([...cube, ...SQUARE.map((p) => at(r2, c2, p))]);
  if (isCap(m.half)) {
    const hollow = board && board.inBounds(r2, c2) && board.cell(r2, c2).halves.length === 1 ? { r: r2, c: c2 } : null;
    // In x-ray the cube stays solid and only the roof part turns see-through.
    const xrayParts = { solid: cube, roof: SQUARE.map((p) => at(r2, c2, p)) };
    return { outline: both, slope: null, under: false, capped: true, hollow, xrayParts };
  }
  const covered = board ? board.isCovered(r2, c2, m.half) : false;
  if (covered && !xray) return { outline: cube, slope: null, under: false, capped: false };
  return { outline: both, slope: { r: r2, c: c2, side: thickSide(m.half) }, under: covered, capped: false };
}

// ---- SVG defs --------------------------------------------------------------------------

function slopeGradient(id, side, dark, light) {
  const v = [
    ['0', '1', '0', '0'], // N: high edge at the top
    ['0', '0', '1', '0'], // E
    ['0', '0', '0', '1'], // S
    ['1', '0', '0', '0'], // W
  ][side];
  return `<linearGradient id="${id}" x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient>`;
}

export function boardDefs() {
  // Light comes from the top-left: slopes rising to the east or south face it.
  const lit = [false, true, true, false];
  let slopes = '';
  for (let side = 0; side < 4; side += 1) {
    slopes += slopeGradient(`slW${side}`, side, lit[side] ? '#cfcfc7' : '#b3b3aa', lit[side] ? '#fbfbf8' : '#e3e3dd');
    slopes += slopeGradient(`slB${side}`, side, lit[side] ? '#0d0e10' : '#060708', lit[side] ? '#4a5057' : '#2b2f33');
  }
  return `<defs>
<linearGradient id="trayG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3e3bb"/><stop offset=".55" stop-color="#e6cf9b"/><stop offset="1" stop-color="#d4b981"/></linearGradient>
<linearGradient id="wellG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4955d"/><stop offset=".08" stop-color="#c7a96f"/><stop offset="1" stop-color="#cfb27a"/></linearGradient>
<linearGradient id="flatW" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e4e4de"/></linearGradient>
<linearGradient id="flatB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b4045"/><stop offset=".6" stop-color="#202326"/><stop offset="1" stop-color="#15171a"/></linearGradient>
<linearGradient id="bevW" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#f1f1ec"/><stop offset="1" stop-color="#a9a9a1"/></linearGradient>
<linearGradient id="bevB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b828a"/><stop offset=".45" stop-color="#2d3135"/><stop offset="1" stop-color="#030304"/></linearGradient>
<radialGradient id="glossB" cx=".28" cy=".22" r=".75"><stop offset="0" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".05"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<radialGradient id="glossW" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
${slopes}
<pattern id="hatch" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="#cdb07a"/><line x1="0" y1="0" x2="0" y2="14" stroke="#a88b55" stroke-width="5" stroke-opacity=".45"/></pattern>
<filter id="pieceShadow" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="1.6" dy="2.6" stdDeviation="2.2" flood-color="#3a280c" flood-opacity=".5"/></filter>
<filter id="trayShadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".35"/></filter>
</defs>`;
}

function trayMarkup(rows, cols) {
  const { width, height } = trayFrame(rows, cols);
  const wx = RIM - 7;
  const ww = cols * CELL + 14;
  const wh = rows * CELL + 14;
  let grid = '';
  for (let r = 1; r < rows; r += 1) grid += `<line x1="${RIM}" y1="${RIM + r * CELL}" x2="${RIM + cols * CELL}" y2="${RIM + r * CELL}"/>`;
  for (let c = 1; c < cols; c += 1) grid += `<line x1="${RIM + c * CELL}" y1="${RIM}" x2="${RIM + c * CELL}" y2="${RIM + rows * CELL}"/>`;
  return `<g class="tray">
<rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="url(#trayG)" stroke="#b49a63" stroke-width="1.5" filter="url(#trayShadow)"/>
<rect x="3.5" y="3.5" width="${width - 7}" height="${height - 7}" rx="15" fill="none" stroke="#fff6dc" stroke-opacity=".7" stroke-width="2"/>
<rect x="${wx}" y="${wx}" width="${ww}" height="${wh}" rx="8" fill="url(#wellG)" stroke="#a7894f" stroke-width="1.2"/>
<g class="grid" stroke="#8f7240" stroke-opacity=".22" stroke-width="1.2">${grid}</g>
</g>`;
}

function pieceMarkup(shape, color, { id = 0, cls = '', translucent = false } = {}) {
  const path = outlinePath(shape.outline);
  const clipId = `clip${id || Math.random().toString(36).slice(2)}`;
  let s = `<g class="piece ${cls}${translucent ? ' is-glass' : ''}"${id ? ` data-id="${id}"` : ''}>`;
  s += `<path d="${path}" fill="url(#flat${color})"/>`;
  if (shape.slope) {
    const [x, y] = at(shape.slope.r, shape.slope.c, [0, 0]);
    s += `<clipPath id="${clipId}"><path d="${path}"/></clipPath>`;
    s += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="url(#sl${color}${shape.slope.side})" clip-path="url(#${clipId})"/>`;
  }
  if (color === 'B') s += `<path d="${path}" fill="url(#glossB)"/>`;
  s += `<path d="${path}" fill="none" stroke="url(#bev${color})" stroke-width="2.6"/>`;
  if (translucent) s += `<path class="glass-line" d="${path}"/>`;
  s += '</g>';
  return s;
}

function hollowMarkup({ r, c }) {
  const [x, y] = at(r, c, [0, 0]);
  return `<rect class="hollow-mark" x="${x + 14}" y="${y + 14}" width="${CELL - 28}" height="${CELL - 28}" rx="6"/>`;
}

/**
 * Board SVG content.
 * opts: { xray, ghost: { piece, ok }, hoverId, freshIds: Set, selectable }
 */
export function boardMarkup(board, opts = {}) {
  const { xray = false, ghost = null, hoverId = 0, freshIds = new Set() } = opts;
  const under = [];
  const over = [];
  const glass = [];
  const marks = [];
  for (const piece of board.pieces.values()) {
    const shape = pieceShape(board, piece, { xray });
    if (!shape) continue;
    const cls = [piece.id === hoverId ? 'is-hover' : '', freshIds.has(piece.id) ? 'is-fresh' : ''].join(' ');
    if (xray && shape.capped) {
      // Roofs become see-through so the ramp (or the hollow) underneath shows.
      if (shape.xrayParts) {
        over.push(pieceMarkup({ outline: shape.xrayParts.solid }, piece.color, { id: piece.id, cls }));
        glass.push(pieceMarkup({ outline: shape.xrayParts.roof }, piece.color, { cls, translucent: true }));
      } else {
        glass.push(pieceMarkup(shape, piece.color, { id: piece.id, cls, translucent: true }));
      }
    } else {
      (shape.under ? under : over).push(pieceMarkup(shape, piece.color, { id: piece.id, cls }));
    }
    if (shape.hollow) marks.push(hollowMarkup(shape.hollow));
  }
  if (xray) {
    for (const { r, c } of board.hollowCells()) {
      const [x, y] = at(r, c, [0, 0]);
      under.unshift(`<rect x="${x + 4}" y="${y + 4}" width="${CELL - 8}" height="${CELL - 8}" fill="url(#hatch)" opacity=".9"/>`);
    }
  }
  let ghostMarkup = '';
  if (ghost) {
    const shape = pieceShape(null, ghost.piece, {});
    if (shape) {
      ghostMarkup = `<g class="ghost ${ghost.ok ? 'is-ok' : 'is-bad'}">${pieceMarkup(shape, ghost.piece.color, { cls: 'ghost-body' })}<path class="ghost-line" d="${outlinePath(shape.outline)}"/></g>`;
    }
  }
  const { width, height } = trayFrame(board.rows, board.cols);
  return {
    viewBox: `-14 -10 ${width + 28} ${height + 36}`,
    markup: `${boardDefs()}${trayMarkup(board.rows, board.cols)}<g filter="url(#pieceShadow)">${under.join('')}${over.join('')}</g>${glass.join('')}${marks.join('')}${ghostMarkup}`,
  };
}

// ---- Pictures (target patterns) ------------------------------------------------------

const LOOK_PARTS = {
  [LOOK.SLASH_WB]: [[0, 'W'], [2, 'B']],
  [LOOK.SLASH_BW]: [[0, 'B'], [2, 'W']],
  [LOOK.BACK_WB]: [[1, 'W'], [3, 'B']],
  [LOOK.BACK_BW]: [[1, 'B'], [3, 'W']],
};

/** One square of a target picture, drawn like pieces in the tray. */
function lookCellMarkup(r, c, look) {
  if (look === LOOK.ANY) {
    const [x, y] = at(r, c, [0, 0]);
    return `<rect class="any-cell" x="${x + 3}" y="${y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="6" fill="url(#hatch)"/>`;
  }
  if (look === LOOK.WHITE || look === LOOK.BLACK) {
    return pieceMarkup({ outline: SQUARE.map((p) => at(r, c, p)) }, look === LOOK.WHITE ? 'W' : 'B');
  }
  return LOOK_PARTS[look].map(([h, color]) => pieceMarkup({ outline: HALF_OUTLINE[h].map((p) => at(r, c, p)) }, color)).join('');
}

export function pictureMarkup(rows, cols, looks, { hoverCell = -1 } = {}) {
  const cells = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) cells.push(lookCellMarkup(r, c, looks[r * cols + c]));
  let hover = '';
  if (hoverCell >= 0) {
    const [x, y] = at(Math.floor(hoverCell / cols), hoverCell % cols, [0, 0]);
    hover = `<rect class="paint-hover" x="${x + 2}" y="${y + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="8"/>`;
  }
  const { width, height } = trayFrame(rows, cols);
  return {
    viewBox: `-14 -10 ${width + 28} ${height + 36}`,
    markup: `${boardDefs()}${trayMarkup(rows, cols)}<g filter="url(#pieceShadow)">${cells.join('')}</g>${hover}`,
  };
}

/** Small flat picture (for the challenge target and the paint swatches). */
export function flatPicture(rows, cols, looks, { cell = 20, gap = 1.5, mismatches = null } = {}) {
  const parts = [];
  const tri = {
    0: (x, y, s) => `${x},${y} ${x + s},${y} ${x},${y + s}`,
    1: (x, y, s) => `${x},${y} ${x + s},${y} ${x + s},${y + s}`,
    2: (x, y, s) => `${x + s},${y} ${x + s},${y + s} ${x},${y + s}`,
    3: (x, y, s) => `${x},${y} ${x + s},${y + s} ${x},${y + s}`,
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const look = looks[r * cols + c];
      const x = c * cell + gap / 2;
      const y = r * cell + gap / 2;
      const s = cell - gap;
      if (look === LOOK.ANY || look < 0) parts.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" class="fp-any"/>`);
      else if (look === LOOK.WHITE) parts.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" class="fp-w"/>`);
      else if (look === LOOK.BLACK) parts.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" class="fp-b"/>`);
      else for (const [h, color] of LOOK_PARTS[look]) parts.push(`<polygon points="${tri[h](x, y, s)}" class="${color === 'W' ? 'fp-w' : 'fp-b'}"/>`);
      if (mismatches && mismatches[r * cols + c]) parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${s - 2}" height="${s - 2}" class="fp-miss"/>`);
    }
  }
  return `<svg viewBox="0 0 ${cols * cell} ${rows * cell}" class="flat-picture" role="img" aria-label="Target picture, ${rows} by ${cols}">${parts.join('')}</svg>`;
}

/** Convert a pointer position in board SVG units to a square and a point inside it. */
export function cellFromPoint(rows, cols, x, y) {
  const fx = (x - RIM) / CELL;
  const fy = (y - RIM) / CELL;
  const c = Math.floor(fx);
  const r = Math.floor(fy);
  if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
  return { r, c, fx: fx - c, fy: fy - r };
}
