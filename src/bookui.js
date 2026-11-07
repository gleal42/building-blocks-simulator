// The Challenge book tab: book settings, its challenges, covers, saving and printing, and a
// preview as a 3D book with pages to flip, as flat spreads, or as the printed sheets.

import {
  BOOK_SIZES,
  DIFFICULTY,
  MAX_TITLE,
  PAPER,
  addChallenge,
  bookKey,
  bookPages,
  bookTray,
  exportBook,
  imposition,
  importBook,
  newBook,
  reviveBook,
  spreads,
} from './book.js';
import { bookPdf, pageSvg } from './bookpages.js';
import { ICONS } from './icons.js';
import { flatPicture } from './render2d.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'challenge-book';

function stars(level, withName = true) {
  const d = DIFFICULTY[level];
  const marks = [1, 2, 3].map((k) => `<span class="star${k <= level ? ' on' : ''}">★</span>`).join('');
  return `<span class="stars level-${level}"><span aria-hidden="true">${marks}</span>${withName ? `<span class="stars-name">${d.name}</span>` : `<span class="sr-only">${d.name}</span>`}</span>`;
}

/** Shrink an image file to a JPEG data URL (longest side at most max px). */
async function imageToJpeg(file, max = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);
    return { src: canvas.toDataURL('image/jpeg', 0.88), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createBookUI(ctx) {
  const state = () => ctx.getState();
  let builtFor = '';
  let leafCount = 0;
  let titleTimer = 0;
  let swipe = null;

  // Books kept in storage are checked again; anything unusable is dropped.
  const st0 = state();
  for (const [key, raw] of Object.entries(st0.books ?? {})) {
    const book = reviveBook(raw);
    if (book && bookKey(book.shape, book.n) === key) st0.books[key] = book;
    else delete st0.books[key];
  }

  function currentBook() {
    const st = state();
    if (!st.books[st.bookKey]) {
      const [shape, n] = st.bookKey.split('-');
      const okShape = shape === 'rect' ? 'rect' : 'square';
      const size = BOOK_SIZES[okShape].includes(Number(n)) ? Number(n) : 4;
      st.bookKey = bookKey(okShape, size);
      st.books[st.bookKey] = st.books[st.bookKey] ?? newBook(okShape, size);
    }
    return st.books[st.bookKey];
  }

  const bookTraySize = () => bookTray(currentBook());

  function changed() {
    builtFor = '';
    ctx.scheduleSave();
    ctx.render();
  }

  // ---- Preview -----------------------------------------------------------------------

  function signature(book) {
    return JSON.stringify([
      state().bookView,
      book.title,
      book.shape,
      book.n,
      book.challenges.map((c) => `${c.looks.join('')}:${c.difficulty}`),
      book.cover.front?.src.length ?? 0,
      book.cover.back?.src.length ?? 0,
    ]);
  }

  function pageBox(book, number, pages, extra = '') {
    return number ? `<div class="pg${extra}">${pageSvg(book, number, pages)}</div>` : `<div class="pg is-blank${extra}"></div>`;
  }

  function flipbookMarkup(book, pages) {
    const P = pages.length;
    leafCount = P / 2;
    let leaves = '';
    for (let i = 0; i < leafCount; i += 1) {
      leaves += `<div class="leaf" data-leaf="${i}"><div class="face front">${pageSvg(book, 2 * i + 1, pages)}</div><div class="face back">${pageSvg(book, 2 * i + 2, pages)}</div></div>`;
    }
    return `<div class="flipbook" id="flipbook" tabindex="0" role="group" aria-roledescription="book" aria-label="Book preview. Use the arrow keys, the buttons, or tap the left or right page to turn pages.">
<div class="fb-book" id="fbBook">${leaves}</div></div>
<div class="fb-nav">
<button type="button" class="tool" data-action="book-first" title="Front cover">${ICONS.prev}${ICONS.prev}<span class="sr-only">Front cover</span></button>
<button type="button" class="tool" data-action="book-prev">${ICONS.prev}<span>Back</span></button>
<span class="fb-label" id="fbLabel" aria-live="polite"></span>
<button type="button" class="tool" data-action="book-next"><span>Next</span>${ICONS.next}</button>
<button type="button" class="tool" data-action="book-last" title="Back cover">${ICONS.next}${ICONS.next}<span class="sr-only">Back cover</span></button>
</div>`;
  }

  function spreadsMarkup(book, pages) {
    return `<div class="spreads">${spreads(pages.length).map((s) => {
      const [a, b] = s.length === 2 ? s : s[0] === 1 ? [0, 1] : [s[0], 0];
      const label = s.length === 2 ? `Pages ${a} and ${b}` : s[0] === 1 ? 'Front cover' : 'Back cover';
      return `<figure class="spread"><div class="spread-pages">${pageBox(book, a, pages)}${pageBox(book, b, pages)}</div><figcaption>${label}</figcaption></figure>`;
    }).join('')}</div>`;
  }

  function sheetsMarkup(book, pages) {
    const sheets = imposition(pages.length);
    return `<div class="sheets"><p class="muted">Print each sheet on both sides (flip on the short edge), stack the sheets in order, fold them in the middle and staple on the fold.</p>${sheets.map((sh) => `<section class="sheet">
<h3>Sheet ${sh.sheet} of ${sheets.length}</h3>
<figure><div class="spread-pages">${pageBox(book, sh.outside[0], pages)}${pageBox(book, sh.outside[1], pages)}</div><figcaption>Outside: pages ${sh.outside[0]} and ${sh.outside[1]}</figcaption></figure>
<figure><div class="spread-pages">${pageBox(book, sh.inside[0], pages)}${pageBox(book, sh.inside[1], pages)}</div><figcaption>Inside (back of the same sheet): pages ${sh.inside[0]} and ${sh.inside[1]}</figcaption></figure>
</section>`).join('')}</div>`;
  }

  function renderStage(container) {
    const st = state();
    const book = currentBook();
    const sig = signature(book);
    if (sig !== builtFor || !container.querySelector('.book-preview')) {
      const pages = bookPages(book);
      const view = st.bookView;
      st.bookLeaf = Math.min(st.bookLeaf ?? 0, pages.length / 2);
      const views = [['3d', 'Book (3D)'], ['spreads', 'Spreads'], ['sheets', 'Print sheets']]
        .map(([id, label]) => `<button type="button" class="chip${view === id ? ' is-on' : ''}" data-action="book-view" data-id="${id}" aria-pressed="${view === id}">${label}</button>`)
        .join('');
      const body = view === 'spreads' ? spreadsMarkup(book, pages) : view === 'sheets' ? sheetsMarkup(book, pages) : flipbookMarkup(book, pages);
      container.innerHTML = `<div class="book-head"><div class="chips" role="group" aria-label="Preview">${views}</div>
<p class="muted">${pages.length} pages · ${pages.length / 4} sheet${pages.length > 4 ? 's' : ''} of ${PAPER[book.paper].name}</p></div>
<div class="book-preview view-${view}">${body}</div>`;
      builtFor = sig;
      if (view === '3d') attachFlipbook(container);
    }
    if (st.bookView === '3d') updateFlip(false);
  }

  function attachFlipbook(container) {
    const fb = container.querySelector('#flipbook');
    if (!fb) return;
    fb.addEventListener('pointerdown', (e) => {
      swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    fb.addEventListener('pointerup', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        turnPage(dx < 0 ? 1 : -1);
        return;
      }
      const rect = fb.getBoundingClientRect();
      turnPage(e.clientX - rect.left > rect.width / 2 ? 1 : -1);
    });
  }

  function updateFlip(animate = true) {
    const st = state();
    const bookEl = document.getElementById('fbBook');
    if (!bookEl) return;
    const leaf = st.bookLeaf;
    bookEl.classList.toggle('no-anim', !animate);
    bookEl.style.transform = leaf === 0 ? 'translateX(-25%)' : leaf === leafCount ? 'translateX(25%)' : 'translateX(0)';
    bookEl.querySelectorAll('.leaf').forEach((el) => {
      const i = Number(el.dataset.leaf);
      const flipped = i < leaf;
      el.classList.toggle('is-flipped', flipped);
      if (!el.dataset.moving) el.style.zIndex = String(flipped ? i + 1 : leafCount - i);
    });
    const label = document.getElementById('fbLabel');
    if (label) {
      const P = leafCount * 2;
      label.textContent = leaf === 0 ? 'Front cover' : leaf === leafCount ? 'Back cover' : `Pages ${2 * leaf} and ${2 * leaf + 1} of ${P}`;
    }
    document.querySelectorAll('[data-action="book-prev"], [data-action="book-first"]').forEach((b) => { b.disabled = leaf === 0; });
    document.querySelectorAll('[data-action="book-next"], [data-action="book-last"]').forEach((b) => { b.disabled = leaf === leafCount; });
    if (!animate) requestAnimationFrame(() => bookEl.classList.remove('no-anim'));
  }

  function turnPage(step) {
    const st = state();
    const next = Math.max(0, Math.min(leafCount, st.bookLeaf + step));
    if (next === st.bookLeaf) return;
    // The leaf being turned stays on top while it moves.
    const moving = document.querySelector(`.leaf[data-leaf="${step > 0 ? st.bookLeaf : next}"]`);
    if (moving) {
      moving.dataset.moving = '1';
      moving.style.zIndex = String(leafCount + 2);
      setTimeout(() => {
        delete moving.dataset.moving;
        updateFlip(false);
      }, 800);
    }
    st.bookLeaf = next;
    updateFlip(true);
  }

  function goTo(leaf) {
    state().bookLeaf = leaf;
    updateFlip(true);
  }

  // ---- Panel -------------------------------------------------------------------------

  function panelMarkup() {
    const st = state();
    const book = currentBook();
    const { rows, cols } = bookTray(book);
    const pages = bookPages(book);
    const sizes = [
      ...BOOK_SIZES.square.map((n) => ['square', n, `${n}×${n}`]),
      ...BOOK_SIZES.rect.map((n) => ['rect', n, `${n}×${2 * n}`]),
    ].map(([shape, n, label]) => {
      const key = bookKey(shape, n);
      const on = key === st.bookKey;
      const count = st.books[key]?.challenges.length ?? 0;
      return `<button type="button" class="chip${on ? ' is-on' : ''}" data-action="book-size" data-id="${key}" aria-pressed="${on}">${label}${count ? ` <small>(${count})</small>` : ''}</button>`;
    }).join('');
    const papers = Object.entries(PAPER)
      .map(([id, p]) => `<button type="button" class="chip${book.paper === id ? ' is-on' : ''}" data-action="book-paper" data-id="${id}" aria-pressed="${book.paper === id}">${p.name}</button>`)
      .join('');
    const buildLooks = st.build.looks();
    const buildFits = st.rows === rows && st.cols === cols && buildLooks.every((l) => l >= 0);
    const checkFits = st.rows === rows && st.cols === cols && st.check.status === 'possible';
    const list = book.challenges.map((ch, i) => `<li class="ch-item">
<span class="ch-num">${i + 1}</span>
<span class="ch-thumb">${flatPicture(rows, cols, ch.looks, { cell: book.shape === 'rect' ? 9 : 13, gap: 1 })}</span>
<span class="ch-stars" role="group" aria-label="Difficulty of challenge ${i + 1}">${[1, 2, 3].map((level) => `<button type="button" class="star-btn level-${ch.difficulty}${level <= ch.difficulty ? ' on' : ''}" data-action="book-stars" data-index="${i}" data-level="${level}" aria-label="${DIFFICULTY[level].name}" aria-pressed="${level === ch.difficulty}">★</button>`).join('')}</span>
<span class="ch-actions">
<button type="button" class="icon-btn" data-action="book-play" data-index="${i}" title="Play this challenge in the Build tab">${ICONS.play}<span class="sr-only">Play challenge ${i + 1}</span></button>
<button type="button" class="icon-btn" data-action="book-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">${ICONS.up}<span class="sr-only">Move challenge ${i + 1} up</span></button>
<button type="button" class="icon-btn" data-action="book-down" data-index="${i}" ${i === book.challenges.length - 1 ? 'disabled' : ''} title="Move down">${ICONS.down}<span class="sr-only">Move challenge ${i + 1} down</span></button>
<button type="button" class="icon-btn" data-action="book-delete" data-index="${i}" title="Delete">${ICONS.close}<span class="sr-only">Delete challenge ${i + 1}</span></button>
</span></li>`).join('');
    const coverRow = (which, label) => {
      const custom = book.cover[which];
      const number = which === 'front' ? 1 : pages.length;
      return `<div class="cover-row"><div class="cover-thumb">${pageSvg(book, number, pages)}</div><div>
<p class="cover-label">${label}${custom ? ' <small>(your picture)</small>' : ' <small>(default)</small>'}</p>
<div class="row-buttons"><button type="button" class="btn small" data-action="book-cover-upload" data-id="${which}">${ICONS.upload}Upload picture</button>
${custom ? `<button type="button" class="btn small" data-action="book-cover-reset" data-id="${which}">Use default</button>` : ''}</div></div></div>`;
    };
    const perPage = book.shape === 'rect' ? 'Each challenge fills two facing pages.' : 'Each challenge fills one page.';
    return `<section class="card" aria-labelledby="book-h">
<h2 id="book-h">Book</h2>
<label class="field-label" for="bookTitle">Title</label>
<input class="text-input" id="bookTitle" maxlength="${MAX_TITLE}" value="${esc(book.title)}" autocomplete="off">
<p class="field-label">Tray</p>
<div class="chips tight" role="group" aria-label="Tray of the book">${sizes}</div>
<p class="field-label">Paper</p>
<div class="chips tight" role="group" aria-label="Paper">${papers}</div>
<p class="hint">${perPage} Square pages of ${PAPER[book.paper].page / 10} cm; ${pages.length} pages in all, on ${pages.length / 4} sheet${pages.length > 4 ? 's' : ''} printed on both sides.</p>
</section>
<section class="card" aria-labelledby="chs-h">
<h2 id="chs-h">Challenges <small>${book.challenges.length}</small></h2>
<p class="field-label">Add a random challenge</p>
<div class="row-buttons">${[1, 2, 3].map((level) => `<button type="button" class="btn small level level-${level}" data-action="book-add-random" data-level="${level}">+ ${stars(level)}</button>`).join('')}</div>
<p class="field-label">Add a picture you made</p>
<div class="row-buttons">
<button type="button" class="btn small" data-action="book-add-build" ${buildFits ? '' : 'disabled'} title="${buildFits ? 'Add the picture of the Build tray' : `Fill a ${rows}×${cols} Build tray first`}">+ Build tray</button>
<button type="button" class="btn small" data-action="book-add-check" ${checkFits ? '' : 'disabled'} title="${checkFits ? 'Add the picture from Check a picture' : `Paint a possible ${rows}×${cols} picture in Check a picture first`}">+ Checked picture</button>
</div>
${book.challenges.length ? `<ol class="ch-list">${list}</ol>` : '<p class="muted">No challenges yet. Add some above; they appear in the preview as you go.</p>'}
</section>
<section class="card" aria-labelledby="cov-h">
<h2 id="cov-h">Covers</h2>
${coverRow('front', 'Front cover')}
${coverRow('back', 'Back cover')}
</section>
<section class="card" aria-labelledby="out-h">
<h2 id="out-h">Print and save</h2>
<div class="row-buttons">
<button type="button" class="btn primary" data-action="book-pdf" data-id="sheets">${ICONS.download}PDF to print as a booklet</button>
<button type="button" class="btn" data-action="book-pdf" data-id="pages">${ICONS.download}PDF, one page each</button>
</div>
<p class="hint">Print the booklet PDF on ${PAPER[book.paper].name}, both sides, <b>flip on the short edge</b>. Stack the sheets in order, fold, staple on the fold and trim to the corner marks. The single-page PDF is for a print shop or for reading on a screen.</p>
<div class="row-buttons">
<button type="button" class="btn" data-action="book-export">${ICONS.download}Save book (.json)</button>
<button type="button" class="btn" data-action="book-import">${ICONS.upload}Open a saved book</button>
<button type="button" class="btn" data-action="book-copy">${ICONS.copy}Copy as text</button>
</div>
<p class="hint">The .json file keeps the challenges, their stars and answers, the title and the covers, so you can carry on later or on another device.</p>
</section>`;
  }

  // ---- Actions -------------------------------------------------------------------------

  function addLooks(looks, answer, source) {
    const book = currentBook();
    try {
      const ch = addChallenge(book, { looks, answer });
      changed();
      ctx.setStatus(`Added ${source} as challenge ${book.challenges.length} (${DIFFICULTY[ch.difficulty].name.toLowerCase()}).`);
    } catch (err) {
      ctx.setStatus(err.message, true, 'bad');
    }
  }

  async function addFromCheck() {
    const st = state();
    if (st.check.status !== 'possible') return;
    const { rows, cols } = bookTraySize();
    if (st.rows !== rows || st.cols !== cols) return;
    if (st.pattern.some((l) => l === 0)) {
      ctx.setStatus('Paint every square before adding the picture to the book.', true, 'bad');
      return;
    }
    addLooks(st.pattern.slice(), st.check.pieces, 'the checked picture');
  }

  async function exportPdf(layout) {
    const book = currentBook();
    if (!book.challenges.length && !(await ctx.confirmDialog('The book has no challenges yet. Make the PDF anyway?', 'Make PDF'))) return;
    const bytes = bookPdf(book, layout);
    const name = `${slug(book.title)}-${layout === 'pages' ? 'pages' : 'booklet'}.pdf`;
    const res = await ctx.saveFile(name, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf');
    if (res === 'saved') ctx.setStatus(`Saved ${name}.`);
    else if (res === 'failed') ctx.setStatus('The PDF could not be saved here.', true, 'bad');
  }

  async function exportJson() {
    const book = currentBook();
    const name = `${slug(book.title)}.json`;
    const res = await ctx.saveFile(name, exportBook(book), 'application/json');
    if (res === 'saved') ctx.setStatus(`Saved ${name}. Open it later with “Open a saved book”.`);
    else if (res === 'failed') ctx.setStatus('Saving is blocked here. Use “Copy as text” and keep the text somewhere safe.', true, 'bad');
  }

  async function importFile(file) {
    let book;
    try {
      book = importBook(await file.text());
    } catch (err) {
      ctx.setStatus(err.message, true, 'bad');
      return;
    }
    const st = state();
    const key = bookKey(book.shape, book.n);
    const existing = st.books[key];
    if (existing?.challenges.length && !(await ctx.confirmDialog(`Replace your ${book.shape === 'rect' ? `${book.n}×${2 * book.n}` : `${book.n}×${book.n}`} book “${existing.title}” (${existing.challenges.length} challenges) with “${book.title}”?`, 'Replace'))) return;
    st.books[key] = book;
    st.bookKey = key;
    st.bookLeaf = 0;
    changed();
    ctx.setStatus(`Opened “${book.title}” with ${book.challenges.length} challenges.`);
  }

  async function setCover(which, file) {
    try {
      const book = currentBook();
      book.cover[which] = await imageToJpeg(file);
      changed();
      ctx.setStatus(`New ${which} cover. It fills the page and is cropped to a square.`);
    } catch {
      ctx.setStatus('That picture could not be opened. Try a JPEG or PNG.', true, 'bad');
    }
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
    'book-view': (el) => {
      state().bookView = el.dataset.id;
      changed();
    },
    'book-prev': () => turnPage(-1),
    'book-next': () => turnPage(1),
    'book-first': () => goTo(0),
    'book-last': () => goTo(leafCount),
    'book-size': (el) => {
      const st = state();
      st.bookKey = el.dataset.id;
      st.bookLeaf = 0;
      currentBook();
      changed();
    },
    'book-paper': (el) => {
      currentBook().paper = el.dataset.id;
      changed();
    },
    'book-add-random': (el) => {
      const level = Number(el.dataset.level);
      const { rows, cols } = bookTraySize();
      const { target, answer } = ctx.randomChallenge(rows, cols, level);
      const book = currentBook();
      addChallenge(book, { looks: target, answer, difficulty: level });
      changed();
      ctx.setStatus(`Added challenge ${book.challenges.length} (${DIFFICULTY[level].name.toLowerCase()}).`);
    },
    'book-add-build': () => {
      const st = state();
      addLooks(st.build.looks(), st.build.toJSON().pieces, 'the Build tray picture');
    },
    'book-add-check': addFromCheck,
    'book-stars': (el) => {
      currentBook().challenges[Number(el.dataset.index)].difficulty = Number(el.dataset.level);
      changed();
    },
    'book-up': (el) => {
      const list = currentBook().challenges;
      const i = Number(el.dataset.index);
      if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      changed();
    },
    'book-down': (el) => {
      const list = currentBook().challenges;
      const i = Number(el.dataset.index);
      if (i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      changed();
    },
    'book-delete': async (el) => {
      const i = Number(el.dataset.index);
      if (!(await ctx.confirmDialog(`Delete challenge ${i + 1}?`, 'Delete'))) return;
      currentBook().challenges.splice(i, 1);
      changed();
    },
    'book-play': (el) => {
      const book = currentBook();
      const i = Number(el.dataset.index);
      const ch = book.challenges[i];
      const { rows, cols } = bookTray(book);
      ctx.startChallenge({ target: ch.looks, answer: ch.answer, difficulty: ch.difficulty, label: `Book challenge ${i + 1}`, rows, cols });
    },
    'book-cover-upload': (el) => pickFile('image/*', (file) => setCover(el.dataset.id, file)),
    'book-cover-reset': (el) => {
      currentBook().cover[el.dataset.id] = null;
      changed();
    },
    'book-pdf': (el) => exportPdf(el.dataset.id),
    'book-export': exportJson,
    'book-import': () => pickFile('application/json,.json', importFile),
    'book-copy': () => ctx.copyText(exportBook(currentBook()), 'Book'),
  };

  function attach() {
    document.getElementById('panel').addEventListener('input', (evt) => {
      if (evt.target.id !== 'bookTitle') return;
      currentBook().title = evt.target.value.slice(0, MAX_TITLE);
      clearTimeout(titleTimer);
      titleTimer = setTimeout(() => {
        builtFor = '';
        ctx.scheduleSave();
        renderStage(document.getElementById('bookStage'));
      }, 350);
    });
  }

  function onKey(evt) {
    if (state().bookView !== '3d') return;
    if (evt.key === 'ArrowRight' || evt.key === 'PageDown') {
      evt.preventDefault();
      turnPage(1);
    } else if (evt.key === 'ArrowLeft' || evt.key === 'PageUp') {
      evt.preventDefault();
      turnPage(-1);
    } else if (evt.key === 'Home') goTo(0);
    else if (evt.key === 'End') goTo(leafCount);
  }

  return { renderStage, panelMarkup, actions, attach, onKey, currentBook, bookTraySize, addFromCheck };
}

