// The app: three modes (Build, Check a picture, Challenge) around one tray.

import { Board, KINDS, MAX_SIZE, decodeBoard, encodeBoard, pieceName, sizeProblem } from './board.js';
import { LOOK, MIX_ORIENTS, flipMix, flipTri, isCap, isRamp, rotateMix, rotateTri, thickSide, tipMix, tipTri } from './geometry.js';
import { ICONS } from './icons.js';
import { PRESETS } from './presets.js';
import { boardMarkup, cellFromPoint, flatPicture, pictureMarkup } from './render2d.js';
import { board3d, pieceIcon } from './render3d.js';
import { makeRng, patternStats, quickCheck, randomArrangement, solvePattern } from './solver.js';

const STORAGE_KEY = 'building-blocks-simulator:v1';
const MAX_HISTORY = 300;
const CHECK_BUDGET = 1500000;
const DIFFICULTY = { easy: 0.12, medium: 0.45, hard: 0.85 };

const KIND_INFO = {
  mixW: { type: 'mix', color: 'W', label: 'White cube + prism', short: 'Cube + prism' },
  mixB: { type: 'mix', color: 'B', label: 'Black cube + prism', short: 'Cube + prism' },
  triW: { type: 'tri', color: 'W', label: 'White prism', short: 'Prism' },
  triB: { type: 'tri', color: 'B', label: 'Black prism', short: 'Prism' },
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
  { look: LOOK.ANY, label: 'Any (leave open)' },
];

// ---- Sample pictures ---------------------------------------------------------------------

const { WHITE: W, BLACK: B, SLASH_WB, SLASH_BW, BACK_WB, BACK_BW } = LOOK;
const SAMPLES = [
  {
    id: 'all-split',
    name: 'Every square split',
    make: (rows, cols) => new Array(rows * cols).fill(BACK_WB),
  },
  {
    id: 'diamond',
    name: 'Diamond',
    make: (rows, cols) => (rows === 4 && cols === 4
      ? [W, SLASH_WB, BACK_WB, W, SLASH_WB, B, B, BACK_WB, BACK_BW, B, B, SLASH_BW, W, BACK_BW, SLASH_BW, W]
      : null),
  },
  {
    id: 'checker',
    name: 'Checkerboard',
    make: (rows, cols) => Array.from({ length: rows * cols }, (_, i) => ((Math.floor(i / cols) + (i % cols)) % 2 ? B : W)),
  },
  {
    id: 'stripes',
    name: 'Stripes',
    make: (rows, cols) => Array.from({ length: rows * cols }, (_, i) => (Math.floor(i / cols) % 2 ? B : W)),
  },
  ...PRESETS.map((p) => ({
    id: `pic-${p.id}`,
    name: p.name.replace(/\s*\(.*\)/, ''),
    make: (rows, cols) => (rows === p.rows && cols === p.cols ? Board.fromJSON(p).looks() : null),
  })),
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
const pointer = { down: false, id: null, type: 'mouse', startCell: null };
let statusTimer = 0;
let saveTimer = 0;

function freshChallenge(rows, cols, difficulty = 'medium') {
  return { board: new Board(rows, cols), history: new History(), target: null, answer: null, difficulty, moves: 0, solved: false, revealed: false };
}

function defaultState() {
  const photo = PRESETS[0];
  return {
    mode: 'build',
    rows: photo.rows,
    cols: photo.cols,
    sizeDraft: { rows: photo.rows, cols: photo.cols },
    build: Board.fromJSON(photo),
    buildHistory: new History(),
    challenge: freshChallenge(photo.rows, photo.cols),
    pattern: SAMPLES[1].make(4, 4),
    paint: LOOK.BLACK,
    check: { status: 'idle' },
    selected: 'mixW',
    orient: { mix: 4, tri: 3 },
    tool: 'place',
    xray: false,
    view: 'top',
    azimuth: 22,
    hover: null,
    hoverCell: -1,
    fresh: new Set(),
  };
}

function snapshot() {
  const ch = state.challenge;
  return {
    v: 1,
    mode: state.mode,
    rows: state.rows,
    cols: state.cols,
    build: encodeBoard(state.build),
    pattern: state.pattern,
    paint: state.paint,
    selected: state.selected,
    orient: state.orient,
    xray: state.xray,
    challenge: {
      board: encodeBoard(ch.board),
      target: ch.target,
      answer: ch.answer,
      difficulty: ch.difficulty,
      moves: ch.moves,
      solved: ch.solved,
      revealed: ch.revealed,
    },
  };
}

function restore(data) {
  const base = defaultState();
  if (!data || data.v !== 1) return base;
  try {
    const rows = data.rows;
    const cols = data.cols;
    if (sizeProblem(rows, cols)) return base;
    const build = decodeBoard(data.build);
    if (build.rows !== rows || build.cols !== cols) return base;
    const chBoard = decodeBoard(data.challenge.board);
    const pattern = Array.isArray(data.pattern) && data.pattern.length === rows * cols ? data.pattern.map(Number) : new Array(rows * cols).fill(LOOK.ANY);
    return {
      ...base,
      mode: ['build', 'check', 'challenge'].includes(data.mode) ? data.mode : 'build',
      rows,
      cols,
      sizeDraft: { rows, cols },
      build,
      challenge: {
        ...freshChallenge(rows, cols, data.challenge.difficulty in DIFFICULTY ? data.challenge.difficulty : 'medium'),
        board: chBoard,
        target: Array.isArray(data.challenge.target) && data.challenge.target.length === rows * cols ? data.challenge.target : null,
        answer: Array.isArray(data.challenge.answer) ? data.challenge.answer : null,
        moves: data.challenge.moves | 0,
        solved: !!data.challenge.solved,
        revealed: !!data.challenge.revealed,
      },
      pattern,
      paint: Number.isInteger(data.paint) ? data.paint : LOOK.BLACK,
      selected: KINDS.includes(data.selected) ? data.selected : 'mixW',
      orient: {
        mix: Number.isInteger(data.orient?.mix) ? data.orient.mix % 16 : 4,
        tri: Number.isInteger(data.orient?.tri) ? data.orient.tri % 12 : 3,
      },
      xray: !!data.xray,
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
      /* storage may be unavailable: the app works without it */
    }
  }, 250);
}

