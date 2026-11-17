// One way to build a picture, shown in 3D and put together piece by piece: first the pieces
// that lie on the floor, then the ones with a roof, so the ramps hidden under the roofs are
// seen going in. The view turns in 45° steps. Used by Packs (How to build it), Play alone
// (Show answer) and Play together (Show a solution).

import { Board, occupancy } from './board.js';
import { isCap, isRamp, isUpright } from './geometry.js';
import { board3d } from './render3d.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hasRoof = (p) => occupancy(p).some((part) => !part.cube && isCap(part.h));

/** The pieces in the order to put them in: on the floor first, roofs last; row by row. */
export function buildOrder(pieces) {
  return pieces.slice().sort((a, b) => Number(hasRoof(a)) - Number(hasRoof(b)) || a.r - b.r || a.c - b.c);
}

/** "White cube + prism, its prism lying as a roof", "Black prism, standing", ... */
export function describePiece(p) {
  const prism = occupancy(p).find((part) => !part.cube);
  const how = isUpright(prism.h) ? 'standing' : isRamp(prism.h) ? 'lying as a ramp' : 'lying as a roof';
  const color = p.color === 'W' ? 'White' : 'Black';
  return p.type === 'mix' ? `${color} cube + prism, its prism ${how}` : `${color} prism, ${how}`;
}

/**
 * The tray after the first `count` pieces of the order, and the id of the last one put in.
 * Falls back to the board's own order if a piece cannot go in where the order says.
 */
export function boardAfter(rows, cols, order, count) {
  const board = new Board(rows, cols);
  let last = 0;
  for (const p of order.slice(0, count)) {
    const res = board.place({ type: p.type, color: p.color, r: p.r, c: p.c, o: p.o });
    if (!res.ok) return null;
    last = res.id;
  }
  return { board, last };
}

const TURN_LEFT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/></svg>';
const TURN_RIGHT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

/**
 * A viewer that keeps its place (which step, which way it is turned) while the screen around
 * it is drawn again. One per screen is enough: a new solution starts from the whole picture.
 */
export function createSolutionView() {
  let key = '';
  let order = [];
  let step = 0; // pieces put in; order.length = the whole picture
  let azimuth = 0;
  let args = null;

  function markup(rows, cols, pieces) {
    args = [rows, cols, pieces];
    const k = `${rows}x${cols}:${pieces.map((p) => `${p.type}${p.color}${p.r},${p.c},${p.o}`).join(';')}`;
    if (k !== key) {
      key = k;
      order = buildOrder(pieces);
      step = order.length;
    }
    let shown = boardAfter(rows, cols, order, step);
    if (!shown) {
      // Not placeable in this order: show the whole picture as the solver gave it.
      order = pieces.slice();
      step = order.length;
      shown = boardAfter(rows, cols, order, step) ?? { board: Board.fromJSON({ rows, cols, pieces }), last: 0 };
    }
    const n = order.length;
    const whole = step >= n;
    const view = board3d(shown.board, { azimuth, selectedId: whole || step === 0 ? 0 : shown.last });
    const piece = !whole && step > 0 ? order[step - 1] : null;
    const caption = whole
      ? 'The whole picture. Build it piece by piece to see the pieces under the roofs go in.'
      : step === 0
        ? 'The empty tray.'
        : `${esc(describePiece(piece))}.${hasRoof(piece) ? '' : ' Pieces on the floor go in first; roofs last.'}`;
    return `<div class="sol" id="solView">
<svg viewBox="${view.viewBox}" class="sol-svg" role="img" aria-label="One way to build it, in 3D${whole ? '' : `, ${step} of ${n} pieces in`}">${view.markup}</svg>
<div class="sol-bar">
<button type="button" class="tool" data-action="sol-turn" data-dir="-1" title="Turn the view to the left">${TURN_LEFT}<span class="sr-only">Turn the view to the left</span></button>
<button type="button" class="tool" data-action="sol-turn" data-dir="1" title="Turn the view to the right">${TURN_RIGHT}<span class="sr-only">Turn the view to the right</span></button>
${whole
    ? `<button type="button" class="btn small primary" data-action="sol-start">Build it piece by piece</button>`
    : `<button type="button" class="btn small" data-action="sol-step" data-dir="-1" ${step <= 0 ? 'disabled' : ''}>Back</button>
<span class="sol-count">${step} of ${n}</span>
<button type="button" class="btn small primary" data-action="sol-step" data-dir="1">Next piece</button>
<button type="button" class="btn small" data-action="sol-whole">All</button>`}
</div>
<p class="sol-what" aria-live="polite">${caption}</p>
</div>`;
  }

  /** Draw the viewer again where it is on the page (after a button). */
  function refresh() {
    const el = typeof document !== 'undefined' ? document.getElementById('solView') : null;
    if (!el || !args) return;
    el.outerHTML = markup(...args);
  }

  const actions = {
    'sol-turn': (el) => {
      azimuth = (azimuth + 45 * Number(el.dataset.dir) + 360) % 360;
      refresh();
    },
    'sol-start': () => {
      step = order.length ? 1 : 0;
      refresh();
    },
    'sol-step': (el) => {
      step = Math.max(0, Math.min(order.length, step + Number(el.dataset.dir)));
      refresh();
    },
    'sol-whole': () => {
      step = order.length;
      refresh();
    },
  };

  return { markup, actions };
}
