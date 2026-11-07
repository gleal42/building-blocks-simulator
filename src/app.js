// The app: Build (with challenges), Check a picture, and Challenge book.

import { Board, KINDS, MAX_SIZE, decodeBoard, encodeBoard, pieceName, sizeProblem } from './board.js';
import { DIFFICULTY } from './book.js';
import { createBookUI } from './bookui.js';
import { LOOK, MIX_ORIENTS, flipMix, flipTri, isRamp, rotateMix, rotateTri, thickSide, tipMix, tipTri } from './geometry.js';
import { ICONS } from './icons.js';
import { PRESETS } from './presets.js';
import { boardMarkup, cellFromPoint, flatPicture, pictureMarkup } from './render2d.js';
import { board3d, pieceIcon } from './render3d.js';
import { makeRng, quickCheck, randomArrangement, solvePattern } from './solver.js';

const STORAGE_KEY = 'building-blocks-simulator:v2';
const OLD_STORAGE_KEY = 'building-blocks-simulator:v1';
const MAX_HISTORY = 300;
const CHECK_BUDGET = 1500000;
const LONG_CHECK_BUDGET = 8000000;
// Random challenges: how often pieces stand up, and the share of split squares to aim for.
const LEVEL_SPLIT = [0, 0.12, 0.45, 0.85];
const LEVEL_TARGET = [0, 0.08, 0.25, 0.42];

export const KIND_INFO = {
  mixW: { type: 'mix', color: 'W', label: 'White cube + prism' },
  mixB: { type: 'mix', color: 'B', label: 'Black cube + prism' },
  triW: { type: 'tri', color: 'W', label: 'White prism' },
  triB: { type: 'tri', color: 'B', label: 'Black prism' },
};

const DIR_WORD = ['up', 'right', 'down', 'left'];
const CORNER_WORD = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const SIDE_WORD = ['top', 'right', 'bottom', 'left'];
const ARROW = ['↑', '→', '↓', '←'];

const PALETTE = [
  { look: LOOK.WHITE, label: 'White' },
  { look: LOOK.BLACK, label: 'Black' },
  { look: LOOK.SLASH_WB, label: 'Split, white top-left' },
  { look: LOOK.SLASH_BW, label: 'Split, black top-left' },
  { look: LOOK.BACK_WB, label: 'Split, white top-right' },
  { look: LOOK.BACK_BW, label: 'Split, black top-right' },
  { look: LOOK.ANY, label: 'Erase (any)' },
];

// ---- State -------------------------------------------------------------------------------

class History {
  constructor() {
    this.past = [];
    this.future = [];
  }

  record(board) {
    this.past.push(encodeBoard(board));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  undo(board) {
    if (!this.past.length) return null;
    this.future.push(encodeBoard(board));
    return decodeBoard(this.past.pop());
  }

  redo(board) {
    if (!this.future.length) return null;
    this.past.push(encodeBoard(board));
    return decodeBoard(this.future.pop());
  }
}

let state;
let bookUI;
const pointer = { down: false, id: null, type: 'mouse', erase: false };
let statusTimer = 0;
let saveTimer = 0;

const finePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

function defaultState() {
  const photo = PRESETS[0];
  return {
    mode: 'build',
    rows: photo.rows,
    cols: photo.cols,
    sizeDraft: { rows: photo.rows, cols: photo.cols },
    build: Board.fromJSON(photo),
    history: new History(),
    challenge: null,
    pattern: [LOOK.WHITE, LOOK.SLASH_WB, LOOK.BACK_WB, LOOK.WHITE, LOOK.SLASH_WB, LOOK.BLACK, LOOK.BLACK, LOOK.BACK_WB, LOOK.BACK_BW, LOOK.BLACK, LOOK.BLACK, LOOK.SLASH_BW, LOOK.WHITE, LOOK.BACK_BW, LOOK.SLASH_BW, LOOK.WHITE],
    paint: LOOK.BLACK,
    check: { status: 'idle' },
    selected: 'mixW',
    orient: { mix: 4, tri: 3 },
    tool: 'place',
    xray: false,
    view: 'top',
    azimuth: 0,
    hover: null,
    hoverCell: -1,
    fresh: new Set(),
    books: {},
    bookKey: 'square-4',
    bookView: '3d',
    bookLeaf: 0,
  };
}

function snapshot() {
  return {
    v: 2,
    mode: state.mode,
    rows: state.rows,
    cols: state.cols,
    build: encodeBoard(state.build),
    challenge: state.challenge,
    pattern: state.pattern,
    paint: state.paint,
    selected: state.selected,
    orient: state.orient,
    xray: state.xray,
    books: state.books,
    bookKey: state.bookKey,
    bookView: state.bookView,
  };
}

function restore(data) {
  const base = defaultState();
  if (!data || (data.v !== 1 && data.v !== 2)) return base;
  try {
    const { rows, cols } = data;
    if (sizeProblem(rows, cols)) return base;
    const build = decodeBoard(data.build);
    if (build.rows !== rows || build.cols !== cols) return base;
    const pattern = Array.isArray(data.pattern) && data.pattern.length === rows * cols ? data.pattern.map(Number) : new Array(rows * cols).fill(LOOK.ANY);
    const ch = data.v === 2 ? data.challenge : null;
    const challenge = ch && Array.isArray(ch.target) && ch.target.length === rows * cols ? ch : null;
    return {
      ...base,
      mode: ['build', 'check', 'book'].includes(data.mode) ? data.mode : 'build',
      rows,
      cols,
      sizeDraft: { rows, cols },
      build,
      challenge,
      pattern,
      paint: Number.isInteger(data.paint) ? data.paint : LOOK.BLACK,
      selected: KINDS.includes(data.selected) ? data.selected : 'mixW',
      orient: {
        mix: Number.isInteger(data.orient?.mix) ? data.orient.mix % 16 : 4,
        tri: Number.isInteger(data.orient?.tri) ? data.orient.tri % 12 : 3,
      },
      xray: !!data.xray,
      books: data.books && typeof data.books === 'object' ? data.books : {},
      bookKey: typeof data.bookKey === 'string' ? data.bookKey : base.bookKey,
      bookView: ['3d', 'spreads', 'sheets'].includes(data.bookView) ? data.bookView : '3d',
    };
  } catch {
    return base;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch {
      // Storage can be missing or full (large cover pictures); the app works without it.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot(), books: {} }));
      } catch {
        /* ignore */
      }
    }
  }, 300);
}

// ---- Words -------------------------------------------------------------------------------

