// The Play tab: games for several players around real trays. The app deals cards from the
// chosen packs, times each turn and keeps the score. (Playing alone is the Build tab's
// challenge, which draws from packs too.)

import { Board } from './board.js';
import { DIFFICULTY } from './book.js';
import { cardSvg } from './cards.js';
import {
  LOOK_TIMES,
  MAX_NAME,
  MAX_PLAYERS,
  MODES,
  ROUNDS,
  TIMES,
  buildDeck,
  cardsNeeded,
  checked,
  currentPlayer,
  done,
  draw,
  fail,
  formatTime,
  hideCard,
  next,
  normalizeSetup,
  playersOf,
  raceWinner,
  ranking,
  setupProblem,
  startGame,
  timeUp,
} from './game.js';
import { ICONS } from './icons.js';
import { PACK_SIZES, bookShapeFor, sizeLabel } from './packs.js';
import { boardMarkup } from './render2d.js';
import { makeRng } from './solver.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const starsText = (n) => '★'.repeat(n);

const RULES = {
  trial: [
    'Each player has a tray with all its pieces, or the players share one tray and empty it between turns.',
    'On your turn, draw a card: the clock starts. Build the picture so that, seen from above, the tray looks like the card.',
    'Finished in time? Press “Built it” and score the card’s stars. Out of time, or stuck? No points.',
    'After the last round, the most stars wins.',
  ],
  memory: [
    'On your turn, draw a card and study it until it is hidden.',
    'Build it from memory against the clock, then press “Built it”.',
    'The card is shown again: if your tray matches it exactly, score its stars.',
    'After the last round, the most stars wins.',
  ],
  race: [
    'Every player needs their own tray and set of pieces.',
    'One card is drawn for everyone. Build it as fast as you can.',
    'The first to finish shouts; check their tray against the card. If it matches, tap their name: they score the card’s stars.',
    'After the last card, the most stars wins.',
  ],
};