const activeBoard = () => (state.mode === 'challenge' ? state.challenge.board : state.build);
const activeHistory = () => (state.mode === 'challenge' ? state.challenge.history : state.buildHistory);
function setActiveBoard(board) {
  if (state.mode === 'challenge') state.challenge.board = board;
  else state.build = board;
}

// ---- Words -------------------------------------------------------------------------------

function describeOrientation(type, o) {
  if (type === 'mix') {
    const m = MIX_ORIENTS[o];
    const where = `prism ${DIR_WORD[m.dir] === 'up' || DIR_WORD[m.dir] === 'down' ? DIR_WORD[m.dir] : `to the ${DIR_WORD[m.dir]}`}`;
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
      return `No ${name} left. Take one out of the tray or choose another piece.`;
    case 'outside':
      return piece.type === 'mix' ? 'The prism part would stick out of the tray. Turn the piece or pick another square.' : 'That is outside the tray.';
    case 'taken':
      return 'That square is already full. Use Pick up (or right-click) to take a piece out.';
    case 'clash':
      return 'Only the matching half fits next to the piece already in that square.';
    case 'needs-ramp':
      return 'A prism lying slope-down needs a ramp under it. Put a ramp in that square first.';
    default:
      return 'That does not fit.';
  }
}

function progressText() {
  const board = activeBoard();
  const placed = board.pieces.size;
  const total = board.totalPieces();
  const hollow = board.hollowCells().length;
  let text = placed === total ? `Tray full: all ${total} pieces placed.` : `${placed} of ${total} pieces placed.`;
  if (hollow) text += ` ${hollow} roof${hollow > 1 ? 's have' : ' has'} a hollow underneath.`;
  return text;
}

// ---- Rendering ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function render() {
  renderTabs();
  renderBoard();
  renderStageBar();
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

function renderBoard() {
  const svg = $('#board');
  let view;
  if (state.mode === 'check') {
    view = pictureMarkup(state.rows, state.cols, state.pattern, { hoverCell: state.hoverCell });
    svg.setAttribute('aria-label', `Picture to check, ${state.rows} by ${state.cols}. Tap squares to paint them.`);
  } else if (state.view === '3d') {
    const b = board3d(activeBoard(), { azimuth: state.azimuth });
    view = { viewBox: b.viewBox, markup: b.markup };
    svg.setAttribute('aria-label', `Tray in 3D. ${progressText()}`);
  } else {
    const board = activeBoard();
    let ghost = null;
    let hoverId = 0;
    if (state.hover) {
      if (state.tool === 'place' && state.selected) {
        const piece = currentPiece(state.hover.r, state.hover.c);
        ghost = { piece, ok: board.check(piece).ok };
      } else if (state.tool === 'pickup') {
        hoverId = board.pieceAt(state.hover.r, state.hover.c, state.hover.fx, state.hover.fy);
      }
    }
    view = boardMarkup(board, { xray: state.xray, ghost, hoverId, freshIds: state.fresh });
    svg.setAttribute('aria-label', `Tray, ${state.rows} rows by ${state.cols} columns. ${progressText()}`);
  }
  svg.setAttribute('viewBox', view.viewBox);
  svg.innerHTML = view.markup;
  svg.classList.toggle('is-3d', state.mode !== 'check' && state.view === '3d');
  svg.classList.toggle('is-pickup', state.mode !== 'check' && state.tool === 'pickup');
  state.fresh = new Set();
}

