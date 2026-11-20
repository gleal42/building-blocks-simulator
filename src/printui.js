// The Print tab (maker): everything that goes in the box of a pack, ready to print.
//   Cards    one card per design, fronts and backs on sheets with cut marks
//   Box      a base and a lid sized for the tray, the cards and the rules, with the cover
//            art of art/ on the lid (coverart.js); a sketch of the closed box
//   Rules    the leaflet: four pages folded from one strip, two leaflets per sheet
//   Unlock   the card with the code that unlocks the pack in the app (a sample code for
//            now; a list of real codes can be opened once they exist, see docs/going-live.md)

import { LAYOUTS, MATERIALS, boxMockup, boxPdf, boxPlan, contentsDrawing, dieline } from './box.js';
import { coverFor } from './coverart.js';
import { CARD, PAPER, cardSheet, cardShape, cardSvg, cardsPdf, packDeck, unlockCardSvg, unlockCardsPdf } from './cards.js';
import { drawingSvg } from './drawing.js';
import { ICONS } from './icons.js';
import { LEAFLET_PAGE, leafletPageSvg, leafletPages, leafletPdf } from './leaflet.js';
import { findCode, isCode, sampleCode } from './links.js';
import { sizeLabel, slugify } from './packs.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const PRINT_VIEWS = [
  ['cards', 'Cards'],
  ['box', 'Box'],
  ['rules', 'Rules'],
  ['unlock', 'Unlock card'],
];

export const MAX_GAME_NAME = 40;

export function defaultPrint() {
  return { view: 'cards', paper: 'a4', game: 'Notan', layout: 'beside', material: 'carton', maker: '', appUrl: '', codes: {} };
}

/** Clean print settings from storage. */
export function revivePrint(raw) {
  const base = defaultPrint();
  if (!raw || typeof raw !== 'object') return base;
  const codes = {};
  for (const [id, list] of Object.entries(raw.codes ?? {})) {
    if (Array.isArray(list)) {
      const ok = list.filter((c) => typeof c === 'string' && isCode(c));
      if (ok.length) codes[id] = ok.slice(0, 5000);
    }
  }
  return {
    view: PRINT_VIEWS.some(([id]) => id === raw.view) ? raw.view : 'cards',
    paper: PAPER[raw.paper] ? raw.paper : 'a4',
    game: typeof raw.game === 'string' && raw.game.trim() ? raw.game.slice(0, MAX_GAME_NAME) : 'Notan',
    layout: LAYOUTS[raw.layout] ? raw.layout : 'beside',
    material: MATERIALS[raw.material] ? raw.material : 'carton',
    maker: typeof raw.maker === 'string' ? raw.maker.slice(0, 400) : '',
    appUrl: typeof raw.appUrl === 'string' ? raw.appUrl.slice(0, 300) : '',
    codes,
  };
}

