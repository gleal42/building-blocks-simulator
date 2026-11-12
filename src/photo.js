// Reading designs from a photo (of a book page, cards, a screen...).
//
// Works on a grey image { width, height, data: Uint8Array (0 black .. 255 white) }:
//   1. A threshold splits dark ink from light paper (Otsu's method, or the user's choice).
//   2. findPatterns: dark areas are grown a little so that the pieces of one design join up,
//      joined into boxes, and boxes shaped like the tray are kept. Each becomes a quad (its
//      four corners), which also covers designs photographed at a slant.
//   3. readPattern: the quad is mapped onto the rows × columns of the tray; each square is
//      cut by both diagonals into four triangles (top, right, bottom, left), and how dark each
//      triangle is tells white, black, or which of the four splits the square shows.
// Everything here is plain arithmetic (no DOM), so it runs in tests too.

import { LOOK } from './geometry.js';

/** Grey levels from RGBA pixels. */
export function toGray(rgba, width, height) {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
    data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  }
  return { width, height, data };
}

/** Otsu's threshold: the grey level that best splits the picture into dark and light. */
export function otsu(img) {
  const hist = new Float64Array(256);
  for (const v of img.data) hist[v] += 1;
  const total = img.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 0.5;
    }
  }
  return Math.round(threshold);
}

// ---- Perspective: the unit square onto a quad ----------------------------------------------

/**
 * The projective map taking the unit square's corners (0,0) (1,0) (1,1) (0,1) to the quad's
 * corners [top-left, top-right, bottom-right, bottom-left]. Returns (u, v) => [x, y].
 */
export function squareToQuad(quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(den) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const h = Math.abs(den) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
  };
}

function sample(img, x, y) {
  const { width, height, data } = img;
  const fx = Math.min(width - 1.001, Math.max(0, x - 0.5));
  const fy = Math.min(height - 1.001, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = y0 * width + x0;
  const top = data[i] * (1 - tx) + data[i + 1] * tx;
  const bottom = data[i + width] * (1 - tx) + data[i + width + 1] * tx;
  return top * (1 - ty) + bottom * ty;
}

// ---- Reading one design --------------------------------------------------------------------

// How dark the four triangles of a square are for each look: [top, right, bottom, left].
const PROTOTYPES = [
  [LOOK.WHITE, [0, 0, 0, 0]],
  [LOOK.BLACK, [1, 1, 1, 1]],
  [LOOK.SLASH_WB, [0, 1, 1, 0]],
  [LOOK.SLASH_BW, [1, 0, 0, 1]],
  [LOOK.BACK_WB, [0, 0, 1, 1]],
  [LOOK.BACK_BW, [1, 1, 0, 0]],
];

// Points sampled in each square (square-local, 0..1), away from the edges (seams, grid
// lines) and the diagonals, grouped by triangle.
const SAMPLES = (() => {
  const groups = [[], [], [], []];
  const n = 11;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const fx = (i + 0.5) / n;
      const fy = (j + 0.5) / n;
      if (fx < 0.13 || fx > 0.87 || fy < 0.13 || fy > 0.87) continue;
      if (Math.abs(fx - fy) < 0.08 || Math.abs(fx + fy - 1) < 0.08) continue;
      const above = fy < fx; // above the "\" diagonal
      const aboveSlash = fx + fy < 1; // above the "/" diagonal
      const t = above && aboveSlash ? 0 : above ? 1 : !aboveSlash ? 2 : 3;
      groups[t].push([fx, fy]);
    }
  }
  return groups;
})();

/** Which look four triangle darknesses (0 light .. 1 dark) are closest to: { look, margin }. */
export function classifySquare(dark) {
  const scored = PROTOTYPES.map(([look, p]) => [look, p.reduce((s, v, k) => s + (v - dark[k]) ** 2, 0)]).sort((a, b) => a[1] - b[1]);
  return { look: scored[0][0], margin: scored[1][1] - scored[0][1] };
}

/**
 * Read the design inside a quad. Returns { looks, unsure: bool[] } where unsure marks squares
 * that were hard to tell (worth a look).
 */