function toolButton(action, icon, label, { pressed = null, disabled = false, hint = '' } = {}) {
  const aria = pressed === null ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`;
  return `<button type="button" class="tool" data-action="${action}"${aria}${disabled ? ' disabled' : ''} title="${hint || label}">${icon}<span>${label}</span></button>`;
}

function renderStageBar() {
  const bar = $('#stageBar');
  if (state.mode === 'check') {
    const st = patternStats(state.pattern);
    const maxSplit = state.rows * state.cols - (activeInventory().mixW + activeInventory().mixB);
    bar.innerHTML = `<p class="stats"><span><b>${st.diagonal}</b> split of at most ${maxSplit}</span><span><b>${st.white}</b> white</span><span><b>${st.black}</b> black</span>${st.any ? `<span><b>${st.any}</b> any</span>` : ''}</p>`;
    return;
  }
  const hist = activeHistory();
  let html = '<div class="tools">';
  html += toolButton('undo', ICONS.undo, 'Undo', { disabled: !hist.past.length, hint: 'Undo (Ctrl+Z)' });
  html += toolButton('redo', ICONS.redo, 'Redo', { disabled: !hist.future.length, hint: 'Redo (Ctrl+Y)' });
  html += toolButton('pickup', ICONS.hand, 'Pick up', { pressed: state.tool === 'pickup', hint: 'Pick up pieces (P). Right-click also picks up.' });
  html += toolButton('xray', ICONS.xray, 'X-ray', { pressed: state.xray, hint: 'See pieces hidden under roofs (X)' });
  html += toolButton('view', state.view === '3d' ? ICONS.board : ICONS.cube, state.view === '3d' ? 'Top view' : '3D', { hint: 'Switch between the top view and 3D (V)' });
  if (state.view === '3d') {
    html += toolButton('turn-view-left', ICONS.turnLeft, 'Turn', { hint: 'Turn the tray' });
    html += toolButton('turn-view-right', ICONS.turnRight, 'Turn', { hint: 'Turn the tray the other way' });
  }
  html += '</div>';
  if (state.mode === 'challenge' && state.challenge.target) {
    const prog = challengeProgress();
    html += `<div class="target-mini" aria-label="Target picture">${flatPicture(state.rows, state.cols, state.challenge.target, { cell: 14, gap: 1.2 })}<p><b>${prog.match}</b> of ${prog.total} squares match</p></div>`;
  }
  bar.innerHTML = html;
}

function activeInventory() {
  return activeBoard().inventory;
}

function binMarkup() {
  const board = activeBoard();
  return KINDS.map((kind, i) => {
    const info = KIND_INFO[kind];
    const left = board.remaining(kind);
    const on = state.selected === kind;
    const icon = pieceIcon(info.type, info.color, state.orient[info.type], { size: info.type === 'mix' ? 66 : 50 });
    return `<button type="button" class="bin-slot${on ? ' is-selected' : ''}${left === 0 ? ' is-empty' : ''}" data-action="select" data-kind="${kind}" aria-pressed="${on}" title="${info.label} (${i + 1})">
<span class="bin-icon">${icon}</span>
<span class="bin-text"><span class="bin-name"><i class="swatch ${info.color}"></i>${info.short}</span><span class="bin-count"><b>${left}</b> left</span></span>
</button>`;
  }).join('');
}

function orientMarkup() {
  if (!state.selected) return '<p class="muted">Choose a piece above to see the ways it can be turned.</p>';
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
    for (const [label, list] of rows) {
      grid += `<div class="orient-row"><span class="orient-label">${label}</span>${list.map((o) => button(o, 46)).join('')}</div>`;
    }
  }
  return `<div class="orient-grid ${info.type}">${grid}</div>
<p class="orient-now">${describeOrientation(info.type, cur)}</p>
<div class="turn-buttons">
${toolButton('turn', ICONS.rotate, 'Turn', { hint: 'Quarter turn (R)' })}
${toolButton('flip', ICONS.flip, 'Flip over', { hint: 'Turn upside down (F)' })}
${toolButton('tip', ICONS.tip, 'Tip over', { hint: 'Stand up / lay down (T)' })}
</div>`;
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

function trayCard() {
  const presets = PRESETS.map((p) => `<button type="button" class="chip" data-action="preset" data-id="${p.id}">${p.name}</button>`).join('');
  const code = encodeBoard(state.build);
  return `<section class="card" aria-labelledby="tray-h">
<h2 id="tray-h">Tray</h2>
${sizeMarkup()}
<div class="chips" role="group" aria-label="Fill the tray">${presets}
<button type="button" class="chip" data-action="random-fill">${ICONS.dice}Random fill</button>
<button type="button" class="chip" data-action="clear-board">${ICONS.trash}Empty tray</button></div>
<details class="share"><summary>Board code (save or share a layout)</summary>
<div class="code-row"><label class="sr-only" for="codeOut">Code of the Build tray</label><input id="codeOut" readonly value="${code}"><button type="button" class="btn" data-action="copy-code">${ICONS.copy}Copy</button></div>
<div class="code-row"><label class="sr-only" for="codeIn">Paste a board code</label><input id="codeIn" placeholder="Paste a code like 4x4:…" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-action="load-code">Load</button></div>
</details>
</section>`;
}

function piecesCards(title) {
  const board = activeBoard();
  const allIn = KINDS.every((k) => board.remaining(k) === 0);
  return `<section class="card" aria-labelledby="bin-h">
<h2 id="bin-h">${title}</h2>
<div class="bin">${binMarkup()}</div>
${allIn ? '<p class="hint">Every piece is in the tray. Use <b>Pick up</b> to take pieces out and rearrange them, or empty the tray below.</p>' : ''}
</section>
<section class="card" aria-labelledby="turn-h">
<h2 id="turn-h">Turn the piece</h2>
${orientMarkup()}
<p class="hint">Tap a square to place it: the cube goes where you tap. Keys: <kbd>R</kbd> turn, <kbd>F</kbd> flip, <kbd>T</kbd> tip, <kbd>P</kbd> pick up.</p>
</section>`;
}

function checkResultMarkup() {
  const ck = state.check;
  const quick = quickCheck(state.rows, state.cols, state.pattern, activeInventoryFor());
  if (ck.status === 'running') {
    return `<div class="result is-running" role="status"><span class="spinner" aria-hidden="true"></span><p>Searching every way to place the pieces…</p><button type="button" class="btn" data-action="cancel-check">Cancel</button></div>`;
  }
  if (ck.status === 'possible') {
    return `<div class="result is-possible"><span class="pill ok">Possible</span><p>The pieces can make this picture.</p><button type="button" class="btn primary" data-action="show-solution">${ICONS.play}Build it on the tray</button></div>`;
  }
  if (ck.status === 'impossible') {
    return `<div class="result is-impossible"><span class="pill bad">Impossible</span><p>${ck.reason}</p></div>`;
  }
  if (ck.status === 'unknown') {
    return `<div class="result is-unknown"><span class="pill warn">Couldn't decide</span><p>${ck.reason}</p></div>`;
  }
  if (!quick.ok) {
    return `<div class="result is-impossible"><span class="pill bad">Impossible</span><p>${quick.reason}</p></div>`;
  }
  return '<div class="result"><p class="muted">Paint a picture, then check whether the pieces can make it.</p></div>';
}

