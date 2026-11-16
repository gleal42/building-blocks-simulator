// The Packs tab: packs of designs to fill challenge books and card decks.
//   * Pick or make a pack, paint its designs in the tray (each is checked: can the pieces
//     build it?), reorder, copy, delete, set the stars.
//   * Read designs from a photo (a page of a book): the designs are found, read, and can be
//     corrected by moving their corners before they are added.
//   * Copy a pack as code (to hard-code it in src/builtinpacks.js), save or open a file, and
//     add a whole pack to the challenge book.

import { addChallenge, bookKey, DIFFICULTY, suggestDifficulty } from './book.js';
import { defaultInventory } from './board.js';
import { LOOK } from './geometry.js';
import { ICONS } from './icons.js';
import { createChecker } from './packcheck.js';
import {
  MAX_PACK_NAME,
  PACK_SIZES,
  addDesigns,
  bookShapeFor,
  builtInPacks,
  newPack,
  packFromBook,
  packToCode,
  parsePacks,
  sizeLabel,
  slugify,
} from './packs.js';
import { defaultQuad, findPatterns, insideQuad, otsu, readPattern, squareToQuad, toGray } from './photo.js';
import { flatPicture } from './render2d.js';
import { quickCheck } from './solver.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const PHOTO_MAX = 1400;