export function createPrintUI(ctx) {
  const state = () => ctx.getState();
  const pr = () => state().print;
  let builtFor = '';
  let textTimer = 0;

  /** Packs that have designs, and the one to print: the pack being worked on in Packs. */
  const packs = () => ctx.packs().filter((p) => p.designs.length);
  function currentPack() {
    const list = packs();
    return list.find((x) => x.id === state().packId) ?? list[0] ?? null;
  }

  /** The designs that become cards: all but those known to be impossible. */
  function deckOf(pack) {
    const good = { ...pack, designs: pack.designs.filter((d) => ctx.statusOf(pack.rows, pack.cols, d.looks).status !== 'impossible') };
    return packDeck(good, { title: pr().game, paper: pr().paper });
  }

  const makerLines = () => pr().maker.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8);

  function boxFor(pack, deck) {
    const p = pr();
    const plan = boxPlan({ rows: pack.rows, cols: pack.cols, cards: deck.cards.length || 1, layout: p.layout, material: p.material });
    const top = plan.flats.lid.panel;
    const cover = coverFor(top.l, top.w);
    const opts = {
      title: p.game,
      subtitle: pack.name,
      tagline: 'Build the picture',
      cover,
      contents: [`Inside: 1 tray (${sizeLabel(pack.rows, pack.cols)}), ${pack.rows * pack.cols} pieces, ${plural(deck.cards.length, 'card')}, the rules and an unlock card.`],
      digital: 'Digital pack: scan the unlock card inside with your phone camera to play these cards in the app, alone or together.',
      maker: makerLines(),
    };
    return { plan, opts };
  }

  /** What to say about the cover art on this lid. */
  function coverNote(cover, plan) {
    const top = plan.flats.lid.panel;
    if (!cover) return 'No cover art yet: put it in art/ (see art/README.md).';
    if (cover.fits) return `Cover art: ${cover.file}.`;
    const wide = top.l / top.w;
    return `Cover art: ${cover.file}, cropped: this lid is ${top.l} × ${top.w} mm, so it needs a picture about ${wide.toFixed(1)} times as wide as it is tall.`;
  }

  const leafletInfo = (pack, deck) => ({ title: pr().game, subtitle: pack.name, rows: pack.rows, cols: pack.cols, cards: deck.cards.length, art: deck.cards[0]?.looks, maker: makerLines(), maxStars: Math.max(0, ...deck.cards.map((c) => c.stars)) });

  /** Codes for the unlock cards: the list opened for this pack, or its sample code. */
  function codesFor(pack) {
    const list = pr().codes[pack.id];
    return list?.length ? { codes: list, sample: false } : { codes: [sampleCode(pack.id)], sample: true };
  }

  const appBase = () => pr().appUrl.trim() || 'https://example.com/';

  // ---- Stage ---------------------------------------------------------------------------

  function cardsView(pack, deck) {
    const layout = cardSheet(deck);
    const n = deck.cards.length;
    const sheets = Math.max(1, Math.ceil(n / layout.perSheet));
    const face = (svg) => `<figure class="deck-card"><div class="card-face">${svg}</div></figure>`;
    const left = pack.designs.length - n;
    return `<p class="muted">${plural(n, 'card')} of ${layout.w} × ${layout.h} mm. ${layout.perSheet} fit on a sheet of ${PAPER[deck.paper].name}, so ${plural(sheets, 'sheet')}, printed on both sides.${left ? ` ${plural(left, 'design')} that cannot be built ${left === 1 ? 'is' : 'are'} left out.` : ''}</p>
<div class="deck is-${cardShape(deck)}">
<div class="deck-grid">${deck.cards.map((_, i) => face(cardSvg(deck, i))).join('')}</div>
<h3 class="deck-h">The back of every card</h3>
<div class="deck-grid">${face(cardSvg(deck, null))}</div>
</div>`;
  }

  function boxView(pack, deck) {
    const { plan, opts } = boxFor(pack, deck);
    const row = (label, d) => `<tr><th>${label}</th><td>${d.l} × ${d.w} × ${d.h} mm</td></tr>`;
    const lid = dieline('lid', plan, opts);
    const base = dieline('base', plan, opts);
    return `<div class="box-view">
<table class="box-sizes"><tbody>
${row('Lid, outside', plan.lid)}${row('Base, outside', plan.base)}${row('Space inside', plan.inner)}
<tr><th>Tray with pieces</th><td>${plan.tray.w} × ${plan.tray.d} × ${plan.tray.h} mm${plan.tray.measured ? ' (measured)' : ' (estimate: measure yours)'}</td></tr>
<tr><th>Cards</th><td>${plan.cards} cards, ${plan.deck.w} × ${plan.deck.d} × ${plan.deck.h} mm (card thickness guessed: measure a stack)</td></tr>
<tr><th>Flat sheets</th><td>lid ${Math.round(lid.w)} × ${Math.round(lid.h)} mm, base ${Math.round(base.w)} × ${Math.round(base.h)} mm</td></tr>
</tbody></table>
<figure class="box-fig box-shelf">${boxMockup(plan, { ...opts, label: `The closed box: ${pr().game}, ${pack.name}` })}<figcaption>How the box looks, closed. ${coverNote(opts.cover, plan)}</figcaption></figure>
<figure class="box-fig">${drawingSvg(lid, 'The lid, flat')}<figcaption>The lid, flat. The name is on all four sides, upright once folded.</figcaption></figure>
<figure class="box-fig">${drawingSvg(base, 'The base, flat')}<figcaption>The base, flat. Its underside says what is inside and who made it.</figcaption></figure>
<figure class="box-fig">${drawingSvg(contentsDrawing(plan), 'What goes where in the box')}<figcaption>What goes where</figcaption></figure>
</div>`;
  }

  function rulesView(pack, deck) {
    const info = leafletInfo(pack, deck);
    const pages = leafletPages(info);
    const page = (n) => `<figure class="leaflet-fig"><div class="leaflet-face">${leafletPageSvg(info, n, pages)}</div><figcaption>Page ${n}</figcaption></figure>`;
    return `<p class="muted">The cards hold the pictures, so the rules fit on four pages of ${LEAFLET_PAGE} × ${LEAFLET_PAGE} mm, folded from one strip. Two leaflets per sheet.</p>
<div class="leaflet-grid">${[1, 2, 3, 4].map(page).join('')}</div>`;
  }

  function unlockView(pack) {
    const { codes, sample } = codesFor(pack);
    const shown = codes.slice(0, 4);
    return `<p class="muted">${sample
      ? `One card in each box. For now this is a <b>sample</b>: in the customer preview, its code (${esc(codes[0])}) unlocks “${esc(pack.name)}”. Real codes, one per box, come with the setup in <code>docs/going-live.md</code>.`
      : `${plural(codes.length, 'code')} opened for “${esc(pack.name)}”: one card each.`}</p>
<div class="deck-grid unlock-grid">${shown.map((c) => `<figure class="deck-card"><div class="card-face">${unlockCardSvg(c, appBase(), pack.name, { sample })}</div></figure>`).join('')}</div>
${codes.length > shown.length ? `<p class="hint">and ${codes.length - shown.length} more in the PDF.</p>` : ''}`;
  }

  const pdfLabel = { cards: 'PDF of the cards', box: 'PDF of the box', rules: 'PDF of the rules', unlock: 'PDF of the unlock cards' };

  function signature(pack, deck) {
    const p = pr();
    return JSON.stringify([p.view, p.paper, p.game, p.layout, p.material, p.maker, p.appUrl, pack.id, pack.name, deck.cards.map((c) => `${c.looks.join('')}${c.stars}`), p.codes[pack.id]?.length ?? 0]);
  }

  function renderStage(container) {
    const pack = currentPack();
    if (!pack) {
      builtFor = '';
      container.innerHTML = `<div class="pr-empty"><h2 class="pl-title">Print</h2><p class="muted">No pack has designs yet. Make one in the Packs tab: its cards, box and rules appear here.</p>
<div class="row-buttons"><button type="button" class="btn primary" data-tab="packs">Go to Packs</button></div></div>`;
      return;
    }
    const deck = deckOf(pack);
    const sig = signature(pack, deck);
    if (sig === builtFor && container.querySelector('.pr-body')) return;
    builtFor = sig;
    const p = pr();
    const views = PRINT_VIEWS.map(([id, label]) => `<button type="button" class="chip${p.view === id ? ' is-on' : ''}" data-action="print-view" data-id="${id}" aria-pressed="${p.view === id}">${label}</button>`).join('');
    const body = p.view === 'box' ? boxView(pack, deck) : p.view === 'rules' ? rulesView(pack, deck) : p.view === 'unlock' ? unlockView(pack) : cardsView(pack, deck);
    container.innerHTML = `<div class="pr-head">
<h2 class="pl-title">${esc(p.game)}: ${esc(pack.name)}</h2>
<div class="chips" role="group" aria-label="What to print">${views}</div>
<div class="row-buttons"><button type="button" class="btn primary" data-action="print-pdf">${ICONS.download}${pdfLabel[p.view]}</button></div>
</div>
<div class="pr-body view-${p.view}">${body}</div>`;
  }

  // ---- Panel ---------------------------------------------------------------------------

  function panelMarkup() {
    const pack = currentPack();
    const p = pr();
    const chip = (x) => `<button type="button" class="chip${pack && x.id === pack.id ? ' is-on' : ''}" data-action="print-pack" data-id="${esc(x.id)}" aria-pressed="${!!pack && x.id === pack.id}">${esc(x.name)} <small>${sizeLabel(x.rows, x.cols)} · ${x.designs.length}</small></button>`;
    const packsCard = `<section class="card" aria-labelledby="pr-pack-h">
<h2 id="pr-pack-h">Pack to print</h2>
${packs().length ? `<div class="chips tight" role="group" aria-label="Pack">${packs().map(chip).join('')}</div>` : '<p class="muted">No pack has designs yet.</p>'}
<label class="field-label" for="printGame">Name of the game (on the cards, the box and the rules)</label>
<input class="text-input" id="printGame" maxlength="${MAX_GAME_NAME}" value="${esc(p.game)}" autocomplete="off">
</section>`;
    if (!pack) return packsCard;
    const paperChips = Object.entries(PAPER).map(([id, x]) => `<button type="button" class="chip${p.paper === id ? ' is-on' : ''}" data-action="print-paper" data-id="${id}" aria-pressed="${p.paper === id}">${x.name}</button>`).join('');
    const details = `<label class="field-label" for="printMaker">Your details, for the underside of the box and the back of the rules</label>
<textarea class="text-input pk-paste print-maker" id="printMaker" rows="4" maxlength="400" placeholder="Your name or brand&#10;Street, town, country&#10;email or website&#10;Batch 1">${esc(p.maker)}</textarea>
<p class="hint">Products sold to the public usually have to name who makes them, with an address and a way to get in touch. Check the rules where you sell.</p>`;
    let options = '';
    if (p.view === 'cards') {
      const deck = deckOf(pack);
      const card = CARD[cardShape(deck)];
      options = `<section class="card" aria-labelledby="pr-cards-h">
<h2 id="pr-cards-h">Cards</h2>
<p class="muted">${card.w} × ${card.h} mm, the shape of the ${sizeLabel(pack.rows, pack.cols)} tray.</p>
<p class="field-label">Paper</p>
<div class="chips tight" role="group" aria-label="Paper">${paperChips}</div>
<p class="hint">Print on card, on both sides, <b>flip on the long edge</b>: each card gets its back. Then cut along the marks.</p>
</section>`;
    } else if (p.view === 'box') {
      const { plan, opts } = boxFor(pack, deckOf(pack));
      options = `<section class="card" aria-labelledby="pr-box-h">
<h2 id="pr-box-h">Box</h2>
<p class="hint">${coverNote(opts.cover, plan)} The art for each shape of lid is in the repository's <code>art/</code> folder.</p>
<p class="field-label">Inside</p>
<div class="chips tight" role="group" aria-label="Box layout">${Object.entries(LAYOUTS).map(([id, label]) => `<button type="button" class="chip${p.layout === id ? ' is-on' : ''}" data-action="print-layout" data-id="${id}" aria-pressed="${p.layout === id}">${label}</button>`).join('')}</div>
<p class="field-label">Material</p>
<div class="chips tight" role="group" aria-label="Box material">${Object.entries(MATERIALS).map(([id, m]) => `<button type="button" class="chip${p.material === id ? ' is-on' : ''}" data-action="print-material" data-id="${id}" aria-pressed="${p.material === id}">${m.name}</button>`).join('')}</div>
${details}
<p class="hint">The PDF is full size, one page for the lid, one for the base and one for what goes where: print at 100% (no scaling). Cut the red lines, fold the blue ones, glue the flaps inside the short walls.</p>
</section>`;
    } else if (p.view === 'rules') {
      options = `<section class="card" aria-labelledby="pr-rules-h">
<h2 id="pr-rules-h">Rules leaflet</h2>
<p class="field-label">Paper</p>
<div class="chips tight" role="group" aria-label="Paper">${paperChips}</div>
${details}
<p class="hint">Print both pages of the PDF on one sheet, on both sides, <b>flip on the long edge</b>. Cut along the marks and fold in the middle: two leaflets per sheet.</p>
</section>`;
    } else {
      const own = p.codes[pack.id]?.length ?? 0;
      options = `<section class="card" aria-labelledby="pr-unlock-h">
<h2 id="pr-unlock-h">Unlock card</h2>
<label class="field-label" for="printAppUrl">Where buyers open the app (the QR code opens it)</label>
<input class="text-input" id="printAppUrl" value="${esc(p.appUrl)}" placeholder="https://your-site.com/" autocomplete="off" spellcheck="false">
<p class="hint">Leave it empty until the app is online: the QR codes then point to example.com.</p>
<p class="field-label">Codes</p>
<p class="muted">${own ? `${plural(own, 'code')} opened from a file, one card each.` : 'The sample code of this pack.'}</p>
<div class="row-buttons">
<button type="button" class="btn small" data-action="print-codes">${ICONS.upload}Open a list of codes</button>
${own ? '<button type="button" class="btn small" data-action="print-codes-clear">Use the sample code</button>' : ''}
</div>
<p class="hint">A text or CSV file with one code per line, like the list the setup makes (docs/going-live.md).</p>
</section>`;
    }
    return `${packsCard}${options}`;
  }

  // ---- Actions ---------------------------------------------------------------------------

  function changed() {
    ctx.scheduleSave();
    ctx.render();
  }

  async function savePdf() {
    const pack = currentPack();
    if (!pack) return;
    const p = pr();
    const deck = deckOf(pack);
    const slug = slugify(`${p.game} ${pack.name}`);
    let name;
    let bytes;
    try {
      if (p.view === 'box') {
        const { plan, opts } = boxFor(pack, deck);
        name = `${slug}-box.pdf`;
        bytes = boxPdf(plan, opts);
      } else if (p.view === 'rules') {
        name = `${slug}-rules.pdf`;
        bytes = leafletPdf(leafletInfo(pack, deck), p.paper);
      } else if (p.view === 'unlock') {
        const { codes, sample } = codesFor(pack);
        name = `${slug}-unlock-cards.pdf`;
        bytes = unlockCardsPdf(codes, appBase(), pack.name, { paper: p.paper, sample });
      } else {
        if (!deck.cards.length) {
          ctx.setStatus('This pack has no designs that can be built yet.', true, 'bad');
          return;
        }
        name = `${slug}-cards.pdf`;
        bytes = cardsPdf(deck);
      }
    } catch (err) {
      ctx.setStatus(`Could not make the PDF: ${err.message}`, true, 'bad');
      return;
    }
    const res = await ctx.saveFile(name, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf');
    if (res === 'saved') ctx.setStatus(`Saved ${name}.${p.view === 'box' ? ' Print it at 100% (no scaling).' : ''}`);
    else if (res === 'failed') ctx.setStatus('The PDF could not be saved here.', true, 'bad');
  }

  const actions = {
    'print-view': (el) => {
      pr().view = el.dataset.id;
      changed();
    },
    'print-pack': (el) => ctx.selectPack(el.dataset.id),
    'print-paper': (el) => {
      pr().paper = el.dataset.id;
      changed();
    },
    'print-layout': (el) => {
      pr().layout = el.dataset.id;
      changed();
    },
    'print-material': (el) => {
      pr().material = el.dataset.id;
      changed();
    },
    'print-pdf': savePdf,
    'print-codes': () => {
      const pack = currentPack();
      if (!pack) return;
      ctx.pickFile('.txt,.csv,text/plain,text/csv', async (file) => {
        const text = await file.text();
        const codes = [...new Set(text.split(/\r?\n|,|;/).map(findCode).filter(Boolean))];
        if (!codes.length) {
          ctx.setStatus('No codes found in that file (a code looks like K7QM-3XTP-ZR8D).', true, 'bad');
          return;
        }
        pr().codes[pack.id] = codes.slice(0, 5000);
        changed();
        ctx.setStatus(`Opened ${plural(codes.length, 'code')} for “${pack.name}”.`, true, 'ok');
      });
    },
    'print-codes-clear': () => {
      const pack = currentPack();
      if (!pack) return;
      delete pr().codes[pack.id];
      changed();
    },
  };

  function attach() {
    const panel = document.getElementById('panel');
    panel.addEventListener('input', (evt) => {
      const id = evt.target.id;
      if (id !== 'printGame' && id !== 'printMaker' && id !== 'printAppUrl') return;
      const p = pr();
      if (id === 'printGame') p.game = evt.target.value.slice(0, MAX_GAME_NAME);
      if (id === 'printMaker') p.maker = evt.target.value.slice(0, 400);
      if (id === 'printAppUrl') p.appUrl = evt.target.value.slice(0, 300);
      clearTimeout(textTimer);
      textTimer = setTimeout(() => {
        if (!p.game.trim()) p.game = 'Notan';
        ctx.scheduleSave();
        if (state().mode === 'print') renderStage(document.getElementById('printStage'));
      }, 350);
    });
  }

  return { actions, attach, renderStage, panelMarkup, currentPack };
}