function activeInventoryFor() {
  return state.build.inventory;
}

function checkPanel() {
  const swatches = PALETTE.map(({ look, label }) => {
    const on = state.paint === look;
    return `<button type="button" class="swatch-btn${on ? ' is-on' : ''}" data-action="paint" data-look="${look}" aria-pressed="${on}" title="${label}">${flatPicture(1, 1, [look], { cell: 28, gap: 0 })}<span>${label}</span></button>`;
  }).join('');
  const samples = SAMPLES.map((s) => ({ s, looks: s.make(state.rows, state.cols) }))
    .filter((x) => x.looks)
    .map(({ s }) => `<button type="button" class="chip" data-action="sample" data-id="${s.id}">${s.name}</button>`)
    .join('');
  return `<section class="card" aria-labelledby="paint-h">
<h2 id="paint-h">Paint a picture</h2>
<div class="palette" role="group" aria-label="Paint">${swatches}</div>
<p class="hint">Tap or drag across squares. “Any” leaves a square open for the pieces to decide.</p>
<div class="chips" role="group" aria-label="Start from">${samples}
<button type="button" class="chip" data-action="from-build">${ICONS.copy}Copy the Build tray</button>
<button type="button" class="chip" data-action="random-picture">${ICONS.dice}Random possible</button>
<button type="button" class="chip" data-action="clear-picture">${ICONS.trash}Clear</button></div>
</section>
<section class="card" aria-labelledby="result-h">
<h2 id="result-h">Can it be built?</h2>
<button type="button" class="btn primary wide" data-action="check" ${state.check.status === 'running' ? 'disabled' : ''}>${ICONS.check}Check this picture</button>
${checkResultMarkup()}
</section>
${trayCard()}`;
}

function challengePanel() {
  const ch = state.challenge;
  const levels = Object.keys(DIFFICULTY)
    .map((k) => `<button type="button" class="chip${ch.difficulty === k ? ' is-on' : ''}" data-action="difficulty" data-level="${k}" aria-pressed="${ch.difficulty === k}">${k[0].toUpperCase()}${k.slice(1)}</button>`)
    .join('');
  let body;
  if (!ch.target) {
    body = '<p class="muted">Start a challenge: you get a picture made from a real arrangement of the pieces, and you rebuild it in the tray.</p>';
  } else {
    const prog = challengeProgress();
    const verdict = ch.solved
      ? `<p class="win">${ch.revealed ? 'Answer shown.' : `Solved in ${ch.moves} moves.`}</p>`
      : `<p><b>${prog.match}</b> of ${prog.total} squares match · ${ch.moves} moves</p>`;
    body = `<div class="target">${flatPicture(state.rows, state.cols, ch.target, { cell: 34, gap: 2.5, mismatches: prog.mismatch })}</div>${verdict}
<p class="hint">A red outline marks a square that is full but looks different from the picture.</p>`;
  }
  return `<section class="card" aria-labelledby="ch-h">
<h2 id="ch-h">Make this picture</h2>
${body}
<div class="chips" role="group" aria-label="Difficulty">${levels}</div>
<div class="row-buttons">
<button type="button" class="btn primary" data-action="new-challenge">${ICONS.dice}New challenge</button>
${ch.target ? `<button type="button" class="btn" data-action="restart-challenge">Start over</button><button type="button" class="btn" data-action="reveal">Show answer</button>` : ''}
</div>
</section>
${piecesCards('Pieces')}
${trayCard()}`;
}

function buildPanel() {
  return `${piecesCards('Pieces')}${trayCard()}`;
}

