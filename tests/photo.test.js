import test from 'node:test';
import assert from 'node:assert/strict';

import { Board, defaultInventory } from '../src/board.js';
import { LOOK } from '../src/geometry.js';
import { classifySquare, findPatterns, otsu, readPattern, squareToQuad, toGray } from '../src/photo.js';
import { makeRng, randomArrangement } from '../src/solver.js';

// Which colour (0 white, 1 black) a look shows at point (fx, fy) of its square.
function colourAt(look, fx, fy) {
  switch (look) {
    case LOOK.WHITE: return 0;
    case LOOK.BLACK: return 1;
    case LOOK.SLASH_WB: return fx + fy < 1 ? 0 : 1;
    case LOOK.SLASH_BW: return fx + fy < 1 ? 1 : 0;
    case LOOK.BACK_WB: return fx > fy ? 0 : 1;
    case LOOK.BACK_BW: return fx > fy ? 1 : 0;
    default: return 0;
  }
}

/** Draw designs on a light "page" with noise. style: 'framed' (frame + grid) or 'bare'. */
function drawPage(width, height, designs, { style = 'framed', seed = 1, paper = 236, ink = 28, captions = false } = {}) {
  const rng = makeRng(seed);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 1) data[i] = paper + Math.round((rng() - 0.5) * 24);
  for (const { quad, rows, cols, looks } of designs) {
    if (captions) {
      // A caption under the design ("Design 3"), close to its bottom-left corner.
      const [x, y] = quad[3];
      for (let dy = 8; dy < 15; dy += 1) for (let dx = 0; dx < 60; dx += (dx % 7 === 5 ? 3 : 1)) data[Math.round(y + dy) * width + Math.round(x + dx)] = ink;
    }
    const map = squareToQuad(quad);
    const side = Math.max(...quad.map((p) => p[0])) - Math.min(...quad.map((p) => p[0]));
    const steps = Math.ceil(side * 3);
    const stepsY = Math.ceil(steps * (rows / cols) * 1.2);
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= stepsY; j += 1) {
        const u = i / steps;
        const v = j / stepsY;
        const c = Math.min(cols - 1, Math.floor(u * cols));
        const r = Math.min(rows - 1, Math.floor(v * rows));
        const fx = u * cols - c;
        const fy = v * rows - r;
        let value;
        const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
        const outer = Math.min(u, 1 - u, v, 1 - v) * Math.min(cols, rows);
        if (style === 'framed' && outer < 0.04) value = ink;
        else if (style === 'framed' && edge < 0.02) value = 120;
        else if (style === 'bare' && edge < 0.03) value = paper;
        else value = colourAt(looks[r * cols + c], fx, fy) ? ink : 250;
        const [x, y] = map(u, v);
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi >= 0 && yi >= 0 && xi < width && yi < height) data[yi * width + xi] = Math.max(0, Math.min(255, value + Math.round((rng() - 0.5) * 30)));
      }
    }
  }
  return { width, height, data };
}

function randomLooks(rows, cols, seed, split = 0.7) {
  const pieces = randomArrangement(rows, cols, defaultInventory(rows, cols), makeRng(seed), split);
  return Board.fromJSON({ rows, cols, pieces }).looks();
}

/** A slightly turned and slanted quad around centre (cx, cy). */
function slantedQuad(cx, cy, w, h, angle, skew) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [[-w / 2, -h / 2], [w / 2 + skew, -h / 2], [w / 2, h / 2], [-w / 2 - skew, h / 2]]
    .map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}

function pageOf(rows, cols, count, perRow, size, opts) {
  const designs = [];
  const gap = size * 0.45;
  const w = size * (cols / Math.max(rows, cols)) * (cols > rows ? 1 : 1);
  const h = size * (rows / Math.max(rows, cols));
  const width = Math.round(perRow * (w + gap) + gap);
  const height = Math.round(Math.ceil(count / perRow) * (h + gap) + gap);
  for (let k = 0; k < count; k += 1) {
    const cx = gap + (k % perRow) * (w + gap) + w / 2;
    const cy = gap + Math.floor(k / perRow) * (h + gap) + h / 2;
    designs.push({ quad: slantedQuad(cx, cy, w, h, (k % 3 - 1) * 0.04, (k % 2) * 4), rows, cols, looks: randomLooks(rows, cols, 100 + k) });
  }
  return { img: drawPage(width, height, designs, opts), designs };
}

