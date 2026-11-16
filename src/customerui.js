// What a buyer sees: "My packs". A buyer unlocks the pack they bought with the code on the
// card in their box (typed, or by scanning its QR code), then plays it alone or together.
// The maker sees the same thing in "customer preview".

import { ICONS } from './icons.js';
import { normalizeCode, isCode } from './links.js';
import { unlockAny } from './lock.js';
import { sizeLabel } from './packs.js';
import { flatPicture } from './render2d.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function createCustomerUI(ctx) {
  const state = () => ctx.getState();
  let busy = false;
  let message = null; // { text, tone }

  const packs = () => state().customer.packs;

  /** Try a code on every locked pack the app knows. */
  async function unlock(rawCode) {
    const code = normalizeCode(rawCode);
    if (!isCode(code)) {
      message = { text: 'A code has 12 letters and numbers, like K7QM-3XTP-ZR8D.', tone: 'bad' };
      ctx.render();
      return false;
    }
    if (busy) return false;
    busy = true;
    message = { text: 'Checking the code…', tone: '' };
    ctx.render();
    let found = null;
    try {
      found = await unlockAny(ctx.lockedPacks(), code);
    } catch (err) {
      message = { text: err.message, tone: 'bad' };
    }
    busy = false;
    if (!found) {
      if (!message || message.tone !== 'bad') message = { text: 'That code does not open any pack. Check it on the card in your box.', tone: 'bad' };
      ctx.render();
      return false;
    }
    const st = state();
    const pack = { ...found.pack, id: `c:${found.locked.id}`, builtIn: false };
    const had = packs().findIndex((p) => p.id === pack.id);
    if (had >= 0) st.customer.packs[had] = pack;
    else st.customer.packs.push(pack);
    message = { text: had >= 0 ? `“${pack.name}” was already unlocked on this device.` : `Unlocked “${pack.name}”: ${plural(pack.designs.length, 'design')} to play.`, tone: 'ok' };
    ctx.scheduleSave();
    ctx.render();
    return true;
  }

  function packCard(p) {
    const preview = p.designs.slice(0, 3).map((d) => `<span class="cu-mini">${flatPicture(p.rows, p.cols, d.looks, { cell: Math.max(4, Math.round(36 / Math.max(p.rows, p.cols))), gap: 1 })}</span>`).join('');
    const stars = [1, 2, 3].map((s) => p.designs.filter((d) => d.stars === s).length);
    return `<li class="cu-pack">
<div class="cu-pack-head"><h3>${esc(p.name)}</h3><p class="muted">${sizeLabel(p.rows, p.cols)} tray · ${plural(p.designs.length, 'design')} · ${stars.map((n, i) => `${n}${'★'.repeat(i + 1)}`).join(' ')}</p></div>
<div class="cu-previews">${preview}</div>
<div class="row-buttons">
<button type="button" class="btn primary" data-action="cu-solo" data-id="${esc(p.id)}">${ICONS.play}Play alone</button>
<button type="button" class="btn" data-action="cu-together" data-id="${esc(p.id)}">${ICONS.dice}Play together</button>
</div></li>`;
  }

  function renderStage(container) {
    const list = packs();
    const msg = message ? `<p class="cu-msg ${message.tone ? `is-${message.tone}` : ''}" role="status">${esc(message.text)}</p>` : '';
    container.innerHTML = `<div class="cu">
<h2 class="pl-title">My packs</h2>
<form class="cu-unlock" id="cuUnlock" autocomplete="off">
<label class="field-label" for="cuCode">Code from the card in your box</label>
<div class="cu-unlock-row"><input class="text-input cu-code" id="cuCode" placeholder="XXXX-XXXX-XXXX" maxlength="20" autocapitalize="characters" spellcheck="false" inputmode="text">
<button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>${ICONS.check}Unlock</button></div>
<p class="hint">Or scan the QR code on that card with your phone's camera.</p>
${msg}
</form>
${list.length ? `<ol class="cu-packs">${list.map(packCard).join('')}</ol>` : '<p class="muted cu-empty">No packs on this device yet. Unlock the pack that came with your game above.</p>'}
</div>`;
    container.querySelector('#cuUnlock').addEventListener('submit', (evt) => {
      evt.preventDefault();
      unlock(container.querySelector('#cuCode').value);
    });
  }

  function panelMarkup() {
    return `<section class="card" aria-labelledby="cu-how-h">
<h2 id="cu-how-h">How it works</h2>
<ol class="pl-rules">
<li>Each game box has a card with a code and a QR code. It unlocks the digital version of the cards in the box.</li>
<li><b>Play alone:</b> draw a card and build its picture in the tray on screen, or on your real tray.</li>
<li><b>Play together:</b> the app deals the cards, keeps time and counts the stars while everyone builds on a real tray.</li>
<li>Every card also has its own QR code: scan it to open that picture straight away.</li>
</ol>
<p class="hint">Your packs stay on this device and in this browser.</p>
</section>`;
  }

  return {
    renderStage,
    panelMarkup,
    unlock,
    actions: {
      'cu-solo': (el) => ctx.playAlone(el.dataset.id),
      'cu-together': (el) => ctx.playTogether(el.dataset.id),
    },
  };
}
