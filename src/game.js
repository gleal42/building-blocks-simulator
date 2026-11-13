// Games for several players: the app is the game master. It shuffles a deck of designs from
// the chosen packs, deals them, times each turn and keeps the score, while the players build
// on real trays. (Playing alone is the challenge in the Build tab, which can draw from packs
// too: see soloDeck below.)
//
// Modes
//   trial   players take turns: draw, build against the clock, score the card's stars.
//   memory  like trial, but the card is shown for a few seconds and then hidden.
//   race    everyone builds the same card on their own tray; the first to finish scores.
//
// A game is plain data (it is saved with the page), changed only by the functions below.

export const MODES = Object.freeze({
  trial: { name: 'Time trial', short: 'Take turns: draw a card and build it before the time runs out.', minPlayers: 1, maxPlayers: 8 },
  memory: { name: 'Memory', short: 'Look at the card for a few seconds, then build it from memory.', minPlayers: 1, maxPlayers: 8 },
  race: { name: 'Race', short: 'Everyone builds the same card on their own tray. First to finish wins it.', minPlayers: 2, maxPlayers: 8 },
});

export const MAX_PLAYERS = 8;
export const MAX_NAME = 20;
export const TIMES = [0, 30, 60, 90, 120, 180];
export const LOOK_TIMES = [5, 10, 15, 20];
export const ROUNDS = [3, 5, 8, 10, 15];

export function newSetup() {
  return {
    rows: 4,
    cols: 4,
    packIds: [],
    random: [], // star levels of random designs to add to the deck
    mode: 'trial',
    players: ['Player 1', 'Player 2'],
    rounds: 5,
    seconds: 90,
    lookSeconds: 10,
  };
}

/** Clean a setup from storage or the screen. */
export function normalizeSetup(raw) {
  const s = { ...newSetup(), ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!MODES[s.mode]) s.mode = 'trial';
  s.rows = Number.isInteger(s.rows) ? s.rows : 4;
  s.cols = Number.isInteger(s.cols) ? s.cols : 4;
  s.packIds = Array.isArray(s.packIds) ? s.packIds.filter((x) => typeof x === 'string') : [];
  s.random = Array.isArray(s.random) ? [...new Set(s.random.filter((x) => [1, 2, 3].includes(x)))].sort() : [];
  s.players = Array.isArray(s.players) ? s.players.map((p) => String(p ?? '').slice(0, MAX_NAME)).slice(0, MAX_PLAYERS) : [];
  if (!s.players.length) s.players = ['Player 1'];
  s.rounds = ROUNDS.includes(s.rounds) ? s.rounds : 5;
  s.seconds = TIMES.includes(s.seconds) ? s.seconds : 90;
  s.lookSeconds = LOOK_TIMES.includes(s.lookSeconds) ? s.lookSeconds : 10;
  return s;
}

/** The players' names ("Player n" when left empty). */
export function playersOf(setup) {
  return setup.players.map((name, i) => (name.trim() ? name.trim() : `Player ${i + 1}`));
}

/** Why this setup cannot start, or null. */
export function setupProblem(setup, deckSize) {
  const m = MODES[setup.mode];
  const n = playersOf(setup).length;
  if (n < m.minPlayers) return `${m.name} needs at least ${m.minPlayers} players.`;
  if (n > m.maxPlayers) return `${m.name} is for at most ${m.maxPlayers} player${m.maxPlayers === 1 ? '' : 's'}.`;
  if (!deckSize) return 'Choose at least one pack (or random designs) for the deck.';
  return null;
}

/** Cards a game will deal: one per player per round, or one per round in a race. */
export function cardsNeeded(setup) {
  return setup.mode === 'race' ? setup.rounds : setup.rounds * playersOf(setup).length;
}

export function shuffle(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The deck: every design of the chosen packs of the setup's size, plus random designs, shuffled.
 * packs: [{ id, name, rows, cols, designs: [{ looks, stars }] }]; random: [{ looks, stars, answer }].
 */
export function buildDeck(setup, packs, random, rng) {
  const cards = [];
  const seen = new Set();
  for (const pack of packs) {
    if (!setup.packIds.includes(pack.id) || pack.rows !== setup.rows || pack.cols !== setup.cols) continue;
    pack.designs.forEach((d, i) => {
      const key = d.looks.join('');
      if (seen.has(key)) return;
      seen.add(key);
      cards.push({ looks: d.looks.slice(), stars: d.stars, label: `${pack.name}, card ${i + 1}`, number: i + 1, answer: null });
    });
  }
  for (const d of random) {
    const key = d.looks.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ looks: d.looks.slice(), stars: d.stars, label: 'Random design', number: 0, answer: d.answer ?? null });
  }
  return shuffle(cards, rng);
}

export function startGame(setup, deck) {
  const players = playersOf(setup);
  return {
    setup: { ...setup, players },
    deck,
    used: 0,
    reshuffles: 0,
    round: 1,
    turn: 0,
    phase: 'ready', // ready → (look →) build → (check →) scored → ready … → over
    current: null,
    startedAt: 0, // when the card was dealt (build or look)
    endsAt: 0, // when the time for the current phase runs out (0 = no limit)
    scores: players.map(() => 0),
    log: [],
    result: null,
  };
}

const builders = (game) => (game.setup.mode === 'race' ? game.setup.players.map((_, i) => i) : [game.turn]);
export const turnsPerRound = (game) => (game.setup.mode === 'race' ? 1 : game.setup.players.length);
export const currentPlayer = (game) => game.setup.players[game.turn];