function renderPanel() {
  const panel = $('#panel');
  const focusedId = document.activeElement && panel.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  const html = state.mode === 'check' ? checkPanel() : state.mode === 'challenge' ? challengePanel() : buildPanel();
  const openDetails = panel.querySelector('details[open]') !== null;
  panel.innerHTML = html;
  if (openDetails) panel.querySelector('details')?.setAttribute('open', '');
  if (focusedId) {
    const el = panel.querySelector(focusedId);
    if (el) el.focus({ preventScroll: true });
  }
}

function focusKey(el) {
  if (el.id) return `#${el.id}`;
  const action = el.dataset.action;
  if (!action) return null;
  const extra = ['kind', 'o', 'look', 'key', 'id', 'level', 'rows'].map((k) => (el.dataset[k] !== undefined ? `[data-${k}="${el.dataset[k]}"]` : '')).join('');
  return `[data-action="${action}"]${extra}`;
}

function defaultStatus() {
  if (state.mode === 'check') return 'Paint squares, then press “Check this picture”.';
  if (state.view === '3d') return `${progressText()} Switch to the top view to place pieces.`;
  if (state.tool === 'pickup') return `Pick up: tap a piece to take it out. ${progressText()}`;
  if (!state.selected) return `Choose a piece. ${progressText()}`;
  const info = KIND_INFO[state.selected];
  return `${info.label}: ${describeOrientation(info.type, state.orient[info.type]).toLowerCase()}. ${progressText()}`;
}

/** Drop any temporary message so the next render shows the normal status line. */
function resetStatus() {
  clearTimeout(statusTimer);
  statusTimer = 0;
}

function setStatus(text, transient = true, tone = '') {
  const el = $('#status');
  el.textContent = text;
  el.dataset.tone = tone;
  clearTimeout(statusTimer);
  statusTimer = 0;
  if (transient) {
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      setStatus(defaultStatus(), false);
    }, 4200);
  }
}

// ---- Actions -----------------------------------------------------------------------------

function currentPiece(r, c) {
  const info = KIND_INFO[state.selected];
  return { type: info.type, color: info.color, r, c, o: state.orient[info.type] };
}

function placeAt(h) {
  const board = activeBoard();
  const piece = currentPiece(h.r, h.c);
  const res = board.check(piece);
  if (!res.ok) {
    setStatus(failureText(res, piece), true, 'bad');
    pulseBoard();
    return;
  }
  activeHistory().record(board);
  const placed = board.place(piece);
  state.fresh = new Set([placed.id]);
  if (state.mode === 'challenge') {
    state.challenge.moves += 1;
    afterChallengeMove();
  }
  if (board.remaining(state.selected) === 0) {
    const next = KINDS.find((k) => KIND_INFO[k].type === KIND_INFO[state.selected].type && board.remaining(k) > 0)
      ?? KINDS.find((k) => board.remaining(k) > 0);
    if (next) {
      setStatus(`That was the last ${pieceName(piece)}. Switched to ${KIND_INFO[next].label.toLowerCase()}.`);
      state.selected = next;
    }
  }
  render();
}

function pickUpAt(h) {
  const board = activeBoard();
  const id = board.pieceAt(h.r, h.c, h.fx, h.fy);
  if (!id) {
    setStatus('Nothing to pick up there.', true);
    return;
  }
  const piece = board.pieces.get(id);
  activeHistory().record(board);
  const removed = board.remove(id);
  if (state.mode === 'challenge') {
    state.challenge.moves += 1;
    afterChallengeMove();
  }
  setStatus(removed.length > 1 ? `Took out the ${pieceName(piece)} and the prism resting on it.` : `Took out the ${pieceName(piece)}.`);
  render();
}

function pulseBoard() {
  const wrap = $('#boardWrap');
  wrap.classList.remove('is-shake');
  void wrap.offsetWidth;
  wrap.classList.add('is-shake');
}

function undo() {
  const board = activeHistory().undo(activeBoard());
  if (!board) return;
  setActiveBoard(board);
  if (state.mode === 'challenge') afterChallengeMove();
  render();
}

function redo() {
  const board = activeHistory().redo(activeBoard());
  if (!board) return;
  setActiveBoard(board);
  if (state.mode === 'challenge') afterChallengeMove();
  render();
}

function changeOrientation(fn) {
  if (!state.selected) return;
  const type = KIND_INFO[state.selected].type;
  state.orient[type] = fn(type, state.orient[type]);
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
  if (mode === 'challenge' && !state.challenge.target) newChallenge();
  resetStatus();
  render();
  setStatus(defaultStatus(), false);
}