function describeOrientation(type, o) {
  if (type === 'mix') {
    const m = MIX_ORIENTS[o];
    const where = `prism ${m.dir === 0 || m.dir === 2 ? DIR_WORD[m.dir] : `to the ${DIR_WORD[m.dir]}`}`;
    if (m.pose === 2) return `Lying, ${where} as a ramp (slope up)`;
    if (m.pose === 3) return `Lying, ${where} as a roof (slope down, hollow underneath)`;
    return `Standing, ${where}, right angle ${CORNER_WORD[m.half]}`;
  }
  if (o < 4) return `Standing, right angle ${CORNER_WORD[o]}`;
  if (isRamp(o)) return `Lying as a ramp, high side ${SIDE_WORD[thickSide(o)]}`;
  return `Lying as a roof, thick side ${SIDE_WORD[thickSide(o)]} (goes on a ramp)`;
}

function failureText(res, piece) {
  const name = pieceName(piece);
  switch (res.code) {
    case 'none-left':
      return `No ${name} left. Remove one from the tray or choose another piece.`;
    case 'outside':
      return piece.type === 'mix' ? 'The prism part would stick out of the tray. Rotate the piece or pick another square.' : 'That is outside the tray.';
    case 'taken':
      return `That square is already full. ${finePointer() ? 'Right-click a piece to remove it.' : 'Turn on Remove to take a piece out.'}`;
    case 'clash':
      return 'Only the matching half fits next to the piece already in that square.';
    case 'needs-ramp':
      return 'A prism lying slope-down needs a ramp under it. Put a ramp in that square first.';
    default:
      return 'That does not fit.';
  }
}

function progressText() {
  const board = state.build;
  const placed = board.pieces.size;
  const total = board.totalPieces();
  const hollow = board.hollowCells().length;
  let text = placed === total ? `Tray full: all ${total} pieces placed.` : `${placed} of ${total} pieces placed.`;
  if (hollow) text += ` ${hollow} roof${hollow > 1 ? 's have' : ' has'} a hollow underneath.`;
  return text;
}

export function starsHtml(level, { label = true } = {}) {
  const d = DIFFICULTY[level];
  const stars = [1, 2, 3].map((k) => `<span class="star${k <= level ? ' on' : ''}">★</span>`).join('');
  return `<span class="stars level-${level}" title="${d.name}"><span aria-hidden="true">${stars}</span>${label ? `<span class="stars-name">${d.name}</span>` : `<span class="sr-only">${d.name}</span>`}</span>`;
}

// ---- Rendering ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function render() {
  renderTabs();
  renderStage();
  renderPanel();
  if (!statusTimer) setStatus(defaultStatus(), false);
  scheduleSave();
}

function renderTabs() {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    const on = tab.dataset.tab === state.mode;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
  });
  document.body.dataset.mode = state.mode;
}

function renderStage() {
  const book = state.mode === 'book';
  $('#boardWrap').hidden = book;
  $('#bookStage').hidden = !book;
  if (book) {
    bookUI.renderStage($('#bookStage'));
    $('#stageTop').innerHTML = '';
    $('#stageBar').innerHTML = '';
    $('#status').hidden = true;
    return;
  }
  $('#status').hidden = false;
  renderStageTop();
  renderBoard();
  renderStageBar();
}

function renderStageTop() {
  const top = $('#stageTop');
  const ch = state.challenge;
  if (state.mode !== 'build' || !ch) {
    top.innerHTML = '';
    return;
  }
  const prog = challengeProgress();
  const status = ch.solved
    ? `<p class="win">${ch.revealed ? 'Answer shown.' : `Solved in ${ch.moves} moves!`}</p>`
    : `<p><b>${prog.match}</b> of ${prog.total} squares match · ${ch.moves} moves</p>`;
  top.innerHTML = `<div class="challenge-bar">
<div class="challenge-pic">${flatPicture(state.rows, state.cols, ch.target, { cell: 18, gap: 1.6, mismatches: prog.mismatch })}</div>
<div class="challenge-info"><p class="challenge-title">${ch.label ?? 'Challenge'} ${starsHtml(ch.difficulty)}</p>${status}
<div class="row-buttons">${ch.solved ? `<button type="button" class="btn small primary" data-action="next-challenge">${ICONS.dice}Next challenge</button>` : ch.answer ? `<button type="button" class="btn small" data-action="reveal">Show answer</button>` : ''}<button type="button" class="btn small" data-action="stop-challenge">End challenge</button></div></div>
</div>`;
}

function renderBoard() {
  const svg = $('#board');
  let view;
  if (state.mode === 'check') {
    view = pictureMarkup(state.rows, state.cols, state.pattern, { hoverCell: state.hoverCell });
    svg.setAttribute('aria-label', `Picture to check, ${state.rows} by ${state.cols}.`);
  } else {
    const board = state.build;
    let ghost = null;
    let hoverId = 0;
    if (state.hover) {
      if (state.tool === 'place' && state.selected) {
        const piece = currentPiece(state.hover.r, state.hover.c);
        ghost = { piece, ok: board.check(piece).ok };
      } else {
        hoverId = state.hover.id ?? board.pieceAt(state.hover.r, state.hover.c, state.hover.fx, state.hover.fy);
      }
    }
    if (state.view === '3d') view = board3d(board, { azimuth: state.azimuth, ghost, hoverId });
    else view = boardMarkup(board, { xray: state.xray, ghost, hoverId, freshIds: state.fresh });
    svg.setAttribute('aria-label', `Tray, ${state.rows} rows by ${state.cols} columns${state.view === '3d' ? ', 3D view' : ''}. ${progressText()}`);
  }
  svg.setAttribute('viewBox', view.viewBox);
  svg.innerHTML = view.markup;
  svg.classList.toggle('is-3d', state.mode === 'build' && state.view === '3d');
  svg.classList.toggle('is-remove', state.mode === 'build' && state.tool === 'remove');
  $('#viewTurn').hidden = !(state.mode === 'build' && state.view === '3d');
  state.fresh = new Set();
}

