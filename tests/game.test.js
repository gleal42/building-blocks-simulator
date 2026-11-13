import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeck,
  cardsNeeded,
  checked,
  done,
  draw,
  fail,
  formatTime,
  hideCard,
  newSetup,
  next,
  normalizeSetup,
  playersOf,
  raceWinner,
  ranking,
  reviveGame,
  setupProblem,
  soloDeck,
  soloNext,
  startGame,
  timeUp,
} from '../src/game.js';
import { makeRng } from '../src/solver.js';

const packs = [
  { id: 'a', name: 'A', rows: 2, cols: 2, designs: [{ looks: [1, 2, 2, 1], stars: 1 }, { looks: [2, 1, 1, 2], stars: 2 }] },
  { id: 'b', name: 'B', rows: 2, cols: 2, designs: [{ looks: [1, 2, 2, 1], stars: 3 }, { looks: [1, 1, 2, 2], stars: 3 }] },
  { id: 'c', name: 'C', rows: 4, cols: 4, designs: [{ looks: new Array(16).fill(1), stars: 1 }] },
];

function setupFor(over = {}) {
  return normalizeSetup({ ...newSetup(), rows: 2, cols: 2, packIds: ['a', 'b'], players: ['Ana', 'Rui', ''], rounds: 3, ...over });
}

test('the deck mixes the chosen packs of the right size, without repeats', () => {
  const deck = buildDeck(setupFor(), packs, [{ looks: [2, 2, 1, 1], stars: 2, answer: [] }], makeRng(1));
  assert.equal(deck.length, 4, 'the design in both packs counts once; pack C is another size');
  assert.deepEqual(new Set(deck.map((c) => c.looks.join(''))), new Set(['1221', '2112', '1122', '2211']));
  assert.equal(buildDeck(setupFor({ packIds: ['a'] }), packs, [], makeRng(1)).length, 2);
});

test('setups are cleaned and checked', () => {
  const s = setupFor();
  assert.deepEqual(playersOf(s), ['Ana', 'Rui', 'Player 3']);
  assert.equal(cardsNeeded(s), 9);
  assert.equal(cardsNeeded(setupFor({ mode: 'race' })), 3);
  assert.match(setupProblem(setupFor({ mode: 'race', players: ['Solo'] }), 4), /at least 2/);
  assert.match(setupProblem(s, 0), /Choose at least one pack/);
  assert.equal(setupProblem(s, 4), null);
  const odd = normalizeSetup({ mode: 'chess', seconds: 7, rounds: 99, players: 'x', random: [3, 3, 9, 1] });
  assert.equal(odd.mode, 'trial');
  assert.equal(odd.seconds, 90);
  assert.equal(odd.rounds, 5);
  assert.deepEqual(odd.players, ['Player 1']);
  assert.deepEqual(odd.random, [1, 3]);
});

test('time trial: turns go round, stars are scored, time can run out', () => {
  const s = setupFor({ players: ['Ana', 'Rui'], rounds: 3, seconds: 60 });
  const rng = makeRng(3);
  const g = startGame(s, buildDeck(s, packs, [], rng));
  draw(g, 1000, rng);
  assert.equal(g.phase, 'build');
  assert.equal(g.endsAt, 61000);
  const stars = g.current.stars;
  done(g, 20000);
  assert.equal(g.phase, 'scored');
  assert.deepEqual(g.scores, [stars, 0]);
  assert.equal(g.result.ms, 19000);
  next(g);
  assert.equal(g.turn, 1);
  draw(g, 100000, rng);
  assert.ok(!timeUp(g, 150000));
  assert.ok(timeUp(g, 160000));
  fail(g, 'time', 160000);
  assert.deepEqual(g.scores, [stars, 0]);
  next(g);
  assert.equal(g.round, 2);
  assert.equal(g.turn, 0);
  for (let k = 0; k < 4; k += 1) {
    assert.equal(g.phase, 'ready');
    draw(g, 0, rng);
    fail(g, 'gave-up', 1);
    next(g);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.log.length, 6);
});

test('memory: look, hide, build, then check against the card', () => {
  const s = setupFor({ mode: 'memory', players: ['Ana'], lookSeconds: 5, seconds: 0 });
  const rng = makeRng(4);
  const g = startGame(s, buildDeck(s, packs, [], rng));
  draw(g, 0, rng);
  assert.equal(g.phase, 'look');
  assert.ok(timeUp(g, 5000));
  hideCard(g, 5000);
  assert.equal(g.phase, 'build');
  assert.equal(g.endsAt, 0, 'no time limit');
  done(g, 12000);
  assert.equal(g.phase, 'check');
  checked(g, false, 13000);
  assert.deepEqual(g.scores, [0]);
  assert.equal(g.log[0].outcome, 'wrong');
  assert.equal(g.log[0].ms, 7000);
});

test('race: one card per round for everyone, the winner takes its stars', () => {
  const s = setupFor({ mode: 'race', players: ['Ana', 'Rui', 'Eva'], rounds: 3 });
  const rng = makeRng(5);
  const g = startGame(s, buildDeck(s, packs, [], rng));
  draw(g, 0, rng);
  const first = g.current.stars;
  raceWinner(g, 2, 9000);
  next(g);
  assert.equal(g.round, 2, 'one card per round');
  for (let k = 0; k < 2; k += 1) {
    draw(g, 0, rng);
    raceWinner(g, -1, 9000);
    next(g);
  }
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.scores, [0, 0, first]);
  const rank = ranking(g);
  assert.equal(rank[0].name, 'Eva');
  assert.deepEqual(rank.map((r) => r.place), [1, 2, 2]);
});

test('the deck is shuffled again when it runs out', () => {
  const s = setupFor({ packIds: ['a'], players: ['Ana'], rounds: 5 });
  const rng = makeRng(6);
  const g = startGame(s, buildDeck(s, packs, [], rng));
  for (let k = 0; k < 5; k += 1) {
    draw(g, 0, rng);
    done(g, 1);
    next(g);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.reshuffles, 2);
});

test('solo decks draw from packs and reshuffle', () => {
  const rng = makeRng(7);
  assert.equal(soloDeck(packs, ['c'], 2, 2, rng), null);
  const d = soloDeck(packs, ['a', 'b'], 2, 2, rng);
  const seen = new Set();
  for (let k = 0; k < 3; k += 1) seen.add(soloNext(d, rng).looks.join(''));
  assert.equal(seen.size, 3);
  for (let k = 0; k < 3; k += 1) soloNext(d, rng);
  assert.equal(d.reshuffles, 1);
});

test('saved games are checked on the way back', () => {
  const s = setupFor();
  const g = startGame(s, buildDeck(s, packs, [], makeRng(8)));
  assert.ok(reviveGame(JSON.parse(JSON.stringify(g))));
  assert.equal(reviveGame({ ...g, phase: 'dancing' }), null);
  assert.equal(reviveGame({ ...g, deck: [{ looks: [9], stars: 1 }] }), null);
  assert.equal(formatTime(61000), '1:01');
  assert.equal(formatTime(400), '0:01');
});