async function setSize(rows, cols) {
  const problem = sizeProblem(rows, cols);
  if (problem) {
    setStatus(problem, true, 'bad');
    return;
  }
  const busy = state.build.pieces.size || state.challenge.board.pieces.size;
  if (busy && !(await confirmDialog(`Start a new ${rows}×${cols} tray? The pieces in the trays and the current picture will be cleared.`, 'New tray'))) return;
  state.rows = rows;
  state.cols = cols;
  state.sizeDraft = { rows, cols };
  state.build = new Board(rows, cols);
  state.buildHistory = new History();
  state.challenge = freshChallenge(rows, cols, state.challenge.difficulty);
  state.pattern = new Array(rows * cols).fill(LOOK.ANY);
  state.check = { status: 'idle' };
  if (state.mode === 'challenge') newChallenge();
  render();
  setStatus(`New ${rows}×${cols} tray with ${(rows * cols) / 4} of each piece.`);
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
    const busy = state.build.pieces.size || state.challenge.board.pieces.size;
    if (busy && !(await confirmDialog(`${preset.name} uses a ${preset.rows}×${preset.cols} tray. Switch size? The other trays will be cleared.`, 'Switch'))) return;
    state.rows = preset.rows;
    state.cols = preset.cols;
    state.sizeDraft = { rows: preset.rows, cols: preset.cols };
    state.buildHistory = new History();
    state.challenge = freshChallenge(preset.rows, preset.cols, state.challenge.difficulty);
    state.pattern = new Array(preset.rows * preset.cols).fill(LOOK.ANY);
    state.check = { status: 'idle' };
  } else {
    state.buildHistory.record(state.build);
  }
  state.build = Board.fromJSON(preset);
  state.mode = 'build';
  render();
  setStatus(`Loaded ${preset.name}: every square looks full because each cube + prism lies as a ramp with a prism on top.`);
}

function randomFill() {
  const board = activeBoard();
  activeHistory().record(board);
  const pieces = randomArrangement(state.rows, state.cols, board.inventory, makeRng(Date.now() >>> 0), 0.5);
  setActiveBoard(loadPieces(pieces, state.rows, state.cols));
  if (state.mode === 'challenge') {
    state.challenge.moves += 1;
    afterChallengeMove();
  }
  render();
  setStatus('Filled the tray with a random arrangement.');
}

async function clearBoard() {
  const board = state.mode === 'check' ? state.build : activeBoard();
  if (!board.pieces.size) return;
  if (!(await confirmDialog('Take every piece out of the tray?', 'Empty tray'))) return;
  if (state.mode === 'challenge') {
    state.challenge.history.record(board);
    state.challenge.board = new Board(state.rows, state.cols);
    afterChallengeMove();
  } else {
    state.buildHistory.record(state.build);
    state.build = new Board(state.rows, state.cols);
  }
  render();
  setStatus('The tray is empty. Undo brings the pieces back.');
}

async function copyCode() {
  const code = encodeBoard(state.build);
  const input = $('#codeOut');
  try {
    await navigator.clipboard.writeText(code);
    setStatus('Board code copied.');
  } catch {
    input?.select();
    setStatus('Select the code and copy it.', true);
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
      state.challenge = freshChallenge(board.rows, board.cols, state.challenge.difficulty);
      state.pattern = new Array(board.rows * board.cols).fill(LOOK.ANY);
      state.check = { status: 'idle' };
      state.buildHistory = new History();
    } else {
      state.buildHistory.record(state.build);
    }
    state.build = board;
    state.mode = 'build';
    render();
    setStatus('Loaded the board code.');
  } catch (err) {
    setStatus(err.message, true, 'bad');
  }
}

// ---- Check a picture ---------------------------------------------------------------------

let worker = null;
let workerBroken = false;
let pendingCheck = null;
let checkSeq = 0;

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    // eslint-disable-next-line no-undef
    const source = typeof __WORKER_SOURCE__ === 'string' ? __WORKER_SOURCE__ : null;
    if (!source) throw new Error('no worker source');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
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

function runSolver(rows, cols, looks, inventory) {
  const args = [rows, cols, looks, inventory, { maxNodes: CHECK_BUDGET }];
  const w = getWorker();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(solvePattern(...args)), 30));
  checkSeq += 1;
  const id = checkSeq;
  return new Promise((resolve) => {
    pendingCheck = { id, resolve, args };
    w.postMessage({ id, rows, cols, looks, inventory, maxNodes: CHECK_BUDGET });
  });
}

async function checkPicture() {
  const looks = state.pattern.slice();
  const key = looks.join(',');
  state.check = { status: 'running', key };
  render();
  const res = await runSolver(state.rows, state.cols, looks, state.build.inventory);
  if (state.check.status !== 'running' || state.check.key !== key) return;
  state.check = { ...res, key };
  render();
  const words = { possible: 'Possible.', impossible: 'Impossible.', unknown: 'Could not decide.' };
  setStatus(`${words[res.status]} ${res.status === 'possible' ? 'Press “Build it on the tray” to see how.' : res.reason ?? ''}`, true, res.status === 'possible' ? 'ok' : 'bad');
}

function cancelCheck() {
  if (worker) worker.terminate();
  worker = null;
  pendingCheck = null;
  state.check = { status: 'idle' };
  render();
  setStatus('Check cancelled.');
}

function patternChanged() {
  if (state.check.status !== 'idle' && state.check.status !== 'running') state.check = { status: 'idle' };
}

function paintCell(index) {
  if (index < 0 || state.pattern[index] === state.paint) return;
  state.pattern = state.pattern.slice();
  state.pattern[index] = state.paint;
  patternChanged();
  render();
}

function showSolution() {
  if (state.check.status !== 'possible') return;
  state.buildHistory.record(state.build);
  state.build = loadPieces(state.check.pieces, state.rows, state.cols);
  state.mode = 'build';
  state.view = 'top';
  render();
  setStatus('Here is one way to build the picture. Turn on X-ray to see the pieces hidden under roofs.');
}