function toolButton(action, icon, label, { pressed = null, disabled = false, hint = '', cls = '' } = {}) {
  const aria = pressed === null ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`;
  return `<button type="button" class="tool${cls ? ` ${cls}` : ''}" data-action="${action}"${aria}${disabled ? ' disabled' : ''} title="${hint || label}">${icon}<span>${label}</span></button>`;
}

function renderStageBar() {
  const bar = $('#stageBar');
  if (state.mode === 'check') {
    bar.innerHTML = `<div class="check-result" id="checkResult" aria-live="polite">${checkResultMarkup()}</div>
<div class="palette" role="group" aria-label="Paint">${PALETTE.map(({ look, label }) => {
      const on = state.paint === look;
      return `<button type="button" class="swatch-btn${on ? ' is-on' : ''}" data-action="paint" data-look="${look}" aria-pressed="${on}" title="${label}">${flatPicture(1, 1, [look], { cell: 26, gap: 0 })}<span>${label}</span></button>`;
    }).join('')}</div>
<p class="hint">${finePointer() ? '<b>Left-click</b> paints a square, <b>right-click</b> erases it. Drag to paint several.' : 'Tap or drag to paint. Choose <b>Erase</b> to clear squares.'}</p>`;
    return;
  }
  const board = state.build;
  const kinds = KINDS.map((kind, i) => {
    const info = KIND_INFO[kind];
    const left = board.remaining(kind);
    const on = state.selected === kind && state.tool === 'place';
    return `<button type="button" class="kind${on ? ' is-on' : ''}${left === 0 ? ' is-empty' : ''}" data-action="select" data-kind="${kind}" aria-pressed="${on}" title="${info.label} (key ${i + 1})" aria-label="${info.label}, ${left} left">
<span class="kind-icon">${pieceIcon(info.type, info.color, state.orient[info.type], { size: info.type === 'mix' ? 44 : 30 })}</span><span class="kind-count">${left}</span></button>`;
  }).join('');
  const noPiece = !state.selected || state.tool !== 'place';
  const hist = state.history;
  bar.innerHTML = `<div class="dock">
<div class="dock-kinds" role="group" aria-label="Choose a piece">${kinds}</div>
<div class="dock-turn" role="group" aria-label="Turn the piece">
${toolButton('turn', ICONS.rotate, 'Rotate', { disabled: noPiece, hint: 'Rotate the piece a quarter turn (R)', cls: 'turn' })}
${toolButton('flip', ICONS.flip, 'Flip', { disabled: noPiece, hint: 'Turn the piece upside down (F)', cls: 'turn' })}
${toolButton('tip', ICONS.tip, 'Tip over', { disabled: noPiece, hint: 'Stand the piece up or lay it down (T)', cls: 'turn' })}
</div>
</div>
<div class="tools">
${toolButton('undo', ICONS.undo, 'Undo', { disabled: !hist.past.length, hint: 'Undo (Ctrl+Z)' })}
${toolButton('redo', ICONS.redo, 'Redo', { disabled: !hist.future.length, hint: 'Redo (Ctrl+Y)' })}
${toolButton('remove', ICONS.hand, 'Remove', { pressed: state.tool === 'remove', hint: 'Remove pieces with a tap or click (P)' })}
${toolButton('xray', ICONS.xray, 'X-ray', { pressed: state.xray, disabled: state.view === '3d', hint: 'See pieces hidden under roofs (X)' })}
${toolButton('view', state.view === '3d' ? ICONS.board : ICONS.cube, state.view === '3d' ? 'Top view' : '3D', { hint: 'Switch between the top view and the 3D view (V)' })}
</div>
<p class="hint">${finePointer()
    ? '<b>Left-click</b> places the piece (its cube goes where you click). <b>Right-click</b> removes a piece.'
    : 'Tap a square to place the piece (its cube goes there). To take pieces out, turn on <b>Remove</b> and tap them.'}</p>`;
}

function orientMarkup() {
  if (!state.selected) return '<p class="muted">Choose a piece under the tray to see every way it can be turned.</p>';
  const info = KIND_INFO[state.selected];
  const cur = state.orient[info.type];
  const button = (o, size) => {
    const on = o === cur;
    return `<button type="button" class="orient${on ? ' is-on' : ''}" data-action="orient" data-o="${o}" aria-pressed="${on}" aria-label="${describeOrientation(info.type, o)}" title="${describeOrientation(info.type, o)}">${pieceIcon(info.type, info.color, o, { size })}</button>`;
  };
  let grid = '';
  if (info.type === 'mix') {
    const rows = ['Standing', 'Standing, mirrored', 'Lying, slope up', 'Lying, slope down'];
    const dirs = [1, 2, 3, 0];
    grid += `<div class="orient-head"><span></span>${dirs.map((d) => `<span title="Prism points ${DIR_WORD[d]}">${ARROW[d]}</span>`).join('')}</div>`;
    rows.forEach((label, pose) => {
      grid += `<div class="orient-row"><span class="orient-label">${label}</span>${dirs.map((d) => button(d * 4 + pose, 54)).join('')}</div>`;
    });
  } else {
    const rows = [['Standing', [0, 1, 2, 3]], ['Lying, slope up', [4, 5, 6, 7]], ['Lying, slope down', [8, 9, 10, 11]]];
    for (const [label, list] of rows) grid += `<div class="orient-row"><span class="orient-label">${label}</span>${list.map((o) => button(o, 44)).join('')}</div>`;
  }
  return `<div class="orient-grid ${info.type}">${grid}</div><p class="orient-now">${info.label}: ${describeOrientation(info.type, cur).toLowerCase()}</p>`;
}

function sizeMarkup() {
  const d = state.sizeDraft;
  const problem = sizeProblem(d.rows, d.cols);
  const changed = d.rows !== state.rows || d.cols !== state.cols;
  const stepper = (key, label) => `<div class="stepper"><span class="stepper-label" id="lbl-${key}">${label}</span>
<button type="button" data-action="size-dec" data-key="${key}" aria-label="Fewer ${label.toLowerCase()}" ${d[key] <= 1 ? 'disabled' : ''}>−</button>
<output aria-labelledby="lbl-${key}">${d[key]}</output>
<button type="button" data-action="size-inc" data-key="${key}" aria-label="More ${label.toLowerCase()}" ${d[key] >= MAX_SIZE ? 'disabled' : ''}>+</button></div>`;
  const n = d.rows * d.cols;
  const note = problem
    ? `<p class="size-note is-bad">${problem}</p>`
    : `<p class="size-note">${n} squares: ${n / 4} of each piece (cube + prism and prism, in white and black).</p>`;
  const quick = [[4, 4], [8, 4], [4, 8], [6, 6], [8, 8]]
    .map(([r, c]) => `<button type="button" class="chip${r === state.rows && c === state.cols ? ' is-on' : ''}" data-action="quick-size" data-rows="${r}" data-cols="${c}">${r}×${c}</button>`)
    .join('');
  return `<div class="size-row">${stepper('rows', 'Rows')}${stepper('cols', 'Columns')}
<button type="button" class="btn" data-action="apply-size" ${!problem && changed ? '' : 'disabled'}>Use ${d.rows}×${d.cols}</button></div>
${note}<div class="chips" role="group" aria-label="Common sizes">${quick}</div>`;
}

function buildPanel() {
  const ch = state.challenge;
  const levels = [1, 2, 3]
    .map((level) => `<button type="button" class="btn level level-${level}" data-action="new-challenge" data-level="${level}">${starsHtml(level)}</button>`)
    .join('');
  const challengeCard = ch
    ? ''
    : `<section class="card" aria-labelledby="ch-h">
<h2 id="ch-h">Play a challenge</h2>
<p class="muted">Get a picture made from a real arrangement of the pieces and rebuild it in the tray.</p>
<div class="row-buttons">${levels}</div>
</section>`;
  const presets = PRESETS.map((p) => `<button type="button" class="chip" data-action="preset" data-id="${p.id}">${p.name}</button>`).join('');
  return `${challengeCard}
<section class="card" aria-labelledby="turn-h">
<h2 id="turn-h">Every way to turn the piece</h2>
${orientMarkup()}
</section>
<section class="card" aria-labelledby="tray-h">
<h2 id="tray-h">Tray</h2>
${sizeMarkup()}
<div class="chips" role="group" aria-label="Fill the tray">${presets}
<button type="button" class="chip" data-action="random-fill">${ICONS.dice}Random fill</button>
<button type="button" class="chip" data-action="clear-board">${ICONS.trash}Empty tray</button></div>
<details class="share"><summary>Board code (save or share a layout)</summary>
<div class="code-row"><label class="sr-only" for="codeOut">Code of the tray</label><input id="codeOut" readonly value="${encodeBoard(state.build)}"><button type="button" class="btn" data-action="copy-code">${ICONS.copy}Copy</button></div>
<div class="code-row"><label class="sr-only" for="codeIn">Paste a board code</label><input id="codeIn" placeholder="Paste a code like 4x4:…" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-action="load-code">Load</button></div>
</details>
</section>`;
}

function checkPanel() {
  const book = bookUI.currentBook();
  const { rows, cols } = bookUI.bookTraySize();
  const sameSize = rows === state.rows && cols === state.cols;
  return `<section class="card" aria-labelledby="start-h">
<h2 id="start-h">Start from</h2>
<div class="chips" role="group" aria-label="Start from">
<button type="button" class="chip" data-action="from-build">${ICONS.copy}The Build tray</button>
<button type="button" class="chip" data-action="random-picture">${ICONS.dice}A random possible picture</button>
<button type="button" class="chip" data-action="clear-picture">${ICONS.trash}An empty picture</button></div>
</section>
<section class="card" aria-labelledby="addbook-h">
<h2 id="addbook-h">Challenge book</h2>
<p class="muted">${sameSize
    ? `When the picture is possible you can add it to your ${rows}×${cols} book “${escapeHtml(book.title)}” (${book.challenges.length} challenge${book.challenges.length === 1 ? '' : 's'} so far).`
    : `Your current book is for ${rows}×${cols} trays. Switch the tray to ${rows}×${cols} below, or pick another book in the Challenge book tab.`}</p>
<button type="button" class="btn" data-action="add-picture-to-book" ${canAddPicture() ? '' : 'disabled'}>${ICONS.book}Add this picture to the book</button>
${sameSize && state.pattern.includes(LOOK.ANY) ? '<p class="hint">Paint every square (no “any”) to add the picture.</p>' : ''}
</section>
<section class="card" aria-labelledby="tray2-h">
<h2 id="tray2-h">Tray size</h2>
${sizeMarkup()}
</section>`;
}

function renderPanel() {
  const panel = $('#panel');
  const focused = document.activeElement && panel.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  const openDetails = panel.querySelector('details[open]') !== null;
  if (state.mode === 'book') panel.innerHTML = bookUI.panelMarkup();
  else panel.innerHTML = state.mode === 'check' ? checkPanel() : buildPanel();
  if (openDetails) panel.querySelector('details')?.setAttribute('open', '');
  if (focused) panel.querySelector(focused)?.focus({ preventScroll: true });
}

function focusKey(el) {
  if (el.id) return `#${el.id}`;
  const action = el.dataset.action;
  if (!action) return null;
  const extra = ['kind', 'o', 'look', 'key', 'id', 'level', 'rows', 'index'].map((k) => (el.dataset[k] !== undefined ? `[data-${k}="${el.dataset[k]}"]` : '')).join('');
  return `[data-action="${action}"]${extra}`;
}

