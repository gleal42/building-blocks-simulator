// The customer side, as a preview: "My packs" in the buyer's app.
// A buyer unlocks the pack in their box with the unlock card (scanning its QR code, or typing
// its code), then plays it alone or together. In this preview every pack the maker has is a
// box on the table: its unlock card carries the pack's sample code (and any real codes opened
// in Print › Unlock card work too). Nothing here needs a server: the real setup is described
// in docs/going-live.md.

import { boxPlan } from './box.js';
import { coverFor } from './coverart.js';
import { ICONS } from './icons.js';
import { findCode, sampleCode } from './links.js';
import { sizeLabel } from './packs.js';
import { flatPicture } from './render2d.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function createCustomerUI(ctx) {
  const state = () => ctx.getState();
  let message = null; // { text, tone }

  /** Every box there is (the maker's packs with designs). */
  const boxes = () => ctx.packs().filter((p) => p.designs.length);
  /** The packs unlocked in this preview, in the order they were unlocked. */
  const unlocked = () => {
    const all = boxes();
    return state().customer.unlocked.map((id) => all.find((p) => p.id === id)).filter(Boolean);
  };

  /** The pack a code opens, or null. */
  function packForCode(code) {
    const real = state().print?.codes ?? {};
    return boxes().find((p) => sampleCode(p.id) === code || real[p.id]?.includes(code)) ?? null;
  }

  function open(pack, how) {
    const st = state();
    const had = st.customer.unlocked.includes(pack.id);
    if (!had) st.customer.unlocked.push(pack.id);
    message = had
      ? { text: `“${pack.name}” is already in your packs.`, tone: 'ok' }
      : { text: `${how} Unlocked “${pack.name}”: ${plural(pack.designs.length, 'card')} to play.`, tone: 'ok' };
    ctx.scheduleSave();
    ctx.render();
  }

  /** Unlock with typed or pasted text (the first code found in it is used). */
  function unlock(text) {
    const code = findCode(text);
    if (!code) {
      message = { text: 'Type the 12 letters and numbers on the card, like K7QM-3XTP-ZR8D.', tone: 'bad' };
      ctx.render();
      return false;
    }
    const pack = packForCode(code);
    if (!pack) {
      message = { text: `${code} does not open any pack. Check the code on the card in your box.`, tone: 'bad' };
      ctx.render();
      return false;
    }
    open(pack, `Code ${code}:`);
    return true;
  }

  const thumbs = (p, n, size = 36) => p.designs.slice(0, n).map((d) => `<span class="cu-mini">${flatPicture(p.rows, p.cols, d.looks, { cell: Math.max(4, Math.round(size / Math.max(p.rows, p.cols))), gap: 1 })}</span>`).join('');

  function packCard(p) {
    const stars = [1, 2, 3].map((s) => p.designs.filter((d) => d.stars === s).length);
    return `<li class="cu-pack">
<div class="cu-pack-head"><h3>${esc(p.name)}</h3><p class="muted">${sizeLabel(p.rows, p.cols)} tray · ${plural(p.designs.length, 'card')} · ${stars.map((n, i) => `${n}${'★'.repeat(i + 1)}`).join(' ')}</p></div>
<div class="cu-previews">${thumbs(p, 4)}</div>
<div class="row-buttons">
<button type="button" class="btn primary" data-action="cu-solo" data-id="${esc(p.id)}">${ICONS.play}Play alone</button>
<button type="button" class="btn" data-action="cu-together" data-id="${esc(p.id)}">${ICONS.dice}Play together</button>
</div></li>`;
  }

  /** The box's cover art, as on the lid (the picture that fits its shape). */
  function coverImg(p) {
    try {
      const top = boxPlan({ rows: p.rows, cols: p.cols, cards: p.designs.length, layout: state().print?.layout }).flats.lid.panel;
      const art = coverFor(top.l, top.w);
      if (!art) return '';
      const w = 116;
      return `<span class="cu-box-art" style="width:${w}px;height:${Math.round((w * top.w) / top.l)}px"><img src="${art.src}" alt=""></span>`;
    } catch {
      return '';
    }
  }

  function boxCard(p) {
    const done = state().customer.unlocked.includes(p.id);
    const code = sampleCode(p.id);
    const art = coverImg(p);
    if (art) {
      return `<li class="cu-box${done ? ' is-done' : ''}">
<div class="cu-box-cover">${art}<span class="cu-box-pack">${esc(p.name)}</span></div>
<div class="cu-box-card"><p class="field-label">Unlock card in the box</p><p class="cu-box-code">${code}</p>
${done ? `<p class="cu-box-done">${ICONS.check}Unlocked</p>` : `<button type="button" class="btn small primary" data-action="cu-scan" data-id="${esc(p.id)}">Scan its QR code</button>`}</div>
</li>`;
    }
    return `<li class="cu-box${done ? ' is-done' : ''}">
<div class="cu-box-lid"><span class="cu-box-name">${esc(state().print?.game || 'Notan')}</span><span class="cu-box-pack">${esc(p.name)}</span>${flatPicture(p.rows, p.cols, p.designs[0].looks, { cell: Math.max(5, Math.round(44 / Math.max(p.rows, p.cols))), gap: 1 })}</div>
<div class="cu-box-card"><p class="field-label">Unlock card in the box</p><p class="cu-box-code">${code}</p>
${done ? `<p class="cu-box-done">${ICONS.check}Unlocked</p>` : `<button type="button" class="btn small primary" data-action="cu-scan" data-id="${esc(p.id)}">Scan its QR code</button>`}</div>
</li>`;
  }

  function renderStage(container) {
    const list = unlocked();
    const msg = message ? `<p class="cu-msg ${message.tone ? `is-${message.tone}` : ''}" role="status">${esc(message.text)}</p>` : '';
    const all = boxes();
    container.innerHTML = `<div class="cu">
<h2 class="pl-title">My packs</h2>
<form class="cu-unlock" id="cuUnlock" autocomplete="off">
<label class="field-label" for="cuCode">Code from the card in your box</label>
<div class="cu-unlock-row"><input class="text-input cu-code" id="cuCode" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false" inputmode="text">
<button type="submit" class="btn primary">${ICONS.check}Unlock</button></div>
<p class="hint">Or scan the QR code on that card with your phone camera.</p>
${msg}
</form>
${list.length ? `<ol class="cu-packs">${list.map(packCard).join('')}</ol>` : '<p class="muted cu-empty">No packs yet. Unlock the one that came with your game.</p>'}
<section class="cu-boxes" aria-labelledby="cu-boxes-h">
<h3 id="cu-boxes-h">Boxes on the table <small>preview only</small></h3>
<p class="hint">Pretend you bought one of these: open it and scan its unlock card, or type its code above.</p>
${all.length ? `<ul class="cu-box-list">${all.map(boxCard).join('')}</ul>` : '<p class="muted">No packs with designs yet: make one on the Maker side.</p>'}
</section>
</div>`;
    container.querySelector('#cuUnlock').addEventListener('submit', (evt) => {
      evt.preventDefault();
      unlock(container.querySelector('#cuCode').value);
    });
  }

  function panelMarkup() {
    return `<section class="card" aria-labelledby="cu-how-h">
<h2 id="cu-how-h">What the buyer does</h2>
<ol class="pl-rules">
<li>Opens the box: the tray with its pieces, the cards, the rules and an unlock card.</li>
<li>Scans the unlock card with the phone camera (or types its code here). The cards of the box appear in <b>My packs</b>.</li>
<li><b>Play alone:</b> draws a card and builds it, in the tray on screen or on the real tray, with the answer when stuck.</li>
<li><b>Play together:</b> the app deals the cards, keeps time and counts the stars while everyone builds on real trays.</li>
</ol>
<p class="hint">Unlocked packs stay on the buyer's device.</p>
<div class="row-buttons"><button type="button" class="btn small" data-action="cu-reset" ${state().customer.unlocked.length ? '' : 'disabled'}>Start the preview again</button></div>
</section>`;
  }

  return {
    renderStage,
    panelMarkup,
    unlock,
    unlockedPacks: unlocked,
    /** Unlock a pack without a code (the maker trying a design). */
    grant: (id) => {
      const st = state();
      if (!st.customer.unlocked.includes(id)) st.customer.unlocked.push(id);
    },
    actions: {
      'cu-solo': (el) => ctx.playAlone(el.dataset.id),
      'cu-together': (el) => ctx.playTogether(el.dataset.id),
      'cu-scan': (el) => {
        const pack = boxes().find((p) => p.id === el.dataset.id);
        if (pack) open(pack, 'Scanned the card.');
      },
      'cu-reset': async () => {
        if (!(await ctx.confirmDialog('Start the customer preview again, with no packs unlocked?', 'Start again'))) return;
        state().customer.unlocked = [];
        message = null;
        ctx.resetGames();
        ctx.scheduleSave();
        ctx.render();
      },
    },
  };
}