export function createPlayUI(ctx) {
  const state = () => ctx.getState();
  let ticker = 0;
  let wakeLock = null;
  let showSolution = false;

  const rng = () => makeRng((Date.now() ^ (Math.random() * 1e9)) >>> 0);

  /** Packs of the setup's size, with designs. */
  const packsForSize = (s) => ctx.packs().filter((p) => p.rows === s.rows && p.cols === s.cols && p.designs.length);

  function setup() {
    const st = state();
    const s = normalizeSetup(st.gameSetup);
    // An empty deck cannot be played: start from every pack of the tray size.
    const sized = packsForSize(s);
    if (!s.random.length && !sized.some((p) => s.packIds.includes(p.id))) s.packIds = sized.map((p) => p.id);
    st.gameSetup = s;
    return s;
  }

  function packCards(s) {
    const seen = new Set();
    for (const p of packsForSize(s)) if (s.packIds.includes(p.id)) for (const d of p.designs) seen.add(d.looks.join(''));
    return seen.size;
  }

  function changed() {
    ctx.scheduleSave();
    ctx.render();
  }

  // ---- Clock -----------------------------------------------------------------------------

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const audio = new Ctx();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.18, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.5);
      osc.onended = () => audio.close();
    } catch {
      /* no sound here */
    }
    try {
      navigator.vibrate?.(200);
    } catch {
      /* ignore */
    }
  }

  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }

  function clockText(game, now) {
    if (game.phase === 'look' || (game.phase === 'build' && game.endsAt)) return formatTime(game.endsAt - now);
    if (game.phase === 'build') return formatTime(now - game.startedAt);
    if (game.result?.ms !== undefined) return formatTime(game.result.ms);
    return formatTime(game.phase === 'ready' && game.setup.seconds ? game.setup.seconds * 1000 : 0);
  }

  function tick() {
    const game = state().game;
    if (!game || (game.phase !== 'look' && game.phase !== 'build')) {
      stopTicker();
      return;
    }
    const now = Date.now();
    if (timeUp(game, now)) {
      if (game.phase === 'look') hideCard(game, now);
      else if (game.setup.mode === 'race') raceWinner(game, -1, now);
      else fail(game, 'time', now);
      if (game.phase === 'scored') beep();
      changed();
      return;
    }
    const clock = document.getElementById('gameClock');
    if (clock) clock.textContent = clockText(game, now);
    const bar = document.getElementById('gameBar');
    if (bar && game.endsAt) {
      const total = game.endsAt - game.startedAt;
      bar.style.width = `${Math.max(0, Math.min(100, ((game.endsAt - now) / total) * 100))}%`;
      bar.classList.toggle('is-low', game.endsAt - now < 10000);
    }
  }

  function startTicker() {
    if (!ticker) ticker = setInterval(tick, 200);
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = 0;
  }

  // ---- Stage -----------------------------------------------------------------------------

  function cardFace(game, card) {
    const shape = bookShapeFor(game.setup.rows, game.setup.cols);
    const challenges = [];
    const number = card.number || game.used;
    challenges[number - 1] = { looks: card.looks, difficulty: card.stars };
    return cardSvg({ shape: shape.shape, n: shape.n, title: '', challenges }, number - 1);
  }

  function cardBackFace(game, title) {
    const shape = bookShapeFor(game.setup.rows, game.setup.cols);
    return cardSvg({ shape: shape.shape, n: shape.n, title, challenges: [] }, null);
  }

  function solutionMarkup(card, rows, cols) {
    if (!card.answer) return '<p class="muted">Working out a solution…</p>';
    try {
      const view = boardMarkup(Board.fromJSON({ rows, cols, pieces: card.answer }), { xray: true });
      // Its own names for the gradients and filters: the tray's (hidden in this tab) has the same ones.
      const markup = view.markup.replace(/(?<![-\w])id="([^"]+)"/g, 'id="sol-$1"').replace(/url\(#([^)]+)\)/g, 'url(#sol-$1)');
      return `<svg viewBox="${view.viewBox}" class="pl-solution" role="img" aria-label="One way to build it, with x-ray">${markup}</svg><p class="hint">One way to build it. X-ray shows the ramps under the roofs.</p>`;
    } catch {
      return '<p class="muted">No solution to show.</p>';
    }
  }

  function scoreStrip(game) {
    const turnOf = game.setup.mode === 'race' ? -1 : game.turn;
    return `<ol class="pl-scores">${game.setup.players.map((name, i) => `<li class="${i === turnOf && game.phase !== 'over' ? 'is-turn' : ''}"><span class="pl-name">${esc(name)}</span><span class="pl-score">${game.scores[i]}</span></li>`).join('')}</ol>`;
  }

  function resultLine(game) {
    const r = game.result;
    if (!r) return '';
    const who = r.winners?.length ? game.setup.players[r.winners[0]] : currentPlayer(game);
    const time = r.ms ? ` in ${formatTime(r.ms)}` : '';
    switch (r.outcome) {
      case 'built': return `<p class="pl-result ok"><b>${esc(who)}</b> scores ${starsText(r.points)} (+${r.points})${time}.</p>`;
      case 'won': return `<p class="pl-result ok"><b>${esc(who)}</b> was first and scores ${starsText(r.points)} (+${r.points})${time}.</p>`;
      case 'wrong': return `<p class="pl-result bad">Not quite: no points for <b>${esc(who)}</b>.</p>`;
      case 'time': return `<p class="pl-result bad">Time's up: no points for <b>${esc(who)}</b>.</p>`;
      case 'gave-up': return `<p class="pl-result bad"><b>${esc(who)}</b> passed: no points.</p>`;
      case 'nobody': return '<p class="pl-result bad">Nobody finished it: no points.</p>';
      default: return '';
    }
  }

  function actionsMarkup(game) {
    const mode = game.setup.mode;
    const nextName = () => {
      const turns = mode === 'race' ? 1 : game.setup.players.length;
      const lastTurn = game.turn + 1 >= turns;
      if (lastTurn && game.round >= game.setup.rounds) return 'See the scores';
      if (mode === 'race') return 'Next card';
      return `Next: ${esc(game.setup.players[lastTurn ? 0 : game.turn + 1])}`;
    };
    switch (game.phase) {
      case 'ready':
        return `<button type="button" class="btn primary pl-big" data-action="game-draw">${ICONS.dice}Draw a card</button>`;
      case 'look':
        return `<button type="button" class="btn pl-big" data-action="game-hide">${ICONS.eyeOff}Hide it now</button>`;
      case 'build':
        if (mode === 'race') {
          return `<p class="pl-ask">Who finished first?</p><div class="row-buttons pl-winners">${game.setup.players.map((name, i) => `<button type="button" class="btn primary" data-action="game-winner" data-index="${i}">${esc(name)}</button>`).join('')}<button type="button" class="btn" data-action="game-winner" data-index="-1">Nobody</button></div>`;
        }
        return `<div class="row-buttons"><button type="button" class="btn primary pl-big" data-action="game-done">${ICONS.check}Built it</button><button type="button" class="btn" data-action="game-pass">Pass</button></div>`;
      case 'check':
        return `<p class="pl-ask">Does ${esc(currentPlayer(game))}'s tray match the card exactly?</p><div class="row-buttons"><button type="button" class="btn primary" data-action="game-check" data-ok="1">${ICONS.check}Yes, it matches</button><button type="button" class="btn" data-action="game-check" data-ok="0">${ICONS.close}No</button></div>`;
      case 'scored':
        return `${resultLine(game)}<div class="row-buttons"><button type="button" class="btn primary pl-big" data-action="game-next">${nextName()}${ICONS.next}</button><button type="button" class="btn" data-action="game-solution" aria-pressed="${showSolution}">${showSolution ? 'Hide the solution' : 'Show a solution'}</button></div>`;
      default:
        return '';
    }
  }

  function gameMarkup(game) {
    const mode = game.setup.mode;
    const now = Date.now();
    if (game.phase === 'over') {
      const rank = ranking(game);
      return `<div class="pl-over"><h2 class="pl-title">${rank[0].place === 1 && rank.filter((r) => r.place === 1).length > 1 ? 'A draw!' : `${esc(rank[0].name)} wins!`}</h2>
<ol class="pl-podium">${rank.map((r) => `<li class="place-${r.place}"><span class="pl-place">${r.place}</span><span class="pl-name">${esc(r.name)}</span><span class="pl-score">${plural(r.score, 'star')}</span></li>`).join('')}</ol>
<div class="row-buttons"><button type="button" class="btn primary pl-big" data-action="game-again">${ICONS.dice}Play again</button><button type="button" class="btn" data-action="game-new">New game</button></div></div>`;
    }
    const who = mode === 'race' ? 'Everyone builds' : `${esc(currentPlayer(game))}'s turn`;
    const showFace = game.current && (game.phase === 'build' ? mode !== 'memory' : game.phase !== 'ready');
    const backTitle = game.phase === 'ready' ? (mode === 'race' ? 'Ready?' : `${currentPlayer(game)}, ready?`) : 'Build it from memory';
    const card = showFace ? cardFace(game, game.current) : cardBackFace(game, backTitle);
    const timed = game.phase === 'look' || (game.phase === 'build' && game.endsAt);
    const clockLabel = game.phase === 'look' ? 'Memorise' : game.phase === 'build' ? (game.endsAt ? 'Time left' : 'Time') : 'Time';
    const solution = game.phase === 'scored' && showSolution ? `<div class="pl-solution-wrap">${solutionMarkup(game.current, game.setup.rows, game.setup.cols)}</div>` : '';
    return `<div class="pl-game is-${game.phase}">
<div class="pl-head"><p class="pl-round">Round ${game.round} of ${game.setup.rounds} · ${MODES[mode].name}</p><p class="pl-who">${who}</p></div>
${scoreStrip(game)}
<div class="pl-table">
<div class="pl-card is-${game.setup.rows === game.setup.cols ? 'square' : 'rect'}">${card}</div>
<div class="pl-clock-box"><span class="pl-clock-label">${clockLabel}</span><span class="pl-clock" id="gameClock">${clockText(game, now)}</span>
${timed ? `<span class="pl-bar"><span id="gameBar" style="width:${Math.max(0, Math.min(100, ((game.endsAt - now) / (game.endsAt - game.startedAt)) * 100))}%"></span></span>` : ''}</div>
</div>
<div class="pl-actions">${actionsMarkup(game)}</div>
${solution}
</div>`;
  }

  function lobbyMarkup() {
    const s = setup();
    const deck = packCards(s) + (s.random.length ? s.random.length * Math.min(30, cardsNeeded(s)) : 0);
    const problem = setupProblem(s, deck);
    const tiles = Object.entries(MODES).map(([id, m]) => `<button type="button" class="pl-mode${s.mode === id ? ' is-on' : ''}" data-action="game-mode" data-id="${id}" aria-pressed="${s.mode === id}"><span class="pl-mode-name">${m.name}</span><span class="pl-mode-text">${m.short}</span></button>`).join('');
    const players = playersOf(s);
    return `<div class="pl-lobby">
<h2 class="pl-title">Play together</h2>
<p class="muted">The app deals the cards, keeps time and counts the stars. Everyone builds on a real tray.</p>
<div class="pl-modes" role="group" aria-label="Game">${tiles}</div>
<p class="pl-summary">${esc(players.join(', '))} · ${plural(s.rounds, 'round')} · ${s.seconds ? `${formatTime(s.seconds * 1000)} per card` : 'no time limit'} · ${sizeLabel(s.rows, s.cols)} · deck of ${deck} card${deck === 1 ? '' : 's'}</p>
${problem ? `<p class="hint is-bad">${esc(problem)}</p>` : ''}
<div class="row-buttons"><button type="button" class="btn primary pl-big" data-action="game-start" ${problem ? 'disabled' : ''}>${ICONS.play}Start the game</button></div>
<p class="hint">Change the players, the packs in the deck and the timer below.</p>
</div>`;
  }

  function renderStage(container) {
    const game = state().game;
    container.innerHTML = game ? gameMarkup(game) : lobbyMarkup();
    if (game && (game.phase === 'look' || game.phase === 'build')) startTicker();
    else stopTicker();
    keepAwake(!!game && game.phase !== 'over');
  }

  // ---- Panel -----------------------------------------------------------------------------

  function setupCards() {
    const s = setup();
    const chip = (action, value, label, on, extra = '') => `<button type="button" class="chip${on ? ' is-on' : ''}" data-action="${action}" data-value="${value}" aria-pressed="${on}"${extra}>${label}</button>`;
    const players = s.players.map((name, i) => `<div class="pl-player"><label class="sr-only" for="player-${i}">Player ${i + 1}</label><input class="text-input" id="player-${i}" data-player="${i}" maxlength="${MAX_NAME}" value="${esc(name)}" placeholder="Player ${i + 1}" autocomplete="off">
<button type="button" class="icon-btn" data-action="game-remove-player" data-index="${i}" ${s.players.length <= 1 ? 'disabled' : ''} title="Remove">${ICONS.close}<span class="sr-only">Remove player ${i + 1}</span></button></div>`).join('');
    const packs = packsForSize(s);
    const packChips = packs.map((p) => chip('game-pack', esc(p.id), `${esc(p.name)} <small>${p.designs.length}</small>`, s.packIds.includes(p.id))).join('');
    const randomChips = [1, 2, 3].map((level) => chip('game-random', level, `Random <span class="stars level-${level}"><span aria-hidden="true">${starsText(level)}</span><span class="sr-only">${DIFFICULTY[level].name}</span></span>`, s.random.includes(level))).join('');
    const sizes = PACK_SIZES.map((x) => chip('game-size', `${x.rows}x${x.cols}`, sizeLabel(x.rows, x.cols), x.rows === s.rows && x.cols === s.cols)).join('');
    const rounds = ROUNDS.map((n) => chip('game-rounds', n, n, s.rounds === n)).join('');
    const times = TIMES.map((t) => chip('game-seconds', t, t ? formatTime(t * 1000) : 'No limit', s.seconds === t)).join('');
    const looks = LOOK_TIMES.map((t) => chip('game-look', t, `${t} s`, s.lookSeconds === t)).join('');
    const need = cardsNeeded(s);
    const inDeck = packCards(s);
    return `<section class="card" aria-labelledby="pl-players-h">
<h2 id="pl-players-h">Players <small>${s.players.length}</small></h2>
<div class="pl-players">${players}</div>
<div class="row-buttons"><button type="button" class="btn small" data-action="game-add-player" ${s.players.length >= MAX_PLAYERS ? 'disabled' : ''}>+ Add a player</button></div>
</section>
<section class="card" aria-labelledby="pl-deck-h">
<h2 id="pl-deck-h">Deck</h2>
<p class="field-label">Tray</p>
<div class="chips tight" role="group" aria-label="Tray size">${sizes}</div>
<p class="field-label">Packs to shuffle in</p>
${packChips ? `<div class="chips tight" role="group" aria-label="Packs">${packChips}</div>` : `<p class="muted">No ${sizeLabel(s.rows, s.cols)} packs yet. Make one in the Packs tab, or add random designs.</p>`}
<p class="field-label">Random designs (always buildable)</p>
<div class="chips tight" role="group" aria-label="Random designs">${randomChips}</div>
<p class="hint">${inDeck ? `${plural(inDeck, 'card')} from packs` : 'No pack cards'}${s.random.length ? ' + random designs' : ''}. This game deals ${need}; ${inDeck && !s.random.length && inDeck < need ? 'the deck is shuffled again when it runs out.' : 'every card is dealt once.'}</p>
</section>
<section class="card" aria-labelledby="pl-rules-h">
<h2 id="pl-rules-h">Rounds and time</h2>
<p class="field-label">Rounds${s.mode === 'race' ? ' (one card each)' : ' (one turn per player each)'}</p>
<div class="chips tight" role="group" aria-label="Rounds">${rounds}</div>
<p class="field-label">Time to build a card</p>
<div class="chips tight" role="group" aria-label="Time per card">${times}</div>
${s.mode === 'memory' ? `<p class="field-label">Time to look at the card</p><div class="chips tight" role="group" aria-label="Time to look">${looks}</div>` : ''}
</section>`;
  }

  function rulesCard(mode) {
    return `<section class="card" aria-labelledby="pl-how-h">
<h2 id="pl-how-h">How to play: ${MODES[mode].name}</h2>
<ol class="pl-rules">${RULES[mode].map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
</section>`;
  }

  function gameCards(game) {
    const rows = game.log.slice(-8).reverse().map((e) => {
      const who = e.winners.length ? game.setup.players[e.winners[0]] : e.players.length === 1 ? game.setup.players[e.players[0]] : 'Nobody';
      const what = e.outcome === 'built' || e.outcome === 'won' ? `+${e.stars}` : e.outcome === 'time' ? 'time' : e.outcome === 'wrong' ? 'wrong' : e.outcome === 'nobody' ? '—' : 'pass';
      return `<li><span>R${e.round}</span><span>${esc(who)}</span><span>${esc(e.card)}</span><span class="pl-log-pts">${what}</span></li>`;
    }).join('');
    return `<section class="card" aria-labelledby="pl-game-h">
<h2 id="pl-game-h">This game</h2>
<p class="muted">${MODES[game.setup.mode].name} · ${plural(game.setup.players.length, 'player')} · ${plural(game.setup.rounds, 'round')} · ${game.setup.seconds ? `${formatTime(game.setup.seconds * 1000)} per card` : 'no time limit'} · deck of ${game.deck.length}${game.reshuffles ? ` (shuffled again ${game.reshuffles}×)` : ''}</p>
${rows ? `<ol class="pl-log">${rows}</ol>` : ''}
<div class="row-buttons"><button type="button" class="btn small" data-action="game-end">${ICONS.close}End the game</button></div>
</section>`;
  }

  function panelMarkup() {
    const game = state().game;
    if (game && game.phase !== 'over') return `${gameCards(game)}${rulesCard(game.setup.mode)}`;
    return `${setupCards()}${rulesCard(setup().mode)}${game ? gameCards(game) : ''}`;
  }

  // ---- Actions ---------------------------------------------------------------------------

  async function start() {
    const s = setup();
    const random = [];
    for (const level of s.random) {
      const count = Math.min(30, cardsNeeded(s));
      for (let k = 0; k < count; k += 1) {
        const { target, answer } = ctx.randomChallenge(s.rows, s.cols, level);
        random.push({ looks: target, stars: level, answer });
      }
    }
    const deck = buildDeck(s, ctx.packs(), random, rng());
    const problem = setupProblem(s, deck.length);
    if (problem) {
      ctx.setStatus(problem, true, 'bad');
      return;
    }
    state().game = startGame(s, deck);
    showSolution = false;
    changed();
    document.getElementById('playStage')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** Find a solution for the card in play, for "Show a solution". */
  function fetchSolution(game) {
    const card = game.current;
    if (!card || card.answer) return;
    ctx.solve(game.setup.rows, game.setup.cols, card.looks).then((res) => {
      if (res?.status === 'possible' && state().game?.current === card) {
        card.answer = res.pieces;
        if (showSolution) changed();
      }
    });
  }

  function act(fn) {
    const game = state().game;
    if (!game) return;
    fn(game, Date.now());
    if (game.phase === 'scored') fetchSolution(game);
    changed();
  }

  function editSetup(fn) {
    if (state().game && state().game.phase !== 'over') return;
    fn(setup());
    changed();
  }

  const actions = {
    'game-mode': (el) => editSetup((s) => {
      s.mode = el.dataset.id;
      if (s.mode === 'race' && s.players.length < 2) s.players.push(`Player ${s.players.length + 1}`);
    }),
    'game-add-player': () => editSetup((s) => {
      if (s.players.length < MAX_PLAYERS) s.players.push('');
    }),
    'game-remove-player': (el) => editSetup((s) => {
      if (s.players.length > 1) s.players.splice(Number(el.dataset.index), 1);
    }),
    'game-size': (el) => editSetup((s) => {
      const [rows, cols] = el.dataset.value.split('x').map(Number);
      s.rows = rows;
      s.cols = cols;
      s.packIds = packsForSize(s).map((p) => p.id);
    }),
    'game-pack': (el) => editSetup((s) => {
      const id = el.dataset.value;
      s.packIds = s.packIds.includes(id) ? s.packIds.filter((x) => x !== id) : [...s.packIds, id];
    }),
    'game-random': (el) => editSetup((s) => {
      const level = Number(el.dataset.value);
      s.random = s.random.includes(level) ? s.random.filter((x) => x !== level) : [...s.random, level].sort();
    }),
    'game-rounds': (el) => editSetup((s) => { s.rounds = Number(el.dataset.value); }),
    'game-seconds': (el) => editSetup((s) => { s.seconds = Number(el.dataset.value); }),
    'game-look': (el) => editSetup((s) => { s.lookSeconds = Number(el.dataset.value); }),
    'game-start': start,
    'game-draw': () => {
      showSolution = false;
      act((g, now) => draw(g, now, rng()));
    },
    'game-hide': () => act((g, now) => hideCard(g, now)),
    'game-done': () => act((g, now) => done(g, now)),
    'game-pass': () => act((g, now) => fail(g, 'gave-up', now)),
    'game-check': (el) => act((g, now) => checked(g, el.dataset.ok === '1', now)),
    'game-winner': (el) => act((g, now) => raceWinner(g, Number(el.dataset.index), now)),
    'game-next': () => {
      showSolution = false;
      act((g) => next(g));
    },
    'game-solution': () => {
      showSolution = !showSolution;
      const game = state().game;
      if (game) fetchSolution(game);
      changed();
    },
    'game-again': () => {
      state().game = null;
      start();
    },
    'game-new': () => {
      state().game = null;
      changed();
    },
    'game-end': async () => {
      if (!(await ctx.confirmDialog('End this game? The scores so far are shown, then you can start a new one.', 'End the game'))) return;
      const game = state().game;
      if (game) {
        game.phase = 'over';
        game.current = null;
      }
      changed();
    },
  };

  function attach() {
    const panel = document.getElementById('panel');
    panel.addEventListener('input', (evt) => {
      const i = evt.target.dataset?.player;
      if (i === undefined || state().game && state().game.phase !== 'over') return;
      setup().players[Number(i)] = evt.target.value.slice(0, MAX_NAME);
      ctx.scheduleSave();
    });
    // A name is done: update the summary above (not the panel, where the next name is being typed).
    panel.addEventListener('change', (evt) => {
      const stage = document.getElementById('playStage');
      if (evt.target.dataset?.player !== undefined && stage && !stage.hidden) renderStage(stage);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state().mode === 'play' && state().game && state().game.phase !== 'over') keepAwake(true);
    });
  }

  return { renderStage, panelMarkup, actions, attach, stop: () => { stopTicker(); keepAwake(false); } };
}