function defaultStatus() {
  if (state.mode === 'check') return '';
  if (state.view === '3d' && state.tool !== 'remove' && state.selected) {
    const info = KIND_INFO[state.selected];
    return `3D view. ${info.label}: ${describeOrientation(info.type, state.orient[info.type]).toLowerCase()}. ${progressText()}`;
  }
  if (state.tool === 'remove') return `Remove: ${finePointer() ? 'click' : 'tap'} a piece to take it out. ${progressText()}`;
  if (!state.selected) return `Choose a piece. ${progressText()}`;
  const info = KIND_INFO[state.selected];
  return `${info.label}: ${describeOrientation(info.type, state.orient[info.type]).toLowerCase()}. ${progressText()}`;
}

function resetStatus() {
  clearTimeout(statusTimer);
  statusTimer = 0;
}

function setStatus(text, transient = true, tone = '') {
  const el = $('#status');
  el.textContent = text;
  el.dataset.tone = tone;
  resetStatus();
  if (transient) {
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      setStatus(defaultStatus(), false);
    }, 4500);
  }
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- Build actions -----------------------------------------------------------------------

function currentPiece(r, c) {
  const info = KIND_INFO[state.selected];
  return { type: info.type, color: info.color, r, c, o: state.orient[info.type] };
}

function placeAt(h) {
  const board = state.build;
  const piece = currentPiece(h.r, h.c);
  const res = board.check(piece);
  if (!res.ok) {
    setStatus(failureText(res, piece), true, 'bad');
    pulseBoard();
    return;
  }
  state.history.record(board);
  const placed = board.place(piece);
  state.fresh = new Set([placed.id]);
  afterMove();
  if (board.remaining(state.selected) === 0) {
    const next = KINDS.find((k) => KIND_INFO[k].type === KIND_INFO[state.selected].type && board.remaining(k) > 0)
      ?? KINDS.find((k) => board.remaining(k) > 0);
    if (next) {
      setStatus(`That was the last ${pieceName(piece)}. Switched to the ${KIND_INFO[next].label.toLowerCase()}.`);
      state.selected = next;
    }
  }
  render();
}