/** Load a picture file: a JPEG to show and grey pixels to read, at most PHOTO_MAX pixels long. */
async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);
    const gray = toGray(g.getImageData(0, 0, width, height).data, width, height);
    return { src: canvas.toDataURL('image/jpeg', 0.85), gray, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createPackUI(ctx) {
  const state = () => ctx.getState();
  const BUILT_IN = builtInPacks();
  let photo = null; // { src, gray, width, height, threshold, auto, rows, cols, regions, selected }
  let photoDrag = null;
  let refreshTimer = 0;
  let thresholdTimer = 0;
  let addingToBook = false;

  const checker = createChecker({
    workerSource: ctx.workerSource,
    onResult: () => {
      // Results come in one by one; redraw a moment later, once for several.
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshAfterCheck, 120);
    },
  });

  // ---- Packs and the design being painted ----------------------------------------------

  const hidden = () => state().hiddenPacks ?? [];
  /** Packs on show: the app's (unless hidden) and the user's. */
  const allPacks = () => [...BUILT_IN.filter((p) => !hidden().includes(p.id)), ...state().packs];

  function currentPack() {
    const st = state();
    let pack = allPacks().find((p) => p.id === st.packId);
    if (!pack) {
      if (!allPacks().length) st.packs.push(newPack({ name: 'My pack 1', rows: 4, cols: 4 }));
      pack = allPacks()[0];
      st.packId = pack.id;
      st.packIndex = pack.designs.length ? 0 : -1;
    }
    return pack;
  }

  const editable = (pack = currentPack()) => !pack.builtIn;

  function emptyLooks(pack) {
    return new Array(pack.rows * pack.cols).fill(LOOK.ANY);
  }

  /** The design shown in the tray: a copy of a saved design, or a new one (index -1). */
  function draft() {
    const st = state();
    const pack = currentPack();
    if (st.packIndex >= pack.designs.length) st.packIndex = pack.designs.length - 1;
    const d = st.packDraft;
    if (!d || d.packId !== pack.id || d.index !== st.packIndex || d.looks.length !== pack.rows * pack.cols) {
      const saved = pack.designs[st.packIndex];
      st.packDraft = { packId: pack.id, index: st.packIndex, looks: saved ? saved.looks.slice() : emptyLooks(pack) };
    }
    return st.packDraft;
  }

  function isDirty() {
    const pack = currentPack();
    const d = draft();
    const saved = pack.designs[d.index];
    if (!saved) return d.looks.some((l) => l !== LOOK.ANY);
    return d.looks.join('') !== saved.looks.join('');
  }

  /** Before showing another design: keep or drop unsaved changes. */
  async function leaveDraft() {
    if (!editable() || !isDirty()) return true;
    return ctx.confirmDialog('The design in the tray has changes that are not saved. Drop them?', 'Drop changes');
  }

  function changed() {
    ctx.scheduleSave();
    ctx.render();
  }

  // ---- Checking ----------------------------------------------------------------------------

  /** What is known about a design: { status: possible | impossible | unknown | pending | incomplete, reason? }. */
  function statusOf(rows, cols, looks, { first = false } = {}) {
    if (looks.some((l) => l === LOOK.ANY)) return { status: 'incomplete' };
    const known = checker.get(rows, cols, looks);
    if (known) return known;
    const quick = quickCheck(rows, cols, looks, defaultInventory(rows, cols));
    if (!quick.ok) return { status: 'impossible', reason: quick.reason };
    checker.check(rows, cols, looks, { first });
    return { status: 'pending' };
  }

  let lastDraftAsk = null;
  function draftStatus() {
    const pack = currentPack();
    const d = draft();
    if (lastDraftAsk && lastDraftAsk !== d.looks.join('')) {
      checker.drop(pack.rows, pack.cols, [...lastDraftAsk].map(Number));
    }
    lastDraftAsk = d.looks.join('');
    return statusOf(pack.rows, pack.cols, d.looks, { first: true });
  }

  function refreshAfterCheck() {
    const st = state();
    if (st.mode === 'packs') {
      if (st.packView === 'photo' && photo) {
        redrawPhoto();
        renderPhotoBar();
      } else {
        updateDraftBar();
      }
      ctx.renderPanel();
    } else if (st.mode === 'book') {
      ctx.renderPanel();
    }
  }

  function badge(s) {
    switch (s.status) {
      case 'possible': return '<span class="pk-badge ok" title="Can be built">✓</span>';
      case 'impossible': return `<span class="pk-badge bad" title="${esc(s.reason ?? 'Cannot be built')}">✗</span>`;
      case 'unknown': return '<span class="pk-badge warn" title="Could not decide">?</span>';
      case 'incomplete': return '<span class="pk-badge warn" title="Not every square is painted">…</span>';
      default: return '<span class="pk-badge" title="Checking">…</span>';
    }
  }

  function resultMarkup(s) {
    switch (s.status) {
      case 'possible': return '<div class="result is-possible"><span class="pill ok">Possible</span><p>The pieces can build this design.</p></div>';
      case 'impossible': return `<div class="result is-impossible"><span class="pill bad">Impossible</span><p>${esc(s.reason ?? 'The pieces cannot build this design.')}</p></div>`;
      case 'unknown': return `<div class="result is-unknown"><span class="pill warn">Couldn't decide</span><p>${esc(s.reason ?? '')}</p></div>`;
      case 'incomplete': return '<div class="result"><p class="muted">Paint every square. The design is checked as you paint.</p></div>';
      default: return '<div class="result is-running"><span class="spinner" aria-hidden="true"></span><p>Checking every way to place the pieces…</p></div>';
    }
  }

  // ---- The tray (stage) ----------------------------------------------------------------------

  const showingPhoto = () => state().packView === 'photo' && !!photo;

  /** What the tray paints in this tab, or null when it cannot be painted. */
  function paintGrid() {
    if (showingPhoto()) return null;
    const pack = currentPack();
    const d = draft();
    return {
      rows: pack.rows,
      cols: pack.cols,
      looks: d.looks,
      editable: editable(pack),
      paint(index, look) {
        if (!editable(pack) || index < 0 || d.looks[index] === look) return;
        d.looks[index] = look;
        ctx.renderBoard();
        updateDraftBar();
        ctx.scheduleSave();
      },
    };
  }

  function stageTopMarkup() {
    if (showingPhoto()) return '';
    const st = state();
    const pack = currentPack();
    const n = pack.designs.length;
    const i = st.packIndex;
    const where = i < 0 ? `New design <small>(not in the pack yet)</small>` : `Design ${i + 1} of ${n}`;
    return `<div class="pk-top">
<div><p class="pk-top-pack">${esc(pack.name)} <small>${sizeLabel(pack.rows, pack.cols)}${pack.builtIn ? ' · comes with the app' : ''}</small></p><p class="pk-top-where">${where}</p></div>
<div class="pk-top-nav">
<button type="button" class="tool" data-action="design-prev" ${i <= 0 ? 'disabled' : ''} title="Previous design">${ICONS.prev}<span class="sr-only">Previous design</span></button>
<button type="button" class="tool" data-action="design-next" ${i < 0 || i >= n - 1 ? 'disabled' : ''} title="Next design">${ICONS.next}<span class="sr-only">Next design</span></button>
${editable(pack) ? `<button type="button" class="tool" data-action="design-new" ${i < 0 ? 'disabled' : ''} title="Paint a new design">${ICONS.board}<span>New</span></button>` : ''}
</div></div>`;
  }

  function draftActionsMarkup() {
    const pack = currentPack();
    const st = state();
    const d = draft();
    if (!editable(pack)) {
      return `<p class="muted">This pack comes with the app, so it cannot be changed here. Make a copy to change it.</p>
<div class="row-buttons"><button type="button" class="btn small primary" data-action="pack-copy">${ICONS.copy}Make a copy to edit</button>
${d.index >= 0 ? `<button type="button" class="btn small" data-action="design-play">${ICONS.play}Play in Build</button>` : ''}</div>`;
    }
    const s = draftStatus();
    const dirty = isDirty();
    const canSave = dirty && (s.status === 'possible' || s.status === 'unknown');
    const isNew = st.packIndex < 0;
    const why = !dirty ? '' : s.status === 'impossible' ? 'Only designs that can be built are saved. ' : s.status === 'incomplete' ? 'Paint every square to save. ' : s.status === 'pending' ? 'Wait for the check to finish. ' : '';
    return `<div class="row-buttons">
<button type="button" class="btn small primary" data-action="draft-save" ${canSave ? '' : 'disabled'}>${ICONS.check}${isNew ? 'Add to the pack' : 'Save changes'}</button>
<button type="button" class="btn small" data-action="draft-revert" ${dirty ? '' : 'disabled'}>${ICONS.undo}${isNew ? 'Clear' : 'Undo changes'}</button>
${isNew ? '' : `<button type="button" class="btn small" data-action="design-play" ${dirty ? 'disabled' : ''}>${ICONS.play}Play in Build</button>`}
</div>${why ? `<p class="hint">${why}</p>` : ''}`;
  }

  function stageBarMarkup() {
    if (showingPhoto()) return photoBarMarkup();
    const pack = currentPack();
    const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
    const paint = editable(pack)
      ? `${ctx.paletteMarkup()}<p class="hint">${fine ? '<b>Left-click</b> paints a square, <b>right-click</b> erases it. Drag to paint several.' : 'Tap or drag to paint. Choose <b>Erase</b> to clear squares.'}</p>`
      : '';
    return `<div class="check-result" id="packResult" aria-live="polite">${resultMarkup(draftStatus())}</div>
<div class="pk-draft-actions" id="packDraftActions">${draftActionsMarkup()}</div>
${paint}`;
  }

  /** Redraw the check result and the save buttons (cheaper than the whole bar while painting). */
  function updateDraftBar() {
    if (state().mode !== 'packs' || showingPhoto()) return;
    const box = document.getElementById('packResult');
    if (box) box.innerHTML = resultMarkup(draftStatus());
    const actions = document.getElementById('packDraftActions');
    if (actions) actions.innerHTML = draftActionsMarkup();
  }

  // ---- Panel ---------------------------------------------------------------------------------

  function packsCard() {
    const st = state();
    const pack = currentPack();
    const chip = (p) => `<button type="button" class="chip${p.id === pack.id ? ' is-on' : ''}" data-action="pack-select" data-id="${esc(p.id)}" aria-pressed="${p.id === pack.id}">${esc(p.name)} <small>${sizeLabel(p.rows, p.cols)} · ${p.designs.length}</small></button>`;
    const mine = st.packs.map(chip).join('');
    const sizes = PACK_SIZES.map((s) => `<button type="button" class="chip" data-action="pack-new" data-rows="${s.rows}" data-cols="${s.cols}">+ ${sizeLabel(s.rows, s.cols)}</button>`).join('');
    const book = ctx.currentBook();
    return `<section class="card" aria-labelledby="packs-h">
<h2 id="packs-h">Packs</h2>
<p class="field-label">Yours</p>
${mine ? `<div class="chips tight" role="group" aria-label="Your packs">${mine}</div>` : '<p class="muted">None yet. Start one below, copy one that comes with the app, or read one from a photo.</p>'}
${BUILT_IN.length > hidden().length ? `<p class="field-label">Come with the app</p>
<div class="chips tight" role="group" aria-label="Packs that come with the app">${BUILT_IN.filter((p) => !hidden().includes(p.id)).map(chip).join('')}</div>` : ''}
${hidden().length ? `<div class="row-buttons"><button type="button" class="btn small" data-action="pack-unhide">Show ${plural(hidden().length, 'hidden pack')} again</button></div>` : ''}
<p class="field-label">Start a new pack (tray size)</p>
<div class="chips tight" role="group" aria-label="New pack">${sizes}</div>
<div class="row-buttons"><button type="button" class="btn small" data-action="pack-from-book" ${book.challenges.length ? '' : 'disabled'}>${ICONS.book}New pack from the book “${esc(book.title)}”</button></div>
</section>`;
  }

  function designsCard() {
    const st = state();
    const pack = currentPack();
    const canEdit = editable(pack);
    const thumbCell = Math.max(5, Math.round(64 / Math.max(pack.rows, pack.cols)));
    const items = pack.designs.map((d, i) => {
      const s = statusOf(pack.rows, pack.cols, d.looks);
      const on = i === st.packIndex;
      return `<li><button type="button" class="pk-item${on ? ' is-on' : ''}${s.status === 'impossible' ? ' is-bad' : ''}" data-action="design-select" data-index="${i}" aria-pressed="${on}" aria-label="Design ${i + 1}">
<span class="pk-num">${i + 1}</span>${badge(s)}<span class="pk-thumb">${flatPicture(pack.rows, pack.cols, d.looks, { cell: thumbCell, gap: 1 })}</span>
<span class="pk-stars level-${d.stars}" aria-hidden="true">${'★'.repeat(d.stars)}</span></button></li>`;
    }).join('');
    const sel = pack.designs[st.packIndex];
    const i = st.packIndex;
    const bad = pack.designs.filter((d) => statusOf(pack.rows, pack.cols, d.looks).status === 'impossible').length;
    const buildFits = ctx.buildFits(pack.rows, pack.cols);
    const selTools = sel ? `<div class="pk-sel">
<span class="ch-stars" role="group" aria-label="Difficulty of design ${i + 1}">${[1, 2, 3].map((level) => `<button type="button" class="star-btn level-${sel.stars}${level <= sel.stars ? ' on' : ''}" data-action="design-stars" data-level="${level}" aria-label="${DIFFICULTY[level].name}" aria-pressed="${level === sel.stars}" ${canEdit ? '' : 'disabled'}>★</button>`).join('')}</span>
${canEdit ? `<span class="ch-actions">
<button type="button" class="icon-btn" data-action="design-up" ${i === 0 ? 'disabled' : ''} title="Move earlier">${ICONS.prev}<span class="sr-only">Move design ${i + 1} earlier</span></button>
<button type="button" class="icon-btn" data-action="design-down" ${i === pack.designs.length - 1 ? 'disabled' : ''} title="Move later">${ICONS.next}<span class="sr-only">Move design ${i + 1} later</span></button>
<button type="button" class="icon-btn" data-action="design-copy" title="Duplicate">${ICONS.copy}<span class="sr-only">Duplicate design ${i + 1}</span></button>
<button type="button" class="icon-btn" data-action="design-delete" title="Delete">${ICONS.trash}<span class="sr-only">Delete design ${i + 1}</span></button>
</span>` : ''}</div>` : '';
    const add = canEdit ? `<p class="field-label">Add a design</p>
<div class="row-buttons">
<button type="button" class="btn small" data-action="design-new" ${i < 0 ? 'disabled' : ''}>${ICONS.board}Paint a new one</button>
${[1, 2, 3].map((level) => `<button type="button" class="btn small level level-${level}" data-action="design-random" data-level="${level}" title="A random design that can be built">${ICONS.dice}<span class="stars level-${level}"><span aria-hidden="true">${'★'.repeat(level)}</span><span class="sr-only">${DIFFICULTY[level].name}</span></span></button>`).join('')}
<button type="button" class="btn small" data-action="design-from-build" ${buildFits ? '' : 'disabled'} title="${buildFits ? 'Copy the picture of the Build tray' : `Fill a ${sizeLabel(pack.rows, pack.cols)} Build tray first`}">+ Build tray</button>
</div>` : '';
    return `<section class="card" aria-labelledby="designs-h">
<h2 id="designs-h">${esc(pack.name)} <small>${sizeLabel(pack.rows, pack.cols)} · ${plural(pack.designs.length, 'design')}</small></h2>
${canEdit ? `<label class="field-label" for="packName">Name</label><input class="text-input" id="packName" maxlength="${MAX_PACK_NAME}" value="${esc(pack.name)}" autocomplete="off">` : ''}
${items ? `<ol class="pk-grid">${items}</ol>` : '<p class="muted">No designs yet.</p>'}
${bad ? `<p class="hint is-bad">${plural(bad, 'design')} cannot be built (marked ✗). Open ${bad === 1 ? 'it' : 'them'} and fix the squares; ${bad === 1 ? 'it is' : 'they are'} left out of the book.</p>` : ''}
${selTools}
${add}
<div class="row-buttons pk-pack-actions">
<button type="button" class="btn small" data-action="pack-copy">${ICONS.copy}Duplicate pack</button>
${canEdit ? `<button type="button" class="btn small" data-action="pack-delete">${ICONS.trash}Delete pack</button>` : `<button type="button" class="btn small" data-action="pack-hide">${ICONS.trash}Hide pack</button>`}
</div>
</section>`;
  }

  function useCard() {
    const pack = currentPack();
    const shape = bookShapeFor(pack.rows, pack.cols);
    const book = ctx.bookFor(shape.shape, shape.n);
    return `<section class="card" aria-labelledby="use-h">
<h2 id="use-h">Book and cards</h2>
<p class="muted">Adds every design that can be built to your ${sizeLabel(pack.rows, pack.cols)} book “${esc(book.title)}” (${plural(book.challenges.length, 'challenge')} now), with its stars. Designs already in the book are skipped. Each challenge in the book is also a card.</p>
<div class="row-buttons"><button type="button" class="btn primary" data-action="pack-to-book" ${pack.designs.length && !addingToBook ? '' : 'disabled'}>${ICONS.book}Add the pack to the book</button></div>
</section>`;
  }

  function exportCard() {
    const pack = currentPack();
    return `<section class="card" aria-labelledby="pkx-h">
<h2 id="pkx-h">Copy, save, open</h2>
<div class="row-buttons">
<button type="button" class="btn primary" data-action="pack-copy-code" ${pack.designs.length ? '' : 'disabled'}>${ICONS.copy}Copy as code</button>
<button type="button" class="btn" data-action="pack-save" ${pack.designs.length ? '' : 'disabled'}>${ICONS.download}Save pack (.json)</button>
<button type="button" class="btn" data-action="pack-open">${ICONS.upload}Open a pack file</button>
</div>
<p class="hint"><b>Copy as code</b> gives the pack as text. To build it into the app, paste it into the list in <code>src/builtinpacks.js</code>, or send it to whoever looks after the app. The same text can be pasted below to open it again.</p>
<details class="share"><summary>Paste a pack</summary>
<label class="sr-only" for="packPaste">Pack as text</label>
<textarea id="packPaste" class="pk-paste" rows="5" placeholder='{ "name": "My pack", "rows": 4, "cols": 4, "designs": [ { "looks": "1121/1122/1122/1122", "stars": 1 } ] }' spellcheck="false"></textarea>
<div class="row-buttons"><button type="button" class="btn small" data-action="pack-paste">Open pasted pack</button></div>
</details>
</section>`;
  }

  function photoCard() {
    const pack = currentPack();
    if (!photo) {
      return `<section class="card" aria-labelledby="photo-h">
<h2 id="photo-h">Designs from a photo</h2>
<p class="muted">Take a photo of a page of a book of designs (flat, in good light, straight from above). The designs on it are found and read, and you can check and fix them before they go into a pack.</p>
<div class="row-buttons"><button type="button" class="btn primary" data-action="photo-upload">${ICONS.upload}Choose a photo</button></div>
<p class="hint">Designs are read as ${sizeLabel(pack.rows, pack.cols)} (the size of this pack); you can change that after.</p>
</section>`;
    }
    const sizes = PACK_SIZES.map((s) => {
      const on = s.rows === photo.rows && s.cols === photo.cols;
      return `<button type="button" class="chip${on ? ' is-on' : ''}" data-action="photo-size" data-rows="${s.rows}" data-cols="${s.cols}" aria-pressed="${on}">${sizeLabel(s.rows, s.cols)}</button>`;
    }).join('');
    const viewing = state().packView === 'photo';
    return `<section class="card" aria-labelledby="photo-h">
<h2 id="photo-h">Designs from a photo <small>${plural(photo.regions.length, 'design')} found</small></h2>
${viewing ? '' : `<div class="row-buttons"><button type="button" class="btn primary" data-action="photo-show">Back to the photo</button></div>`}
<p class="field-label">Size of the designs in the photo</p>
<div class="chips tight" role="group" aria-label="Size of the designs">${sizes}</div>
<label class="field-label" for="photoThreshold">Dark or light: <output id="photoThresholdOut">${photo.threshold}</output> <small>(automatic: ${photo.auto})</small></label>
<input type="range" id="photoThreshold" class="pk-range" min="20" max="235" value="${photo.threshold}">
<p class="hint">Move it if light grey squares are read as black (move left) or black squares as white (move right).</p>
<div class="row-buttons">
<button type="button" class="btn small" data-action="photo-detect">${ICONS.rotate}Find the designs again</button>
<button type="button" class="btn small" data-action="photo-upload">${ICONS.upload}Another photo</button>
<button type="button" class="btn small" data-action="photo-close">${ICONS.close}Close the photo</button>
</div>
</section>`;
  }

  function panelMarkup() {
    const showPhotoFirst = showingPhoto();
    return showPhotoFirst
      ? `${photoCard()}${designsCard()}${useCard()}${exportCard()}${packsCard()}`
      : `${packsCard()}${designsCard()}${photoCard()}${useCard()}${exportCard()}`;
  }

  // ---- Photo stage -------------------------------------------------------------------------

  /** A found design's check; one that cannot be built is not ticked, unless the user ticked it. */
  function regionStatus(region) {
    // While a corner is being dragged the design changes all the time: check it once let go.
    const s = photoDrag ? (checker.get(photo.rows, photo.cols, region.looks) ?? { status: 'pending' }) : statusOf(photo.rows, photo.cols, region.looks);
    if (!region.userSet && s.status !== 'pending') region.include = s.status !== 'impossible';
    return s;
  }

  function readRegion(region) {
    const res = readPattern(photo.gray, region.quad, photo.rows, photo.cols, photo.threshold);
    region.looks = res.looks;
    region.unsure = res.unsure;
  }

  function detect() {
    const quads = findPatterns(photo.gray, { rows: photo.rows, cols: photo.cols, threshold: photo.threshold });
    photo.regions = quads.map((quad) => ({ quad, include: true, userSet: false, looks: [], unsure: [] }));
    photo.regions.forEach(readRegion);
    photo.selected = photo.regions.length ? 0 : -1;
  }

  const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  function photoSvgContent() {
    const { width, height, rows, cols } = photo;
    const unit = Math.max(width, height);
    const sw = (unit / 600).toFixed(2);
    let regions = '';
    photo.regions.forEach((region, i) => {
      const map = squareToQuad(region.quad);
      let grid = '';
      for (let c = 1; c < cols; c += 1) grid += `M${map(c / cols, 0).map((v) => v.toFixed(1)).join(' ')}L${map(c / cols, 1).map((v) => v.toFixed(1)).join(' ')}`;
      for (let r = 1; r < rows; r += 1) grid += `M${map(0, r / rows).map((v) => v.toFixed(1)).join(' ')}L${map(1, r / rows).map((v) => v.toFixed(1)).join(' ')}`;
      let unsure = '';
      region.unsure.forEach((u, k) => {
        if (!u) return;
        const r = Math.floor(k / cols);
        const c = k % cols;
        unsure += `<polygon class="ph-unsure" points="${pts([map(c / cols, r / rows), map((c + 1) / cols, r / rows), map((c + 1) / cols, (r + 1) / rows), map(c / cols, (r + 1) / rows)])}" stroke-width="${sw * 2}"/>`;
      });
      const s = regionStatus(region);
      const tone = !region.include ? 'is-off' : s.status === 'impossible' ? 'is-bad' : 'is-ok';
      const [lx, ly] = region.quad[0];
      const fs = unit / 32;
      regions += `<g class="ph-region ${tone}${i === photo.selected ? ' is-on' : ''}">
<polygon class="ph-area" points="${pts(region.quad)}" stroke-width="${sw * (i === photo.selected ? 3 : 2)}"/>
<path class="ph-grid" d="${grid}" stroke-width="${sw}"/>${unsure}
<g class="ph-label"><rect x="${(lx - fs * 0.1).toFixed(1)}" y="${(ly - fs * 1.15).toFixed(1)}" width="${(fs * (String(i + 1).length * 0.65 + 0.6)).toFixed(1)}" height="${(fs * 1.1).toFixed(1)}" rx="${(fs * 0.2).toFixed(1)}"/>
<text x="${(lx + fs * 0.2).toFixed(1)}" y="${(ly - fs * 0.27).toFixed(1)}" font-size="${fs.toFixed(1)}">${i + 1}</text></g></g>`;
    });
    let handles = '';
    const sel = photo.regions[photo.selected];
    if (sel) {
      const rad = unit / 55;
      handles = sel.quad.map(([x, y], k) => `<circle class="ph-handle" data-corner="${k}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" stroke-width="${sw * 2}"/>`).join('');
    }
    return `<image href="${photo.src}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>${regions}${handles}`;
  }

  function renderPhotoStage(container) {
    let svg = container.querySelector('#photoSvg');
    if (!svg) {
      container.innerHTML = `<div class="ph-head"><p><b>${plural(photo.regions.length, 'design')} found.</b> Tap a design to select it, then drag its corners onto the corners of the design (or drag inside it to move it).</p></div>
<div class="ph-wrap"><svg id="photoSvg" xmlns="http://www.w3.org/2000/svg" role="application" aria-label="Photo with the designs found on it"></svg></div>`;
      svg = container.querySelector('#photoSvg');
      svg.addEventListener('pointerdown', onPhotoDown);
      svg.addEventListener('pointermove', onPhotoMove);
      svg.addEventListener('pointerup', onPhotoUp);
      svg.addEventListener('pointercancel', onPhotoUp);
      // The photo lets the page scroll; a touch that starts on a design or a corner moves it.
      svg.addEventListener('touchstart', (evt) => {
        if (!evt.cancelable || evt.touches.length !== 1) return;
        const hit = photoHit(evt.touches[0]);
        if (hit && (hit.kind === 'corner' || hit.region === photo.selected)) evt.preventDefault();
      }, { passive: false });
    }
    const head = container.querySelector('.ph-head b');
    if (head) head.textContent = `${plural(photo.regions.length, 'design')} found.`;
    svg.setAttribute('viewBox', `0 0 ${photo.width} ${photo.height}`);
    svg.innerHTML = photoSvgContent();
  }

  function redrawPhoto() {
    const svg = document.getElementById('photoSvg');
    if (svg) svg.innerHTML = photoSvgContent();
  }

  function photoBarMarkup() {
    const { rows, cols } = photo;
    const thumbCell = Math.max(4, Math.round(56 / Math.max(rows, cols)));
    const list = photo.regions.map((region, i) => {
      const s = regionStatus(region);
      const note = s.status === 'impossible' ? 'cannot be built' : s.status === 'possible' ? '' : s.status === 'unknown' ? 'not sure' : 'checking…';
      const unsure = region.unsure.filter(Boolean).length;
      return `<li class="ph-item${i === photo.selected ? ' is-on' : ''}${s.status === 'impossible' ? ' is-bad' : ''}">
<button type="button" class="ph-pick" data-action="photo-select" data-index="${i}" aria-pressed="${i === photo.selected}"><span class="pk-num">${i + 1}</span>${badge(s)}<span class="pk-thumb">${flatPicture(rows, cols, region.looks, { cell: thumbCell, gap: 1, mismatches: region.unsure })}</span></button>
<label class="ph-include"><input type="checkbox" data-region="${i}" ${region.include ? 'checked' : ''}> Add</label>
${note || unsure ? `<span class="ph-note">${note}${note && unsure ? ' · ' : ''}${unsure ? `${unsure} unsure` : ''}</span>` : ''}
</li>`;
    }).join('');
    const count = photo.regions.filter((r) => r.include).length;
    const pack = currentPack();
    const into = editable(pack) && pack.rows === rows && pack.cols === cols ? `to “${esc(pack.name)}”` : 'to a new pack';
    return `<div class="ph-bar" id="photoBar">
${photo.regions.length ? `<ol class="ph-list">${list}</ol>` : '<p class="muted">No designs found. Check the size of the designs and the dark/light setting in the panel, or add one by hand.</p>'}
<p class="hint">Squares outlined in red were hard to read. Designs that cannot be built are not ticked; you can still add them and fix them in the pack.</p>
<div class="row-buttons">
<button type="button" class="btn primary" data-action="photo-add" ${count ? '' : 'disabled'}>${ICONS.check}Add ${plural(count, 'design')} ${into}</button>
<button type="button" class="btn small" data-action="photo-add-region">+ Mark a design by hand</button>
<button type="button" class="btn small" data-action="photo-remove-region" ${photo.selected >= 0 ? '' : 'disabled'}>${ICONS.trash}Remove design ${photo.selected >= 0 ? photo.selected + 1 : ''}</button>
<button type="button" class="btn small" data-action="photo-hide">Back to the pack</button>
</div></div>`;
  }

  function renderPhotoBar() {
    const bar = document.getElementById('stageBar');
    if (bar && showingPhoto()) bar.innerHTML = photoBarMarkup();
  }

  function photoPoint(evt) {
    const svg = document.getElementById('photoSvg');
    const m = svg?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(m.inverse());
    return [p.x, p.y, Math.hypot(m.a, m.b) || 1];
  }

  /** What a press at a point of the screen would take hold of: a corner, a design, or null. */
  function photoHit(evt) {
    const at = photoPoint(evt);
    if (!at) return null;
    const [x, y, scale] = at;
    const reach = Math.max(photo.width, photo.height) / 30 + 14 / scale;
    const sel = photo.regions[photo.selected];
    let target = null;
    if (sel) {
      let best = -1;
      let bestD = reach;
      sel.quad.forEach(([cx, cy], k) => {
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best >= 0) target = { kind: 'corner', region: photo.selected, corner: best };
    }
    if (!target) {
      // Inside a design: select it (the selected one first, when designs overlap) and move it.
      const order = [photo.selected, ...photo.regions.map((_, i) => i).filter((i) => i !== photo.selected)];
      const hit = order.find((i) => i >= 0 && insideQuad(photo.regions[i].quad, x, y));
      if (hit !== undefined) target = { kind: 'move', region: hit };
    }
    return target ? { ...target, x, y } : null;
  }

  function onPhotoDown(evt) {
    if (evt.button !== 0) return;
    const target = photoHit(evt);
    if (!target) return; // let the page scroll
    const { x, y } = target;
    if (target.kind === 'move' && target.region !== photo.selected && evt.pointerType !== 'mouse') {
      // A finger on another design selects it; the page can still scroll from there.
      photo.selected = target.region;
      redrawPhoto();
      renderPhotoBar();
      return;
    }
    evt.preventDefault();
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    const changedSel = target.region !== photo.selected;
    photo.selected = target.region;
    photoDrag = { ...target, id: evt.pointerId, x, y, start: photo.regions[target.region].quad.map((p) => p.slice()), moved: false };
    if (changedSel) {
      redrawPhoto();
      renderPhotoBar();
    }
  }

  function onPhotoMove(evt) {
    if (!photoDrag || evt.pointerId !== photoDrag.id) return;
    const at = photoPoint(evt);
    if (!at) return;
    evt.preventDefault();
    const [x, y] = at;
    const dx = x - photoDrag.x;
    const dy = y - photoDrag.y;
    if (!photoDrag.moved && Math.hypot(dx, dy) < 2) return;
    photoDrag.moved = true;
    const region = photo.regions[photoDrag.region];
    const clamp = ([px, py]) => [Math.max(0, Math.min(photo.width, px)), Math.max(0, Math.min(photo.height, py))];
    if (photoDrag.kind === 'corner') {
      region.quad = photoDrag.start.map((p, k) => (k === photoDrag.corner ? clamp([p[0] + dx, p[1] + dy]) : p.slice()));
    } else {
      region.quad = photoDrag.start.map(([px, py]) => clamp([px + dx, py + dy]));
    }
    readRegion(region);
    redrawPhoto();
  }

  function onPhotoUp(evt) {
    if (!photoDrag || evt.pointerId !== photoDrag.id) return;
    const moved = photoDrag.moved;
    photoDrag = null;
    if (moved) {
      redrawPhoto();
      renderPhotoBar();
    }
  }

  async function openPhoto(file) {
    const pack = currentPack();
    ctx.setStatus('Reading the photo…', false);
    let loaded;
    try {
      loaded = await loadPhoto(file);
    } catch {
      ctx.setStatus('That picture could not be opened. Try a JPEG or PNG.', true, 'bad');
      return;
    }
    const auto = otsu(loaded.gray);
    photo = { ...loaded, threshold: auto, auto, rows: photo?.rows ?? pack.rows, cols: photo?.cols ?? pack.cols, regions: [], selected: -1 };
    detect();
    state().packView = 'photo';
    ctx.render();
    ctx.setStatus(photo.regions.length
      ? `Found ${plural(photo.regions.length, 'design')}. Check each one: move its corners if its grid does not sit on the squares.`
      : 'No designs found. Check the size of the designs, or mark one by hand.', true, photo.regions.length ? '' : 'bad');
    document.getElementById('photoStage')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function addFromPhoto() {
    const st = state();
    const chosen = photo.regions.filter((r) => r.include);
    if (!chosen.length) return;
    let pack = currentPack();
    if (!editable(pack) || pack.rows !== photo.rows || pack.cols !== photo.cols) {
      if (!(await leaveDraft())) return;
      pack = newPack({ name: 'From a photo', rows: photo.rows, cols: photo.cols });
      st.packs.push(pack);
      st.packId = pack.id;
    }
    const { added, duplicates } = addDesigns(pack, chosen.map((r) => ({ looks: r.looks, stars: suggestDifficulty(r.looks) })));
    st.packIndex = pack.designs.length ? pack.designs.length - added : -1;
    st.packDraft = null;
    st.packView = 'design';
    changed();
    ctx.setStatus(`Added ${plural(added, 'design')} to “${pack.name}”.${duplicates ? ` ${plural(duplicates, 'design')} ${duplicates === 1 ? 'was' : 'were'} already in it.` : ''}`);
  }

  // ---- Book ------------------------------------------------------------------------------------

  /** Add every buildable design of a pack to the book of its size. */
  async function addPackToBook(pack, { show = true } = {}) {
    if (addingToBook || !pack?.designs.length) return;
    const st = state();
    const shape = bookShapeFor(pack.rows, pack.cols);
    const book = ctx.bookFor(shape.shape, shape.n);
    addingToBook = true;
    ctx.renderPanel();
    let added = 0;
    let already = 0;
    let impossible = 0;
    let unsure = 0;
    try {
      const inBook = new Set(book.challenges.map((c) => c.looks.join('')));
      for (let i = 0; i < pack.designs.length; i += 1) {
        const d = pack.designs[i];
        if (inBook.has(d.looks.join(''))) {
          already += 1;
          continue;
        }
        ctx.setStatus(`Checking design ${i + 1} of ${pack.designs.length}…`, false);
        const quick = quickCheck(pack.rows, pack.cols, d.looks, defaultInventory(pack.rows, pack.cols));
        const res = quick.ok ? await checker.check(pack.rows, pack.cols, d.looks) : { status: 'impossible' };
        if (res.status === 'impossible') impossible += 1;
        else if (res.status !== 'possible') unsure += 1;
        else {
          addChallenge(book, { looks: d.looks, answer: res.pieces, difficulty: d.stars });
          inBook.add(d.looks.join(''));
          added += 1;
        }
      }
    } finally {
      addingToBook = false;
    }
    st.bookKey = bookKey(shape.shape, shape.n);
    st.bookLeaf = 0;
    ctx.bookChanged();
    if (show) st.mode = 'book';
    ctx.render();
    const notes = [
      already ? `${already} already there` : '',
      impossible ? `${impossible} cannot be built` : '',
      unsure ? `${unsure} could not be checked` : '',
    ].filter(Boolean).join(', ');
    ctx.setStatus(`Added ${plural(added, 'design')} from “${pack.name}” to the book “${book.title}”${notes ? ` (${notes}, left out)` : ''}.`, true, added ? 'ok' : '');
  }

  // ---- Files -----------------------------------------------------------------------------------

  function openPacks(text, source) {
    let packs;
    try {
      packs = parsePacks(text);
    } catch (err) {
      ctx.setStatus(err.message, true, 'bad');
      return false;
    }
    const st = state();
    for (const p of packs) {
      p.id = newPack({ rows: p.rows, cols: p.cols }).id;
      p.builtIn = false;
      st.packs.push(p);
    }
    st.packId = packs[0].id;
    st.packIndex = packs[0].designs.length ? 0 : -1;
    st.packDraft = null;
    st.packView = 'design';
    changed();
    ctx.setStatus(packs.length === 1 ? `Opened “${packs[0].name}” (${plural(packs[0].designs.length, 'design')}) from ${source}.` : `Opened ${packs.length} packs from ${source}.`);
    return true;
  }

  // ---- Actions -----------------------------------------------------------------------------------

  async function selectDesign(index) {
    const st = state();
    if (index === st.packIndex) return;
    if (!(await leaveDraft())) return;
    st.packIndex = index;
    st.packDraft = null;
    st.packView = 'design';
    changed();
  }

  function moveDesign(step) {
    const st = state();
    const list = currentPack().designs;
    const i = st.packIndex;
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    st.packIndex = j;
    if (st.packDraft) st.packDraft.index = j;
    changed();
  }

  function pickFile(accept, onFile) {
    const input = document.getElementById('filePicker');
    input.value = '';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) onFile(file);
    };
    input.click();
  }

  const actions = {
    'pack-select': async (el) => {
      const st = state();
      if (el.dataset.id === st.packId) return;
      if (!(await leaveDraft())) return;
      st.packId = el.dataset.id;
      st.packIndex = currentPack().designs.length ? 0 : -1;
      st.packDraft = null;
      st.packView = 'design';
      changed();
    },
    'pack-new': async (el) => {
      if (!(await leaveDraft())) return;
      const st = state();
      const rows = Number(el.dataset.rows);
      const cols = Number(el.dataset.cols);
      const mine = st.packs.length + 1;
      const pack = newPack({ name: `My pack ${mine}`, rows, cols });
      st.packs.push(pack);
      st.packId = pack.id;
      st.packIndex = -1;
      st.packDraft = null;
      st.packView = 'design';
      changed();
      ctx.setStatus(`New ${sizeLabel(rows, cols)} pack. Paint its first design in the tray, or add random ones.`);
    },
    'pack-copy': async () => {
      if (!(await leaveDraft())) return;
      const st = state();
      const from = currentPack();
      const pack = newPack({ name: `${from.name} (copy)`.slice(0, MAX_PACK_NAME), rows: from.rows, cols: from.cols });
      pack.designs = from.designs.map((d) => ({ looks: d.looks.slice(), stars: d.stars }));
      st.packs.push(pack);
      st.packId = pack.id;
      st.packIndex = Math.min(Math.max(st.packIndex, 0), pack.designs.length - 1);
      st.packDraft = null;
      changed();
      ctx.setStatus(`Made “${pack.name}”: your own copy, ready to change.`);
    },
    'pack-delete': async () => {
      const st = state();
      const pack = currentPack();
      if (!editable(pack)) return;
      if (!(await ctx.confirmDialog(`Delete the pack “${pack.name}” and its ${plural(pack.designs.length, 'design')}?`, 'Delete pack'))) return;
      st.packs = st.packs.filter((p) => p.id !== pack.id);
      st.packId = '';
      st.packDraft = null;
      currentPack();
      changed();
      ctx.setStatus(`Deleted “${pack.name}”.`);
    },
    'pack-hide': async () => {
      const st = state();
      const pack = currentPack();
      if (!pack.builtIn) return;
      if (!(await ctx.confirmDialog(`Hide “${pack.name}”? It comes with the app, so it cannot be deleted, but it will no longer show here, in the book or in games. You can show it again under Packs.`, 'Hide pack'))) return;
      st.hiddenPacks = [...hidden(), pack.id];
      st.packId = '';
      st.packDraft = null;
      currentPack();
      changed();
      ctx.setStatus(`Hid “${pack.name}”.`);
    },
    'pack-unhide': () => {
      state().hiddenPacks = [];
      changed();
      ctx.setStatus('The packs that come with the app are back.');
    },
    'pack-from-book': async () => {
      if (!(await leaveDraft())) return;
      const st = state();
      const pack = packFromBook(ctx.currentBook());
      st.packs.push(pack);
      st.packId = pack.id;
      st.packIndex = pack.designs.length ? 0 : -1;
      st.packDraft = null;
      st.packView = 'design';
      changed();
      ctx.setStatus(`Made the pack “${pack.name}” from the book's ${plural(pack.designs.length, 'challenge')}.`);
    },
    'design-select': (el) => selectDesign(Number(el.dataset.index)),
    'design-prev': () => selectDesign(Math.max(0, state().packIndex - 1)),
    'design-next': () => selectDesign(Math.min(currentPack().designs.length - 1, state().packIndex + 1)),
    'design-new': () => selectDesign(-1),
    'design-random': async (el) => {
      if (!(await leaveDraft())) return;
      const st = state();
      const pack = currentPack();
      const level = Number(el.dataset.level);
      // A random arrangement of the real pieces, so it can always be built; a few tries to
      // find one the pack does not have yet.
      let made = null;
      for (let k = 0; k < 8 && !made; k += 1) {
        const { target } = ctx.randomChallenge(pack.rows, pack.cols, level);
        if (!pack.designs.some((d) => d.looks.join('') === target.join(''))) made = target;
      }
      if (!made) {
        ctx.setStatus('Could not find a new design of that kind; try another level.', true, 'bad');
        return;
      }
      pack.designs.push({ looks: made, stars: level });
      st.packIndex = pack.designs.length - 1;
      st.packDraft = null;
      st.packView = 'design';
      changed();
      ctx.setStatus(`Added design ${pack.designs.length} (${DIFFICULTY[level].name.toLowerCase()}). Paint over it to change it.`);
    },
    'design-from-build': async () => {
      const pack = currentPack();
      if (!ctx.buildFits(pack.rows, pack.cols)) return;
      if (!(await leaveDraft())) return;
      const st = state();
      st.packIndex = -1;
      st.packDraft = { packId: pack.id, index: -1, looks: ctx.buildLooks() };
      st.packView = 'design';
      changed();
      ctx.setStatus('Copied the Build tray as a new design. Add it to the pack, or paint over it first.');
    },
    'design-stars': (el) => {
      const pack = currentPack();
      const d = pack.designs[state().packIndex];
      if (!d || !editable(pack)) return;
      d.stars = Number(el.dataset.level);
      changed();
    },
    'design-up': () => moveDesign(-1),
    'design-down': () => moveDesign(1),
    'design-copy': () => {
      const st = state();
      const pack = currentPack();
      const d = pack.designs[st.packIndex];
      if (!d) return;
      st.packIndex = -1;
      st.packDraft = { packId: pack.id, index: -1, looks: d.looks.slice() };
      changed();
      ctx.setStatus('A copy of the design is in the tray. Change it, then add it to the pack.');
    },
    'design-delete': async () => {
      const st = state();
      const pack = currentPack();
      const i = st.packIndex;
      if (i < 0 || !editable(pack)) return;
      if (!(await ctx.confirmDialog(`Delete design ${i + 1} from “${pack.name}”?`, 'Delete'))) return;
      pack.designs.splice(i, 1);
      st.packIndex = Math.min(i, pack.designs.length - 1);
      st.packDraft = null;
      changed();
    },
    'design-play': () => {
      const st = state();
      const pack = currentPack();
      const d = pack.designs[st.packIndex];
      if (!d) return;
      const known = checker.get(pack.rows, pack.cols, d.looks);
      ctx.startChallenge({ target: d.looks.slice(), answer: known?.pieces ?? null, difficulty: d.stars, label: `${pack.name}, design ${st.packIndex + 1}`, rows: pack.rows, cols: pack.cols });
    },
    'draft-save': () => {
      const st = state();
      const pack = currentPack();
      const d = draft();
      const s = draftStatus();
      if (!editable(pack) || !isDirty() || (s.status !== 'possible' && s.status !== 'unknown')) return;
      const twin = pack.designs.findIndex((x, k) => k !== d.index && x.looks.join('') === d.looks.join(''));
      if (twin >= 0) {
        ctx.setStatus(`Design ${twin + 1} of the pack is already exactly this.`, true, 'bad');
        return;
      }
      if (d.index < 0) {
        pack.designs.push({ looks: d.looks.slice(), stars: suggestDifficulty(d.looks) });
        st.packIndex = pack.designs.length - 1;
        ctx.setStatus(`Added design ${pack.designs.length} to “${pack.name}”. Set its stars in the panel.`, true, 'ok');
      } else {
        pack.designs[d.index].looks = d.looks.slice();
        ctx.setStatus(`Saved design ${d.index + 1}.`, true, 'ok');
      }
      st.packDraft = null;
      changed();
    },
    'draft-revert': () => {
      state().packDraft = null;
      changed();
    },
    'pack-to-book': () => addPackToBook(currentPack()),
    'pack-copy-code': () => ctx.copyText(packToCode(currentPack()), 'Pack code'),
    'pack-save': async () => {
      const pack = currentPack();
      const name = `${slugify(pack.name)}.pack.json`;
      const res = await ctx.saveFile(name, packToCode(pack), 'application/json');
      if (res === 'saved') ctx.setStatus(`Saved ${name}. Open it later with “Open a pack file”.`);
      else if (res === 'failed') ctx.setStatus('Saving is blocked here. Use “Copy as code” and keep the text somewhere safe.', true, 'bad');
    },
    'pack-open': () => pickFile('application/json,.json,.js,.txt', async (file) => openPacks(await file.text(), file.name)),
    'pack-paste': () => {
      const box = document.getElementById('packPaste');
      if (box && openPacks(box.value, 'the pasted text')) box.value = '';
    },
    'photo-upload': () => pickFile('image/*', openPhoto),
    'photo-show': () => {
      state().packView = 'photo';
      changed();
    },
    'photo-hide': () => {
      state().packView = 'design';
      changed();
    },
    'photo-close': () => {
      photo = null;
      state().packView = 'design';
      changed();
    },
    'photo-size': (el) => {
      photo.rows = Number(el.dataset.rows);
      photo.cols = Number(el.dataset.cols);
      detect();
      changed();
      ctx.setStatus(`Looked for ${sizeLabel(photo.rows, photo.cols)} designs: found ${photo.regions.length}.`);
    },
    'photo-detect': () => {
      detect();
      changed();
      ctx.setStatus(`Found ${plural(photo.regions.length, 'design')}.`);
    },
    'photo-select': (el) => {
      photo.selected = Number(el.dataset.index);
      redrawPhoto();
      renderPhotoBar();
      document.getElementById('photoStage')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    'photo-add-region': () => {
      photo.regions.push({ quad: defaultQuad(photo.width, photo.height, photo.rows, photo.cols), include: true, userSet: true, looks: [], unsure: [] });
      photo.selected = photo.regions.length - 1;
      readRegion(photo.regions[photo.selected]);
      redrawPhoto();
      renderPhotoBar();
      ctx.setStatus('Drag the corners of the new box onto the corners of the design.');
    },
    'photo-remove-region': () => {
      if (photo.selected < 0) return;
      photo.regions.splice(photo.selected, 1);
      photo.selected = Math.min(photo.selected, photo.regions.length - 1);
      redrawPhoto();
      renderPhotoBar();
    },
    'photo-add': addFromPhoto,
  };

  function attach() {
    const panel = document.getElementById('panel');
    panel.addEventListener('input', (evt) => {
      if (evt.target.id === 'packName') {
        const pack = currentPack();
        if (!editable(pack)) return;
        pack.name = evt.target.value.slice(0, MAX_PACK_NAME) || 'Pack';
        ctx.scheduleSave();
        const top = document.querySelector('.pk-top-pack');
        if (top?.firstChild) top.firstChild.textContent = `${pack.name} `;
      } else if (evt.target.id === 'photoThreshold' && photo) {
        photo.threshold = Number(evt.target.value);
        const out = document.getElementById('photoThresholdOut');
        if (out) out.textContent = String(photo.threshold);
        clearTimeout(thresholdTimer);
        thresholdTimer = setTimeout(() => {
          photo.regions.forEach(readRegion);
          redrawPhoto();
          renderPhotoBar();
        }, 60);
      }
    });
    // Renaming: redraw the pack list once the name is done.
    panel.addEventListener('change', (evt) => {
      if (evt.target.id === 'packName') ctx.renderPanel();
    });
    document.getElementById('stageBar').addEventListener('change', (evt) => {
      const box = evt.target.closest?.('input[data-region]');
      if (!box || !photo) return;
      const region = photo.regions[Number(box.dataset.region)];
      if (!region) return;
      region.include = box.checked;
      region.userSet = true;
      redrawPhoto();
      renderPhotoBar();
    });
  }

  /** Packs that fit a book, for the Challenge book tab: [{ id, name, count }]. */
  function packsFor(rows, cols) {
    return allPacks().filter((p) => p.rows === rows && p.cols === cols && p.designs.length).map((p) => ({ id: p.id, name: p.name, count: p.designs.length, builtIn: p.builtIn }));
  }

  return {
    actions,
    attach,
    paintGrid,
    panelMarkup,
    stageTopMarkup,
    stageBarMarkup,
    renderPhotoStage,
    showingPhoto,
    packsFor,
    addPackById: (id) => addPackToBook(allPacks().find((p) => p.id === id), { show: false }),
    isAdding: () => addingToBook,
    allPacks,
    /** Check a design (in the background worker): a promise of { status, pieces?, reason? }. */
    solve: (rows, cols, looks) => checker.check(rows, cols, looks),
  };
}

/** Clean packs kept in browser storage (anything unusable is dropped). */
export function revivePacks(list, normalize) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    try {
      const p = normalize(raw);
      p.id = typeof raw.id === 'string' && raw.id && !raw.id.startsWith('builtin:') ? raw.id : `p${out.length}${Date.now().toString(36)}`;
      out.push(p);
    } catch {
      /* dropped */
    }
  }
  return out;
}