function samplePicture(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  const looks = sample?.make(state.rows, state.cols);
  if (!looks) return;
  state.pattern = looks.slice();
  patternChanged();
  render();
}

function pictureFromBuild() {
  state.pattern = state.build.looks().map((l) => (l < 0 ? LOOK.ANY : l));
  patternChanged();
  render();
  setStatus('Copied the Build tray. Squares that are not full became “Any”.');
}

function randomPicture() {
  const pieces = randomArrangement(state.rows, state.cols, state.build.inventory, makeRng(Date.now() >>> 0), 0.55);
  state.pattern = loadPieces(pieces, state.rows, state.cols).looks();
  patternChanged();
  render();
  setStatus('A random picture that the pieces can make.');
}

function clearPicture() {
  state.pattern = new Array(state.rows * state.cols).fill(LOOK.ANY);
  patternChanged();
  render();
}

// ---- Challenge ---------------------------------------------------------------------------

function newChallenge() {
  const ch = state.challenge;
  const rng = makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  let best = null;
  // Prefer pictures that use the split look a fitting number of times for the level.
  const wantSplit = { easy: 0.08, medium: 0.25, hard: 0.42 }[ch.difficulty] * state.rows * state.cols;
  for (let k = 0; k < 8; k += 1) {
    const pieces = randomArrangement(state.rows, state.cols, ch.board.inventory, rng, DIFFICULTY[ch.difficulty]);
    const looks = loadPieces(pieces, state.rows, state.cols).looks();
    const split = looks.filter((l) => l >= 3).length;
    const score = Math.abs(split - wantSplit);
    if (!best || score < best.score) best = { pieces, looks, score };
  }
  state.challenge = { ...freshChallenge(state.rows, state.cols, ch.difficulty), target: best.looks, answer: best.pieces };
  render();
  setStatus('New challenge: fill the tray so it shows the picture.');
}

function challengeProgress() {
  const { board, target } = state.challenge;
  const looks = board.looks();
  let match = 0;
  // Only squares that are already full but show the wrong look count as mistakes.
  const mismatch = looks.map((l, i) => {
    const ok = l >= 0 && (target[i] === LOOK.ANY || l === target[i]);
    if (ok) match += 1;
    return l >= 0 && !ok;
  });
  return { match, total: looks.length, mismatch };
}

function afterChallengeMove() {
  const ch = state.challenge;
  if (!ch.target || ch.solved) return;
  const prog = challengeProgress();
  if (prog.match === prog.total && ch.board.isComplete()) {
    ch.solved = true;
    setTimeout(() => setStatus(`Solved in ${ch.moves} moves!`, true, 'ok'), 0);
    celebrate();
  }
}

function celebrate() {
  const wrap = $('#boardWrap');
  wrap.classList.remove('is-win');
  void wrap.offsetWidth;
  wrap.classList.add('is-win');
}

async function revealAnswer() {
  const ch = state.challenge;
  if (!ch.answer) return;
  if (!ch.solved && !(await confirmDialog('Show the answer? Your pieces in the tray will be replaced.', 'Show answer'))) return;
  ch.history.record(ch.board);
  ch.board = loadPieces(ch.answer, state.rows, state.cols);
  ch.revealed = true;
  ch.solved = true;
  render();
  setStatus('This is the arrangement the picture was made from. Other arrangements can make it too.');
}