function removeAt(h) {
  const board = state.build;
  const id = h.id ?? board.pieceAt(h.r, h.c, h.fx ?? 0.5, h.fy ?? 0.5);
  if (!id) {
    setStatus('Nothing to remove there.', true);
    return;
  }
  const piece = board.pieces.get(id);
  state.history.record(board);
  const removed = board.remove(id);
  afterMove();
  setStatus(removed.length > 1 ? `Removed the ${pieceName(piece)} and the prism resting on it.` : `Removed the ${pieceName(piece)}.`);
  state.hover = null;
  render();
}

function pulseBoard() {
  const wrap = $('#boardWrap');
  wrap.classList.remove('is-shake');
  void wrap.offsetWidth;
  wrap.classList.add('is-shake');
}

function undo() {
  const board = state.history.undo(state.build);
  if (!board) return;
  state.build = board;
  afterMove(false);
  render();
}

function redo() {
  const board = state.history.redo(state.build);
  if (!board) return;
  state.build = board;
  afterMove(false);
  render();
}

function changeOrientation(fn) {
  if (!state.selected) return;
  const type = KIND_INFO[state.selected].type;
  state.orient[type] = fn(type, state.orient[type]);
  state.tool = 'place';
  resetStatus();
  render();
}

const turn = () => changeOrientation((type, o) => (type === 'mix' ? rotateMix(o) : rotateTri(o)));
const flip = () => changeOrientation((type, o) => (type === 'mix' ? flipMix(o) : flipTri(o)));
const tip = () => changeOrientation((type, o) => (type === 'mix' ? tipMix(o) : tipTri(o)));

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  state.hover = null;
  state.hoverCell = -1;
  resetStatus();
  if (mode === 'check') scheduleCheck(0);
  render();
}

function emptyPicture(rows, cols) {
  return new Array(rows * cols).fill(LOOK.ANY);
}

/** Switch to a new tray size; asks first when that would throw work away. */
async function setSize(rows, cols, { ask = true } = {}) {
  const problem = sizeProblem(rows, cols);
  if (problem) {
    setStatus(problem, true, 'bad');
    return false;
  }
  if (rows === state.rows && cols === state.cols) return true;
  const busy = state.build.pieces.size || state.pattern.some((l) => l !== LOOK.ANY);
  if (ask && busy && !(await confirmDialog(`Use a ${rows}×${cols} tray? The pieces in the tray and the painted picture will be cleared.`, `Use ${rows}×${cols}`))) return false;
  state.rows = rows;
  state.cols = cols;
  state.sizeDraft = { rows, cols };
  state.build = new Board(rows, cols);
  state.history = new History();
  state.challenge = null;
  state.pattern = emptyPicture(rows, cols);
  state.check = { status: 'idle' };
  render();
  setStatus(`New ${rows}×${cols} tray with ${(rows * cols) / 4} of each piece.`);
  return true;
}

function loadPieces(pieces, rows, cols) {
  const board = new Board(rows, cols);
  for (const p of pieces) {
    const res = board.place(p);
    if (!res.ok) throw new Error(`Could not place ${pieceName(p)}: ${res.code}`);
  }
  return board;
}

async function usePreset(id) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return;
  if (preset.rows !== state.rows || preset.cols !== state.cols) {
    if (!(await setSize(preset.rows, preset.cols))) return;
  }
  state.history.record(state.build);
  state.build = Board.fromJSON(preset);
  state.challenge = null;
  render();
  setStatus(`Loaded ${preset.name}: each cube + prism lies as a ramp with a prism on top, so every square looks full.`);
}

function randomFill() {
  state.history.record(state.build);
  const pieces = randomArrangement(state.rows, state.cols, state.build.inventory, makeRng(Date.now() >>> 0), 0.5);
  state.build = loadPieces(pieces, state.rows, state.cols);
  afterMove();
  render();
  setStatus('Filled the tray with a random arrangement.');
}