/** Deal the next card. When the deck runs out it is shuffled again (rng). */
export function draw(game, now, rng) {
  if (game.phase !== 'ready') return game;
  if (game.used >= game.deck.length) {
    game.deck = shuffle(game.deck, rng);
    game.used = 0;
    game.reshuffles += 1;
  }
  game.current = game.deck[game.used];
  game.used += 1;
  game.startedAt = now;
  game.result = null;
  if (game.setup.mode === 'memory') {
    game.phase = 'look';
    game.endsAt = now + game.setup.lookSeconds * 1000;
  } else {
    game.phase = 'build';
    game.endsAt = game.setup.seconds ? now + game.setup.seconds * 1000 : 0;
  }
  return game;
}

/** Memory: the card is hidden and the build starts. */
export function hideCard(game, now) {
  if (game.phase !== 'look') return game;
  game.phase = 'build';
  game.startedAt = now;
  game.endsAt = game.setup.seconds ? now + game.setup.seconds * 1000 : 0;
  return game;
}

/** Has the time for the current phase run out? */
export const timeUp = (game, now) => !!game.endsAt && now >= game.endsAt && (game.phase === 'look' || game.phase === 'build');

function record(game, winners, outcome, now) {
  const points = game.current.stars;
  for (const i of winners) game.scores[i] += points;
  game.result = { outcome, winners, points: winners.length ? points : 0, ms: Math.max(0, now - game.startedAt) };
  game.log.push({ round: game.round, players: builders(game), card: game.current.label, stars: points, outcome, winners, ms: game.result.ms });
  game.phase = 'scored';
  return game;
}

/**
 * The builder says they are done. In memory mode the card is shown again to check it
 * (phase 'check'); otherwise it scores at once.
 */
export function done(game, now) {
  if (game.phase !== 'build' || game.setup.mode === 'race') return game;
  if (game.setup.mode === 'memory') {
    game.phase = 'check';
    game.result = { ms: Math.max(0, now - game.startedAt) };
    return game;
  }
  return record(game, [game.turn], 'built', now);
}

/** Memory: after comparing with the card, was the build right? */
export function checked(game, correct, now) {
  if (game.phase !== 'check') return game;
  const ms = game.result?.ms ?? 0;
  record(game, correct ? [game.turn] : [], correct ? 'built' : 'wrong', now);
  game.result.ms = ms;
  game.log.at(-1).ms = ms;
  return game;
}

/** Race: player i finished first (or nobody, i = -1). */
export function raceWinner(game, i, now) {
  if (game.phase !== 'build' || game.setup.mode !== 'race') return game;
  return record(game, i >= 0 ? [i] : [], i >= 0 ? 'won' : 'nobody', now);
}

/** Give up, or the time ran out. */
export function fail(game, outcome, now) {
  if (game.phase !== 'build' && game.phase !== 'look') return game;
  return record(game, [], outcome, now);
}

/** On to the next turn, the next round, or the end. */
export function next(game) {
  if (game.phase !== 'scored') return game;
  game.current = null;
  game.endsAt = 0;
  game.result = null;
  game.turn += 1;
  if (game.turn >= turnsPerRound(game)) {
    game.turn = 0;
    game.round += 1;
  }
  game.phase = game.round > game.setup.rounds ? 'over' : 'ready';
  return game;
}

/** Players by score, best first: [{ name, score, place }] (equal scores share a place). */
export function ranking(game) {
  const rows = game.setup.players.map((name, i) => ({ name, score: game.scores[i], index: i })).sort((a, b) => b.score - a.score || a.index - b.index);
  rows.forEach((r, k) => {
    r.place = k > 0 && rows[k - 1].score === r.score ? rows[k - 1].place : k + 1;
  });
  return rows;
}

/** A saved game, checked; null when unusable. */
export function reviveGame(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.deck) || !raw.setup) return null;
  const phases = ['ready', 'look', 'build', 'check', 'scored', 'over'];
  if (!phases.includes(raw.phase) || !Array.isArray(raw.scores)) return null;
  const okCard = (c) => c && Array.isArray(c.looks) && c.looks.every((l) => Number.isInteger(l) && l >= 1 && l <= 6) && [1, 2, 3].includes(c.stars);
  if (!raw.deck.length || !raw.deck.every(okCard)) return null;
  if (raw.current && !okCard(raw.current)) return null;
  if (!Array.isArray(raw.setup.players) || raw.scores.length !== raw.setup.players.length) return null;
  return raw;
}

export function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Playing alone: the Build tab's challenge, drawing from packs ---------------------------

/**
 * A shuffled deck of pack designs for the solo challenge: { rows, cols, packIds, cards, used }.
 * cards: [{ looks, stars, label }]. Returns null when the packs hold no designs of that size.
 */
export function soloDeck(packs, packIds, rows, cols, rng) {
  const deck = buildDeck({ packIds, rows, cols }, packs, [], rng);
  return deck.length ? { rows, cols, packIds: packIds.slice(), cards: deck, used: 0, reshuffles: 0 } : null;
}

/** The next card of a solo deck (shuffled again when it runs out). */
export function soloNext(deck, rng) {
  if (deck.used >= deck.cards.length) {
    deck.cards = shuffle(deck.cards, rng);
    deck.used = 0;
    deck.reshuffles += 1;
  }
  const card = deck.cards[deck.used];
  deck.used += 1;
  return card;
}