function wrongSquares(a, b) {
  return a.reduce((n, l, i) => n + (l !== b[i] ? 1 : 0), 0);
}

test('classifySquare tells the six looks apart', () => {
  assert.equal(classifySquare([0, 0, 0, 0]).look, LOOK.WHITE);
  assert.equal(classifySquare([1, 1, 1, 1]).look, LOOK.BLACK);
  assert.equal(classifySquare([0, 1, 1, 0]).look, LOOK.SLASH_WB);
  assert.equal(classifySquare([1, 0, 0, 1]).look, LOOK.SLASH_BW);
  assert.equal(classifySquare([0, 0, 1, 1]).look, LOOK.BACK_WB);
  assert.equal(classifySquare([1, 1, 0, 0]).look, LOOK.BACK_BW);
  assert.ok(classifySquare([0.5, 0.5, 0.5, 0.5]).margin < 1, 'a grey square is unsure');
});

test('squareToQuad maps the corners', () => {
  const quad = [[10, 20], [110, 25], [120, 140], [5, 130]];
  const map = squareToQuad(quad);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => {
    const [x, y] = map(u, v);
    assert.ok(Math.abs(x - quad[i][0]) < 1e-6 && Math.abs(y - quad[i][1]) < 1e-6);
  });
});

test('toGray and otsu split ink from paper', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 250, 250, 250, 255, 10, 10, 10, 255]);
  const img = toGray(rgba, 2, 2);
  assert.deepEqual([...img.data], [255, 0, 250, 10]);
  const t = otsu(img);
  assert.ok(t > 10 && t <= 250);
});

for (const style of ['framed', 'bare']) {
  test(`finds and reads every 4×4 design on a ${style} page`, () => {
    // Framed designs are found whole even with a caption right under them.
    const { img, designs } = pageOf(4, 4, 6, 3, 200, { style, captions: style === 'framed' });
    const threshold = otsu(img);
    const quads = findPatterns(img, { rows: 4, cols: 4, threshold });
    assert.equal(quads.length, designs.length, `found ${quads.length}`);
    quads.forEach((quad, k) => {
      const { looks } = readPattern(img, quad, 4, 4, threshold);
      // A bare design with white outer squares has no visible edge there, so its box is a guess.
      const wrong = wrongSquares(looks, designs[k].looks);
      if (style === 'framed') assert.equal(wrong, 0, `design ${k + 1}: ${wrong} squares wrong`);
      else assert.ok(wrong <= 4, `design ${k + 1}: ${wrong} squares wrong`);
    });
  });
}

test('finds 2:1 designs (4×8) and reads them', () => {
  const { img, designs } = pageOf(4, 8, 4, 2, 300, { style: 'framed', seed: 3 });
  const threshold = otsu(img);
  const quads = findPatterns(img, { rows: 4, cols: 8, threshold });
  assert.equal(quads.length, designs.length);
  quads.forEach((quad, k) => {
    assert.equal(wrongSquares(readPattern(img, quad, 4, 8, threshold).looks, designs[k].looks), 0, `design ${k + 1}`);
  });
});

test('readPattern with the exact corners reads a bare design exactly', () => {
  const { img, designs } = pageOf(6, 6, 2, 2, 260, { style: 'bare', seed: 5 });
  const threshold = otsu(img);
  designs.forEach((d, k) => {
    assert.equal(wrongSquares(readPattern(img, d.quad, 6, 6, threshold).looks, d.looks), 0, `design ${k + 1}`);
  });
});

test('finds and reads slanted 2×2, 6×6 and 8×8 designs on framed pages', () => {
  for (const n of [2, 6, 8]) {
    const { img, designs } = pageOf(n, n, 6, 3, 220, { style: 'framed', seed: n });
    const threshold = otsu(img);
    const quads = findPatterns(img, { rows: n, cols: n, threshold });
    assert.equal(quads.length, designs.length, `${n}×${n}: found ${quads.length}`);
    quads.forEach((quad, k) => {
      assert.equal(wrongSquares(readPattern(img, quad, n, n, threshold).looks, designs[k].looks), 0, `${n}×${n} design ${k + 1}`);
    });
  }
});