export function readPattern(img, quad, rows, cols, threshold) {
  const map = squareToQuad(quad);
  const soft = 18;
  const looks = [];
  const unsure = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const dark = SAMPLES.map((group) => {
        let s = 0;
        for (const [fx, fy] of group) {
          const [x, y] = map((c + fx) / cols, (r + fy) / rows);
          s += Math.min(1, Math.max(0, (threshold + soft - sample(img, x, y)) / (2 * soft)));
        }
        return s / group.length;
      });
      const { look, margin } = classifySquare(dark);
      looks.push(look);
      unsure.push(margin < 1);
    }
  }
  return { looks, unsure };
}

// ---- Finding designs -----------------------------------------------------------------------

/** Grow a 0/1 mask by r pixels (a square neighbourhood), in two passes. */
function dilate(mask, width, height, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < Math.min(r, width); x += 1) count += mask[row + x];
    for (let x = 0; x < width; x += 1) {
      if (x + r < width) count += mask[row + x + r];
      if (x - r - 1 >= 0) count -= mask[row + x - r - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < Math.min(r, height); y += 1) count += tmp[y * width + x];
    for (let y = 0; y < height; y += 1) {
      if (y + r < height) count += tmp[(y + r) * width + x];
      if (y - r - 1 >= 0) count -= tmp[(y - r - 1) * width + x];
      out[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

function emptyBox() {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, ink: 0, sMin: Infinity, sMax: -Infinity, dMin: Infinity, dMax: -Infinity, tl: null, br: null, tr: null, bl: null };
}

function addPoint(box, x, y) {
  box.ink += 1;
  if (x < box.x0) box.x0 = x;
  if (x > box.x1) box.x1 = x;
  if (y < box.y0) box.y0 = y;
  if (y > box.y1) box.y1 = y;
  const s = x + y;
  const d = x - y;
  if (s < box.sMin) { box.sMin = s; box.tl = [x, y]; }
  if (s > box.sMax) { box.sMax = s; box.br = [x + 1, y + 1]; }
  if (d > box.dMax) { box.dMax = d; box.tr = [x + 1, y]; }
  if (d < box.dMin) { box.dMin = d; box.bl = [x, y + 1]; }
}

function mergeBoxes(a, b) {
  const m = emptyBox();
  m.x0 = Math.min(a.x0, b.x0);
  m.y0 = Math.min(a.y0, b.y0);
  m.x1 = Math.max(a.x1, b.x1);
  m.y1 = Math.max(a.y1, b.y1);
  m.ink = a.ink + b.ink;
  for (const [key, keep, lo] of [['sMin', 'tl', true], ['sMax', 'br', false], ['dMax', 'tr', false], ['dMin', 'bl', true]]) {
    const pick = lo ? (a[key] <= b[key] ? a : b) : (a[key] >= b[key] ? a : b);
    m[key] = pick[key];
    m[keep] = pick[keep];
  }
  return m;
}

const boxW = (b) => b.x1 - b.x0 + 1;
const boxH = (b) => b.y1 - b.y0 + 1;
const gapBetween = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1);

/** How far a box's shape is from the tray's (1 = same width:height ratio). */
const shapeOff = (w, h, rows, cols) => {
  const ratio = (w / h) / (cols / rows);
  return ratio >= 1 ? ratio : 1 / ratio;
};

/**
 * Find the designs in a picture. Returns quads in reading order (top to bottom, left to
 * right): [[top-left, top-right, bottom-right, bottom-left]], corners as [x, y] in pixels.
 */
export function findPatterns(img, { rows, cols, threshold = otsu(img) } = {}) {
  const { width, height, data } = img;
  const n = width * height;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) ink[i] = data[i] < threshold ? 1 : 0;
  // Just enough to join triangles that meet at a corner (not a caption under a design).
  const grow = Math.max(1, Math.round(Math.max(width, height) * 0.003));
  const joined = dilate(ink, width, height, grow);

  // Connected areas of the grown mask; the corners come from the real ink only.
  const label = new Int32Array(n).fill(-1);
  const boxes = [];
  const stack = new Int32Array(n);
  for (let start = 0; start < n; start += 1) {
    if (!joined[start] || label[start] >= 0) continue;
    const id = boxes.length;
    const box = emptyBox();
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      if (ink[i]) addPoint(box, x, y);
      if (x > 0 && joined[i - 1] && label[i - 1] < 0) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < width - 1 && joined[i + 1] && label[i + 1] < 0) { label[i + 1] = id; stack[top++] = i + 1; }
      if (y > 0 && joined[i - width] && label[i - width] < 0) { label[i - width] = id; stack[top++] = i - width; }
      if (y < height - 1 && joined[i + width] && label[i + width] < 0) { label[i + width] = id; stack[top++] = i + width; }
    }
    if (box.ink) boxes.push(box);
  }

  // Tiny specks (dust, text) do not start a design, but may belong to one.
  const minSide = Math.min(width, height);
  let parts = boxes.filter((b) => Math.max(boxW(b), boxH(b)) >= minSide * 0.012);
  // Drop the background: dark areas touching the edge of the photo and covering much of it.
  parts = parts.filter((b) => !((b.x0 === 0 || b.y0 === 0 || b.x1 === width - 1 || b.y1 === height - 1) && boxW(b) * boxH(b) > n * 0.2));

  // The size of a square: the biggest part, measured in squares of the tray. A design drawn
  // with a frame or grid lines is one part; one drawn as bare black squares on white paper
  // breaks into parts, and the biggest of those still spans a whole row or column of some
  // design on the page.
  const cellOf = (b) => Math.max(boxW(b) / cols, boxH(b) / rows);
  const cell = parts.reduce((m, b) => Math.max(m, cellOf(b)), 0);
  if (!cell) return [];

  // A design with ink all around (a frame) is complete: nothing more joins it (a caption
  // next to it, say).
  for (const b of parts) {
    b.complete = shapeOff(boxW(b), boxH(b), rows, cols) < 1.3 && cellOf(b) >= cell * 0.8 && isConvex([b.tl, b.tr, b.br, b.bl]) && edgesInked([b.tl, b.tr, b.br, b.bl], ink, width);
  }

  // Join the parts of one design (black squares with white squares between them): always
  // the two closest parts first, at most one square apart, while the result still fits in
  // one tray.
  for (;;) {
    let best = null;
    for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        const a = parts[i];
        const b = parts[j];
        if (a.complete || b.complete) continue;
        const gap = gapBetween(a, b);
        if (gap > cell * 1.2) continue;
        const w = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1;
        const h = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1;
        if (w > cols * cell * 1.12 || h > rows * cell * 1.12) continue;
        if (!best || gap < best.gap) best = { i, j, gap };
      }
    }
    if (!best) break;
    const merged = mergeBoxes(parts[best.i], parts[best.j]);
    parts = parts.filter((_, k) => k !== best.i && k !== best.j);
    parts.push(merged);
  }

  // Keep boxes about the size of a design. A box narrower than a tray (a design whose outer
  // squares are white, with nothing drawn around it) is widened to a tray around its middle.
  const candidates = [];
  for (const b of parts) {
    if (cellOf(b) < cell * 0.55 || Math.max(boxW(b), boxH(b)) < minSide * 0.04) continue;
    if (shapeOff(boxW(b), boxH(b), rows, cols) < 1.3) candidates.push({ b, quad: quadOf(b, ink, width), widened: false });
    else if (boxW(b) <= cols * cell * 1.12 && boxH(b) <= rows * cell * 1.12) candidates.push({ b, quad: widen(quadOf(b, ink, width), b, cols * cell, rows * cell), widened: true });
  }
  // A part left over inside a design already found is not a design of its own.
  candidates.sort((p, q) => q.b.ink - p.b.ink);
  const kept = [];
  for (const cand of candidates) {
    const [cx, cy] = centre(cand.quad);
    if (kept.some((k) => insideQuad(k.quad, cx, cy))) continue;
    kept.push(cand);
  }
  const found = kept.slice(0, 60).map((k) => {
    const xs = k.quad.map((p) => p[0]);
    const ys = k.quad.map((p) => p[1]);
    return { quad: k.quad, widened: k.widened, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  // A widened design is a guess; designs on a page usually line up, so take the top and
  // bottom (or left and right) from a design beside it (or above or below it) when there is one.
  for (const f of found.filter((x) => x.widened)) {
    const span = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.min(a1 - a0, b1 - b0);
    const sure = found.filter((x) => !x.widened);
    const beside = sure.find((x) => span(x.y0, x.y1, f.y0, f.y1) > 0.5 && Math.abs((x.y1 - x.y0) - (f.y1 - f.y0)) < (f.y1 - f.y0) * 0.2);
    const above = sure.find((x) => span(x.x0, x.x1, f.x0, f.x1) > 0.5 && Math.abs((x.x1 - x.x0) - (f.x1 - f.x0)) < (f.x1 - f.x0) * 0.2);
    if (beside) [f.y0, f.y1] = [beside.y0, beside.y1];
    if (above) [f.x0, f.x1] = [above.x0, above.x1];
    if (beside || above) f.quad = [[f.x0, f.y0], [f.x1, f.y0], [f.x1, f.y1], [f.x0, f.y1]];
  }

  // Reading order: group into rows of designs by their middles.
  found.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const lines = [];
  for (const b of found) {
    const mid = (b.y0 + b.y1) / 2;
    const line = lines.find((l) => Math.abs(l.mid - mid) < boxH(b) * 0.5);
    if (line) line.items.push(b);
    else lines.push({ mid, items: [b] });
  }
  return lines.flatMap((l) => l.items.sort((a, b) => a.x0 - b.x0)).map((f) => f.quad);
}

const centre = (quad) => [quad.reduce((s, p) => s + p[0], 0) / 4, quad.reduce((s, p) => s + p[1], 0) / 4];

/** Is point (x, y) inside a convex quad? */
export function insideQuad(quad, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const z = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(z) < 1e-9) continue;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Stretch a quad about its middle so that its box becomes w × h. */
function widen(quad, b, w, h) {
  const [cx, cy] = centre(quad);
  const sx = Math.max(1, w / boxW(b));
  const sy = Math.max(1, h / boxH(b));
  return quad.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}

/**
 * The four corners of a found design: its most extreme ink in each diagonal direction, which
 * follows a frame even when the photo is slanted. Without a frame, a white or split corner
 * square cuts a corner off; then (and for odd ink) the box is a better guess.
 */
function quadOf(b, ink, width) {
  const quad = [b.tl, b.tr, b.br, b.bl];
  const box = [[b.x0, b.y0], [b.x1 + 1, b.y0], [b.x1 + 1, b.y1 + 1], [b.x0, b.y1 + 1]];
  if (!isConvex(quad)) return box;
  return edgesInked(quad, ink, width) ? quad.map(([x, y]) => [x, y]) : box;
}

/** Is there ink all along the four sides of the quad (a frame, or dark outer squares)? */
function edgesInked(quad, ink, width) {
  const height = ink.length / width;
  const [cx, cy] = centre(quad);
  const inkNear = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const xi = Math.round(x) + dx;
        const yi = Math.round(y) + dy;
        if (xi >= 0 && yi >= 0 && xi < width && yi < height && ink[yi * width + xi]) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    let hits = 0;
    const n = 40;
    for (let k = 0; k < n; k += 1) {
      const t = 0.05 + (0.9 * (k + 0.5)) / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      // On the edge or a little inside it.
      if ([0, 0.008, 0.016, 0.025].some((f) => inkNear(x + (cx - x) * f, y + (cy - y) * f))) hits += 1;
    }
    if (hits < n * 0.85) return false;
  }
  return true;
}

export function isConvex(quad) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const [cx, cy] = quad[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** A quad for a design that was not found: a centred box with the tray's shape. */
export function defaultQuad(width, height, rows, cols) {
  const s = Math.min(width * 0.5 / cols, height * 0.5 / rows);
  const w = s * cols;
  const h = s * rows;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}
