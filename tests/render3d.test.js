import test from 'node:test';
import assert from 'node:assert/strict';

import { Board, defaultInventory } from '../src/board.js';
import { board3d, hitTest3d, makeCamera, nearTray3d } from '../src/render3d.js';
import { makeRng, randomArrangement } from '../src/solver.js';

const AZIMUTHS = [0, 45, 90, 135, 180, 225, 270, 315];
const centroid = (pts) => pts.reduce(([x, y], [px, py]) => [x + px / pts.length, y + py / pts.length], [0, 0]);

test('3D tap: bare floor gives the square and the spot on it, from every side; walls and the space around the tray give nothing', () => {
  const board = new Board(4, 4);
  for (const azimuth of AZIMUTHS) {
    const { hits } = board3d(board, { azimuth });
    const camera = makeCamera(azimuth, 50);
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.65], [0.65, 0.35]]) {
          const [x, y] = camera.project([c + fx, 4 - 1 - r + (1 - fy), 0.001]);
          const hit = hitTest3d(hits, x, y);
          const where = `square ${r},${c} at (${fx}, ${fy}) seen from ${azimuth}°`;
          assert.deepEqual([hit.r, hit.c, hit.id], [r, c, undefined], where);
          assert.ok(Math.abs(hit.fx - fx) < 1e-6 && Math.abs(hit.fy - fy) < 1e-6, `${where}: got (${hit.fx}, ${hit.fy})`);
        }
      }
    }
    assert.equal(hitTest3d(hits, 1e6, 1e6), null);
    const front = hits[hits.length - 1]; // drawn last: the wall nearest to the viewer
    assert.equal(front.tray, true);
    assert.equal(hitTest3d(hits, ...centroid(front.pts)), null, `front wall seen from ${azimuth}°`);
  }
});

test('3D tap: on a full tray, the top of every square finds the piece seen there from above', () => {
  // Points on top of a square, away from both diagonals (where two standing prisms meet).
  const spots = [[0.5, 0.2], [0.8, 0.5], [0.5, 0.8], [0.2, 0.5]];
  const rng = makeRng(42);
  for (const [rows, cols, split] of [[4, 4, 0.5], [4, 8, 0.8], [6, 6, 0.2]]) {
    const pieces = randomArrangement(rows, cols, defaultInventory(rows, cols), rng, split);
    const board = Board.fromJSON({ rows, cols, pieces });
    assert.ok(board.isComplete());
    for (const azimuth of AZIMUTHS) {
      const { hits } = board3d(board, { azimuth });
      const camera = makeCamera(azimuth, 50);
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          for (const [fx, fy] of spots) {
            const [x, y] = camera.project([c + fx, rows - 1 - r + (1 - fy), 1]);
            assert.deepEqual(
              hitTest3d(hits, x, y),
              { r, c, id: board.pieceAt(r, c, fx, fy) },
              `${rows}×${cols} tray, square ${r},${c} at (${fx}, ${fy}), seen from ${azimuth}°`,
            );
          }
        }
      }
    }
  }
});

test('3D tap: anywhere on a full tray except the walls, including the seams between pieces, finds a piece', () => {
  const rng = makeRng(5);
  const board = Board.fromJSON({ rows: 4, cols: 4, pieces: randomArrangement(4, 4, defaultInventory(4, 4), rng, 0.5) });
  for (const azimuth of AZIMUTHS) {
    const { hits } = board3d(board, { azimuth });
    const xs = hits.flatMap((h) => h.pts.map((p) => p[0]));
    const ys = hits.flatMap((h) => h.pts.map((p) => p[1]));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let taps = 0;
    for (let i = 0; i <= 120; i += 1) {
      for (let j = 0; j <= 120; j += 1) {
        const hit = hitTest3d(hits, x0 + ((x1 - x0) * i) / 120, y0 + ((y1 - y0) * j) / 120);
        if (!hit) continue;
        taps += 1;
        const id = hit.id ?? board.pieceAt(hit.r, hit.c, hit.fx, hit.fy);
        assert.ok(id > 0, `nothing found at square ${hit.r},${hit.c} (${hit.fx}, ${hit.fy}) seen from ${azimuth}°`);
      }
    }
    assert.ok(taps > 2000);
  }
});

test('3D view: the tray outline tells a touch on or near the tray from one in the empty space around it', () => {
  const board = Board.fromJSON({ rows: 4, cols: 4, pieces: randomArrangement(4, 4, defaultInventory(4, 4), makeRng(3), 0.5) });
  for (const azimuth of AZIMUTHS) {
    const { hits, outline } = board3d(board, { azimuth });
    for (const shape of hits) assert.ok(nearTray3d(outline, ...centroid(shape.pts)), `a drawn shape is off the outline at ${azimuth}°`);
    const xs = outline.map((p) => p[0]);
    const right = Math.max(...xs);
    const y = outline[xs.indexOf(right)][1];
    assert.equal(nearTray3d(outline, right + 0.2, y), false);
    assert.equal(nearTray3d(outline, right + 0.2, y, 0.25), true);
    assert.equal(nearTray3d(outline, 1e3, 1e3, 0.25), false);
  }
});