async function clearBoard() {
  if (!state.build.pieces.size) return;
  if (!(await confirmDialog('Take every piece out of the tray?', 'Empty tray'))) return;
  state.history.record(state.build);
  state.build = new Board(state.rows, state.cols);
  afterMove(false);
  render();
  setStatus('The tray is empty. Undo brings the pieces back.');
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${what} copied.`);
    return true;
  } catch {
    setStatus(`Could not copy the ${what.toLowerCase()} here.`, true, 'bad');
    return false;
  }
}

function loadCode() {
  const text = $('#codeIn')?.value ?? '';
  try {
    const board = decodeBoard(text);
    if (board.rows !== state.rows || board.cols !== state.cols) {
      state.rows = board.rows;
      state.cols = board.cols;
      state.sizeDraft = { rows: board.rows, cols: board.cols };
      state.pattern = emptyPicture(board.rows, board.cols);
      state.check = { status: 'idle' };
      state.history = new History();
    } else {
      state.history.record(state.build);
    }
    state.build = board;
    state.challenge = null;
    state.mode = 'build';
    render();
    setStatus('Loaded the board code.');
  } catch (err) {
    setStatus(err.message, true, 'bad');
  }
}

// ---- Challenges --------------------------------------------------------------------------

function randomChallenge(rows, cols, level, rng = makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0)) {
  const inventory = new Board(rows, cols).inventory;
  const want = LEVEL_TARGET[level] * rows * cols;
  let best = null;
  for (let k = 0; k < 10; k += 1) {
    const pieces = randomArrangement(rows, cols, inventory, rng, LEVEL_SPLIT[level]);
    const looks = loadPieces(pieces, rows, cols).looks();
    const score = Math.abs(looks.filter((l) => l >= 3).length - want);
    if (!best || score < best.score) best = { pieces, looks, score };
  }
  return { target: best.looks, answer: best.pieces };
}

/** Start a challenge in the Build tray. */
async function startChallenge({ target, answer, difficulty, label, rows = state.rows, cols = state.cols }) {
  if (rows !== state.rows || cols !== state.cols) {
    if (!(await setSize(rows, cols))) return false;
  } else if (state.build.pieces.size && !state.challenge) {
    if (!(await confirmDialog('Start the challenge? The tray will be emptied first (Undo brings your pieces back).', 'Start'))) return false;
  }
  state.history.record(state.build);
  state.build = new Board(rows, cols);
  state.challenge = { target, answer, difficulty, label, moves: 0, solved: false, revealed: false };
  state.mode = 'build';
  state.tool = 'place';
  render();
  setStatus('Fill the tray so that, seen from above, it looks like the picture.');
  return true;
}

function newChallenge(level) {
  const { target, answer } = randomChallenge(state.rows, state.cols, level);
  startChallenge({ target, answer, difficulty: level, label: 'Challenge' });
}

function challengeProgress() {
  const { target } = state.challenge;
  const looks = state.build.looks();
  let match = 0;
  // Only squares that are full but show the wrong look count as mistakes.
  const mismatch = looks.map((l, i) => {
    const ok = l >= 0 && (target[i] === LOOK.ANY || l === target[i]);
    if (ok) match += 1;
    return l >= 0 && !ok;
  });
  return { match, total: looks.length, mismatch };
}

function afterMove(countMove = true) {
  const ch = state.challenge;
  if (!ch || ch.solved) return;
  if (countMove) ch.moves += 1;
  const prog = challengeProgress();
  if (prog.match === prog.total && state.build.isComplete()) {
    ch.solved = true;
    setTimeout(() => setStatus(`Solved in ${ch.moves} moves!`, true, 'ok'), 0);
    const wrap = $('#boardWrap');
    wrap.classList.remove('is-win');
    void wrap.offsetWidth;
    wrap.classList.add('is-win');
  }
}

async function revealAnswer() {
  const ch = state.challenge;
  if (!ch?.answer) return;
  if (!ch.solved && !(await confirmDialog('Show the answer? The pieces in the tray will be replaced.', 'Show answer'))) return;
  state.history.record(state.build);
  state.build = loadPieces(ch.answer, state.rows, state.cols);
  ch.revealed = true;
  ch.solved = true;
  render();
  setStatus('This is the arrangement the picture was made from. Turn on X-ray to see the pieces under roofs.');
}

// ---- Check a picture ---------------------------------------------------------------------

let worker = null;
let workerBroken = false;
let pendingCheck = null;
let checkSeq = 0;
let checkTimer = 0;
let spinnerTimer = 0;

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    // eslint-disable-next-line no-undef
    const source = typeof __WORKER_SOURCE__ === 'string' ? __WORKER_SOURCE__ : null;
    if (!source) throw new Error('no worker source');
    worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = (event) => {
      if (pendingCheck && event.data.id === pendingCheck.id) {
        const { resolve } = pendingCheck;
        pendingCheck = null;
        resolve(event.data.result);
      }
    };
    worker.onerror = () => {
      workerBroken = true;
      worker = null;
      if (pendingCheck) {
        const { resolve, args } = pendingCheck;
        pendingCheck = null;
        resolve(solvePattern(...args));
      }
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function stopWorker() {
  if (pendingCheck && worker) {
    worker.terminate();
    worker = null;
  }
  pendingCheck = null;
}

function runSolver(rows, cols, looks, inventory, maxNodes) {
  const args = [rows, cols, looks, inventory, { maxNodes }];
  stopWorker();
  const w = getWorker();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(solvePattern(...args)), 20));
  checkSeq += 1;
  const id = checkSeq;
  return new Promise((resolve) => {
    pendingCheck = { id, resolve, args };
    w.postMessage({ id, rows, cols, looks, inventory, maxNodes });
  });
}

function scheduleCheck(delay = 220) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => runCheck(CHECK_BUDGET), delay);
}

/** Decide the current picture: instantly for the counting rules, otherwise in the worker. */
async function runCheck(budget) {
  const looks = state.pattern.slice();
  const key = `${state.rows}x${state.cols}:${looks.join('')}`;
  if (state.check.key === key && state.check.status !== 'unknown' && budget === CHECK_BUDGET) return;
  const inventory = state.build.inventory;
  clearTimeout(spinnerTimer);
  if (looks.every((l) => l === LOOK.ANY)) {
    stopWorker();
    state.check = { status: 'empty', key };
    updateCheckResult();
    return;
  }
  const quick = quickCheck(state.rows, state.cols, looks, inventory);
  if (!quick.ok) {
    stopWorker();
    state.check = { status: 'impossible', reason: quick.reason, key };
    updateCheckResult();
    return;
  }
  state.check = { status: 'running', key };
  // Show the spinner only if the answer takes a moment.
  spinnerTimer = setTimeout(updateCheckResult, 160);
  const res = await runSolver(state.rows, state.cols, looks, inventory, budget);
  clearTimeout(spinnerTimer);
  if (state.check.key !== key) return;
  state.check = { ...res, key };
  updateCheckResult();
}

function checkResultMarkup() {
  const ck = state.check;
  if (ck.status === 'running') return '<div class="result is-running"><span class="spinner" aria-hidden="true"></span><p>Checking every way to place the pieces…</p></div>';
  if (ck.status === 'possible') {
    return `<div class="result is-possible"><span class="pill ok">Possible</span><p>The pieces can make this picture.</p>
<button type="button" class="btn small primary" data-action="show-solution">${ICONS.play}Build it in the tray</button></div>`;
  }
  if (ck.status === 'impossible') return `<div class="result is-impossible"><span class="pill bad">Impossible</span><p>${escapeHtml(ck.reason)}</p></div>`;
  if (ck.status === 'unknown') {
    return `<div class="result is-unknown"><span class="pill warn">Couldn't decide</span><p>${escapeHtml(ck.reason)}</p>
<button type="button" class="btn small" data-action="check-longer">Search longer</button></div>`;
  }
  if (ck.status === 'empty') return '<div class="result"><p class="muted">Paint some squares. The answer appears here as you paint.</p></div>';
  return '<div class="result"><p class="muted">Checking…</p></div>';
}

function updateCheckResult() {
  const box = $('#checkResult');
  if (box) box.innerHTML = checkResultMarkup();
  if (state.mode === 'check') {
    const btn = document.querySelector('[data-action="add-picture-to-book"]');
    if (btn) btn.disabled = !canAddPicture();
  }
}

function canAddPicture() {
  const { rows, cols } = bookUI.bookTraySize();
  return state.check.status === 'possible' && rows === state.rows && cols === state.cols && !state.pattern.includes(LOOK.ANY);
}

function setPattern(looks) {
  state.pattern = looks;
  scheduleCheck(state.check.status === 'idle' ? 0 : 220);
}

function paintCell(index, look) {
  if (index < 0 || state.pattern[index] === look) return;
  const next = state.pattern.slice();
  next[index] = look;
  setPattern(next);
  renderBoard();
}

function showSolution() {
  if (state.check.status !== 'possible') return;
  state.history.record(state.build);
  state.build = loadPieces(state.check.pieces, state.rows, state.cols);
  state.challenge = null;
  state.mode = 'build';
  state.view = 'top';
  render();
  setStatus('Here is one way to build the picture. Turn on X-ray to see the pieces hidden under roofs.');
}

function pictureFromBuild() {
  setPattern(state.build.looks().map((l) => (l < 0 ? LOOK.ANY : l)));
  render();
  setStatus('Copied the Build tray. Squares that are not full became “any”.');
}

function randomPicture() {
  const pieces = randomArrangement(state.rows, state.cols, state.build.inventory, makeRng(Date.now() >>> 0), 0.55);
  setPattern(loadPieces(pieces, state.rows, state.cols).looks());
  render();
}

function clearPicture() {
  setPattern(emptyPicture(state.rows, state.cols));
  render();
}

// ---- Files -------------------------------------------------------------------------------

let downloadsPromise = null;

function downloadsCapability() {
  if (!downloadsPromise) {
    const use = window.claude?.use;
    downloadsPromise = typeof use === 'function'
      ? Promise.race([Promise.resolve(use.call(window.claude, 'downloads')).catch(() => null), new Promise((r) => setTimeout(() => r(null), 10000))])
      : Promise.resolve(null);
  }
  return downloadsPromise;
}

/** Offer a file to the viewer. Resolves 'saved', 'declined' or 'failed'. */
async function saveFile(filename, data, mime) {
  const cap = await downloadsCapability();
  if (cap) {
    try {
      await cap.save({ filename, data });
      return 'saved';
    } catch (err) {
      if (err?.code === 'declined') return 'declined';
      if (err?.code === 'rate_limited') {
        setStatus('Another download is waiting for your answer.', true, 'bad');
        return 'failed';
      }
      // Fall back to a normal browser download below.
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

// ---- Dialog ------------------------------------------------------------------------------

function confirmDialog(message, okLabel) {
  const modal = $('#modal');
  modal.querySelector('.modal-text').textContent = message;
  const ok = modal.querySelector('[data-answer="yes"]');
  ok.textContent = okLabel;
  modal.hidden = false;
  const previous = document.activeElement;
  ok.focus();
  return new Promise((resolve) => {
    const finish = (answer) => {
      modal.hidden = true;
      modal.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
      resolve(answer);
    };
    const onClick = (e) => {
      const btn = e.target.closest('[data-answer]');
      if (btn) finish(btn.dataset.answer === 'yes');
      else if (e.target === modal) finish(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    modal.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
  });
}

// ---- Board events ------------------------------------------------------------------------

function svgPoint(evt) {
  const m = $('#board').getScreenCTM();
  if (!m) return null;
  return new DOMPoint(evt.clientX, evt.clientY).matrixTransform(m.inverse());
}

/** What the pointer is over: { r, c, fx, fy } in the top view, { r, c, id } in 3D. */
function pointerTarget(evt) {
  if (state.mode === 'build' && state.view === '3d') {
    const el = document.elementFromPoint(evt.clientX, evt.clientY);
    const face = el?.closest?.('#board [data-cell]');
    if (!face) return null;
    const [r, c] = face.dataset.cell.split(',').map(Number);
    return { r, c, id: Number(face.dataset.id || 0) || null };
  }
  const p = svgPoint(evt);
  return p ? cellFromPoint(state.rows, state.cols, p.x, p.y) : null;
}

function sameTarget(a, b) {
  if (!a || !b) return a === b;
  if (a.r !== b.r || a.c !== b.c) return false;
  if (state.tool === 'place' && state.selected) return true;
  const idA = a.id ?? state.build.pieceAt(a.r, a.c, a.fx, a.fy);
  const idB = b.id ?? state.build.pieceAt(b.r, b.c, b.fx, b.fy);
  return idA === idB;
}

function onPointerMove(evt) {
  if (!pointer.down) pointer.type = evt.pointerType;
  const h = pointerTarget(evt);
  if (state.mode === 'check') {
    const index = h ? h.r * state.cols + h.c : -1;
    if (pointer.down && index >= 0) paintCell(index, pointer.erase ? LOOK.ANY : state.paint);
    if (index !== state.hoverCell) {
      state.hoverCell = index;
      renderBoard();
    }
    return;
  }
  if (!pointer.down && evt.pointerType !== 'mouse') return;
  if (!sameTarget(h, state.hover)) {
    state.hover = h;
    renderBoard();
  } else if (h) {
    state.hover = h;
  }
}

function onPointerDown(evt) {
  const right = evt.button === 2;
  if (evt.button !== 0 && !right) return;
  pointer.type = evt.pointerType;
  const h = pointerTarget(evt);
  if (state.mode === 'check') {
    $('#board').setPointerCapture?.(evt.pointerId);
    pointer.down = true;
    pointer.id = evt.pointerId;
    pointer.erase = right;
    if (h) paintCell(h.r * state.cols + h.c, right ? LOOK.ANY : state.paint);
    evt.preventDefault();
    return;
  }
  if (right) {
    // Right-click removes, whatever tool is on.
    evt.preventDefault();
    if (h) removeAt(h);
    return;
  }
  if (state.view !== '3d') $('#board').setPointerCapture?.(evt.pointerId);
  pointer.down = true;
  pointer.id = evt.pointerId;
  state.hover = h;
  renderBoard();
  evt.preventDefault();
}

function onPointerUp(evt) {
  if (!pointer.down || evt.pointerId !== pointer.id) return;
  pointer.down = false;
  if (state.mode === 'check') return;
  const h = pointerTarget(evt);
  if (h) {
    state.hover = h;
    if (state.tool === 'remove' || !state.selected) removeAt(h);
    else placeAt(h);
  }
  if (evt.pointerType !== 'mouse') {
    state.hover = null;
    renderBoard();
  }
}

function onPointerLeave() {
  if (pointer.down) return;
  if (state.hover || state.hoverCell >= 0) {
    state.hover = null;
    state.hoverCell = -1;
    renderBoard();
  }
}

function moveCursor(dr, dc) {
  const h = state.hover ?? { r: 0, c: 0 };
  const r = Math.max(0, Math.min(state.rows - 1, h.r + dr));
  const c = Math.max(0, Math.min(state.cols - 1, h.c + dc));
  state.hover = { r, c, fx: 0.5, fy: 0.5 };
  if (state.mode === 'check') state.hoverCell = r * state.cols + c;
  renderBoard();
}

function onBoardKey(evt) {
  const keys = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (keys[evt.key]) {
    evt.preventDefault();
    moveCursor(...keys[evt.key]);
    return;
  }
  if (evt.key === 'Enter' || evt.key === ' ') {
    evt.preventDefault();
    if (!state.hover) {
      moveCursor(0, 0);
      return;
    }
    if (state.mode === 'check') paintCell(state.hover.r * state.cols + state.hover.c, state.paint);
    else if (state.tool === 'remove' || !state.selected) removeAt({ ...state.hover, id: null });
    else placeAt(state.hover);
  } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.hover) {
    evt.preventDefault();
    if (state.mode === 'check') paintCell(state.hover.r * state.cols + state.hover.c, LOOK.ANY);
    else removeAt({ ...state.hover, id: null });
  }
}

function onGlobalKey(evt) {
  if (!$('#modal').hidden) return;
  if (evt.target.closest?.('input, textarea, select')) return;
  if (state.mode === 'book') {
    bookUI.onKey(evt);
    return;
  }
  const key = evt.key.toLowerCase();
  if ((evt.ctrlKey || evt.metaKey) && key === 'z') {
    evt.preventDefault();
    if (evt.shiftKey) redo();
    else undo();
    return;
  }
  if ((evt.ctrlKey || evt.metaKey) && key === 'y') {
    evt.preventDefault();
    redo();
    return;
  }
  if (evt.ctrlKey || evt.metaKey || evt.altKey || state.mode !== 'build') return;
  if (key === 'r') turn();
  else if (key === 'f') flip();
  else if (key === 't') tip();
  else if (['1', '2', '3', '4'].includes(key)) ACTIONS.select({ dataset: { kind: KINDS[Number(key) - 1] } });
  else if (key === 'p') toggleRemove();
  else if (key === 'x' && state.view !== '3d') {
    state.xray = !state.xray;
    render();
  } else if (key === 'v') toggleView();
  else if (key === 'escape') {
    state.hover = null;
    renderBoard();
  }
}

function toggleRemove() {
  state.tool = state.tool === 'remove' ? 'place' : 'remove';
  resetStatus();
  render();
}

function toggleView() {
  state.view = state.view === '3d' ? 'top' : '3d';
  state.hover = null;
  resetStatus();
  render();
}

const ACTIONS = {
  select: (el) => {
    state.selected = el.dataset.kind;
    state.tool = 'place';
    resetStatus();
    render();
  },
  orient: (el) => {
    const type = KIND_INFO[state.selected].type;
    state.orient[type] = Number(el.dataset.o);
    state.tool = 'place';
    resetStatus();
    render();
  },
  turn,
  flip,
  tip,
  undo,
  redo,
  remove: toggleRemove,
  xray: () => {
    state.xray = !state.xray;
    render();
  },
  view: toggleView,
  'view-left': () => {
    state.azimuth = (state.azimuth + 45) % 360;
    renderBoard();
  },
  'view-right': () => {
    state.azimuth = (state.azimuth + 315) % 360;
    renderBoard();
  },
  'view-reset': () => {
    state.azimuth = 0;
    renderBoard();
  },
  'size-inc': (el) => {
    state.sizeDraft = { ...state.sizeDraft, [el.dataset.key]: Math.min(MAX_SIZE, state.sizeDraft[el.dataset.key] + 1) };
    renderPanel();
  },
  'size-dec': (el) => {
    state.sizeDraft = { ...state.sizeDraft, [el.dataset.key]: Math.max(1, state.sizeDraft[el.dataset.key] - 1) };
    renderPanel();
  },
  'apply-size': () => setSize(state.sizeDraft.rows, state.sizeDraft.cols),
  'quick-size': (el) => setSize(Number(el.dataset.rows), Number(el.dataset.cols)),
  preset: (el) => usePreset(el.dataset.id),
  'random-fill': randomFill,
  'clear-board': clearBoard,
  'copy-code': () => copyText(encodeBoard(state.build), 'Board code'),
  'load-code': loadCode,
  paint: (el) => {
    state.paint = Number(el.dataset.look);
    renderStageBar();
  },
  'from-build': pictureFromBuild,
  'random-picture': randomPicture,
  'clear-picture': clearPicture,
  'check-longer': () => runCheck(LONG_CHECK_BUDGET),
  'show-solution': showSolution,
  'add-picture-to-book': () => bookUI.addFromCheck(),
  'new-challenge': (el) => newChallenge(Number(el.dataset.level)),
  'next-challenge': () => newChallenge(state.challenge?.difficulty ?? 2),
  'stop-challenge': () => {
    state.challenge = null;
    render();
  },
  reveal: revealAnswer,
};

function onClick(evt) {
  const tab = evt.target.closest('[data-tab]');
  if (tab) {
    setMode(tab.dataset.tab);
    return;
  }
  const el = evt.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = ACTIONS[el.dataset.action] ?? bookUI.actions[el.dataset.action];
  if (action) action(el, evt);
}

function onTabKey(evt) {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const i = tabs.indexOf(evt.target);
  if (i < 0) return;
  let next = -1;
  if (evt.key === 'ArrowRight') next = (i + 1) % tabs.length;
  if (evt.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
  if (next >= 0) {
    evt.preventDefault();
    setMode(tabs[next].dataset.tab);
    tabs[next].focus();
  }
}

// ---- Boot --------------------------------------------------------------------------------

export function start(hotData) {
  let saved = null;
  if (hotData && (hotData.v === 1 || hotData.v === 2)) saved = hotData;
  else {
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY) ?? 'null');
    } catch {
      saved = null;
    }
  }
  state = restore(saved);
  bookUI = createBookUI({
    getState: () => state,
    render,
    renderPanel,
    setStatus,
    confirmDialog,
    saveFile,
    copyText,
    startChallenge,
    randomChallenge,
    setSize,
    scheduleSave,
  });
  window.claude?.hot?.snapshot?.(() => snapshot());
  downloadsCapability();

  const svg = $('#board');
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', () => {
    pointer.down = false;
    state.hover = null;
    renderBoard();
  });
  svg.addEventListener('pointerleave', onPointerLeave);
  svg.addEventListener('contextmenu', (evt) => evt.preventDefault());
  svg.addEventListener('keydown', onBoardKey);
  document.addEventListener('pointerup', () => {
    pointer.down = false;
  });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onGlobalKey);
  document.querySelector('.tabs').addEventListener('keydown', onTabKey);
  $('#panel').addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && evt.target.id === 'codeIn') loadCode();
  });
  bookUI.attach();
  if (state.mode === 'check') scheduleCheck(0);
  render();
}

export const _test = { describeOrientation, failureText, KIND_INFO };