function restartChallenge() {
  const ch = state.challenge;
  ch.history.record(ch.board);
  ch.board = new Board(state.rows, state.cols);
  ch.moves = 0;
  ch.solved = false;
  ch.revealed = false;
  render();
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

// ---- Events ------------------------------------------------------------------------------

function svgPoint(evt) {
  const svg = $('#board');
  const m = svg.getScreenCTM();
  if (!m) return null;
  const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(m.inverse());
  return pt;
}

function hoverFromEvent(evt) {
  const p = svgPoint(evt);
  if (!p) return null;
  return cellFromPoint(state.rows, state.cols, p.x, p.y);
}

function sameHover(a, b) {
  if (!a || !b) return a === b;
  if (a.r !== b.r || a.c !== b.c) return false;
  if (state.tool !== 'pickup') return true;
  return activeBoard().pieceAt(a.r, a.c, a.fx, a.fy) === activeBoard().pieceAt(b.r, b.c, b.fx, b.fy);
}

function onPointerMove(evt) {
  if (!pointer.down) pointer.type = evt.pointerType;
  if (state.mode !== 'check' && state.view === '3d') return;
  const h = hoverFromEvent(evt);
  if (state.mode === 'check') {
    const index = h ? h.r * state.cols + h.c : -1;
    if (pointer.down && index >= 0) {
      paintCell(index);
    }
    if (index !== state.hoverCell) {
      state.hoverCell = index;
      renderBoard();
    }
    return;
  }
  if (!pointer.down && evt.pointerType !== 'mouse') return;
  if (!sameHover(h, state.hover)) {
    state.hover = h;
    renderBoard();
  } else if (h) {
    state.hover = h;
  }
}

function onPointerDown(evt) {
  if (evt.button !== 0) return;
  if (state.mode !== 'check' && state.view === '3d') {
    setStatus('Switch to the top view to place or pick up pieces.', true);
    return;
  }
  const svg = $('#board');
  svg.setPointerCapture?.(evt.pointerId);
  pointer.down = true;
  pointer.id = evt.pointerId;
  pointer.type = evt.pointerType;
  const h = hoverFromEvent(evt);
  if (state.mode === 'check') {
    if (h) paintCell(h.r * state.cols + h.c);
    return;
  }
  state.hover = h;
  renderBoard();
  evt.preventDefault();
}

function onPointerUp(evt) {
  if (!pointer.down || evt.pointerId !== pointer.id) return;
  pointer.down = false;
  if (state.mode === 'check') return;
  const h = hoverFromEvent(evt) ?? null;
  if (h) {
    state.hover = h;
    if (state.tool === 'pickup') pickUpAt(h);
    else if (state.selected) placeAt(h);
    else pickUpAt(h);
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

function onContextMenu(evt) {
  if (state.mode === 'check' || state.view === '3d') return;
  evt.preventDefault();
  // Right-click picks up with a mouse; a long press on a touch screen does nothing, so a
  // slow tap never removes a piece by accident.
  if (pointer.type !== 'mouse') return;
  const h = hoverFromEvent(evt);
  if (h) pickUpAt(h);
}

function moveCursor(dr, dc) {
  const h = state.hover ?? { r: 0, c: 0, fx: 0.5, fy: 0.5 };
  const r = Math.max(0, Math.min(state.rows - 1, h.r + dr));
  const c = Math.max(0, Math.min(state.cols - 1, h.c + dc));
  if (state.mode === 'check') {
    state.hoverCell = r * state.cols + c;
    state.hover = { r, c, fx: 0.5, fy: 0.5 };
  } else {
    state.hover = { r, c, fx: 0.5, fy: 0.5 };
  }
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
    if (state.mode === 'check') paintCell(state.hover.r * state.cols + state.hover.c);
    else if (state.view !== '3d') {
      if (state.tool === 'pickup' || !state.selected) pickUpAt(state.hover);
      else placeAt(state.hover);
    }
  } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && state.hover && state.mode !== 'check') {
    evt.preventDefault();
    pickUpAt(state.hover);
  }
}

function onGlobalKey(evt) {
  if (!$('#modal').hidden) return;
  if (evt.target.closest?.('input, textarea, select')) return;
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
  if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
  if (state.mode === 'check') return;
  if (key === 'r') turn();
  else if (key === 'f') flip();
  else if (key === 't') tip();
  else if (['1', '2', '3', '4'].includes(key)) {
    state.selected = KINDS[Number(key) - 1];
    state.tool = 'place';
    render();
  } else if (key === 'p') toggleTool();
  else if (key === 'x') {
    state.xray = !state.xray;
    render();
  } else if (key === 'v') toggleView();
  else if (key === 'escape') {
    state.hover = null;
    renderBoard();
  }
}

function toggleTool() {
  state.tool = state.tool === 'pickup' ? 'place' : 'pickup';
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
  pickup: toggleTool,
  xray: () => {
    state.xray = !state.xray;
    render();
  },
  view: toggleView,
  'turn-view-left': () => {
    state.azimuth = (state.azimuth + 90) % 360;
    render();
  },
  'turn-view-right': () => {
    state.azimuth = (state.azimuth + 270) % 360;
    render();
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
  'quick-size': (el) => {
    const rows = Number(el.dataset.rows);
    const cols = Number(el.dataset.cols);
    if (rows === state.rows && cols === state.cols) return;
    setSize(rows, cols);
  },
  preset: (el) => usePreset(el.dataset.id),
  'random-fill': randomFill,
  'clear-board': clearBoard,
  'copy-code': copyCode,
  'load-code': loadCode,
  paint: (el) => {
    state.paint = Number(el.dataset.look);
    renderPanel();
  },
  sample: (el) => samplePicture(el.dataset.id),
  'from-build': pictureFromBuild,
  'random-picture': randomPicture,
  'clear-picture': clearPicture,
  check: checkPicture,
  'cancel-check': cancelCheck,
  'show-solution': showSolution,
  difficulty: (el) => {
    state.challenge.difficulty = el.dataset.level;
    newChallenge();
  },
  'new-challenge': newChallenge,
  'restart-challenge': restartChallenge,
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
  const action = ACTIONS[el.dataset.action];
  if (action) action(el);
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
  if (hotData && hotData.v === 1) saved = hotData;
  else {
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      saved = null;
    }
  }
  state = restore(saved);
  window.claude?.hot?.snapshot?.(() => snapshot());

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
  svg.addEventListener('contextmenu', onContextMenu);
  svg.addEventListener('keydown', onBoardKey);
  svg.addEventListener('blur', () => {
    if (state.hover && pointer.type !== 'mouse') {
      state.hover = null;
      renderBoard();
    }
  });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onGlobalKey);
  document.querySelector('.tabs').addEventListener('keydown', onTabKey);
  $('#panel').addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && evt.target.id === 'codeIn') loadCode();
  });
  render();
}

export const _test = { describeOrientation, failureText, SAMPLES, isCap };
