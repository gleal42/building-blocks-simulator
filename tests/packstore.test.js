import test from 'node:test';
import assert from 'node:assert/strict';

import { newPack } from '../src/packs.js';
import { createPackStore, packSig } from '../src/packstore.js';

/** A stand-in for the artifact's database: one collection, live listeners. */
function fakeDb() {
  const docs = new Map();
  const listeners = new Set();
  const snapshot = () => ({
    docs: [...docs].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, data]) => ({ id, exists: true, data: () => data })),
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const tell = () => {
    const snap = snapshot();
    for (const fn of listeners) fn(snap);
  };
  return {
    docs,
    writes: 0,
    collection: () => ({
      onSnapshot(next) {
        listeners.add(next);
        queueMicrotask(() => next(snapshot()));
        return () => listeners.delete(next);
      },
    }),
    doc(path) {
      const id = path.split('/')[1];
      const db = this;
      return {
        async set(data) {
          db.writes += 1;
          docs.set(id, JSON.parse(JSON.stringify(data)));
          tell();
        },
        async delete() {
          docs.delete(id);
          tell();
        },
      };
    },
    /** A change made on another device. */
    remoteSet(id, data) {
      docs.set(id, data);
      tell();
    },
    remoteDelete(id) {
      docs.delete(id);
      tell();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function device(db, packs = [], saved = null) {
  const here = { packs, changes: 0 };
  here.store = createPackStore({
    getPacks: () => here.packs,
    setPacks: (list) => {
      here.packs = list;
    },
    onChange: () => {
      here.changes += 1;
    },
    connect: async () => db,
    saved,
  });
  return here;
}

function pack(id, name, looks = '1122/1122/1122/1122') {
  const p = newPack({ id, name, rows: 4, cols: 4 });
  p.designs.push({ looks: [...looks.replace(/\//g, '')].map(Number), stars: 1 });
  return p;
}

test('no database: the packs stay in this browser', async () => {
  const here = device(null, [pack('a1', 'Mine')]);
  await here.store.start();
  assert.equal(here.store.status().kind, 'local');
  assert.equal(here.packs.length, 1);
});

test('packs made before there was a database are saved to it, and another device gets them', async () => {
  const db = fakeDb();
  const phone = device(db, [pack('a1', 'Animals'), pack('b2', 'Volcano')]);
  await phone.store.start();
  await tick();
  await phone.store.flush();
  assert.deepEqual([...db.docs.keys()].sort(), ['a1', 'b2']);
  assert.equal(db.docs.get('a1').format, 'building-blocks-pack');
  assert.equal(db.docs.get('a1').designs[0].looks, '1122/1122/1122/1122');
  assert.equal(phone.store.status().kind, 'ready');

  const laptop = device(db, []);
  await laptop.store.start();
  await tick();
  assert.deepEqual(laptop.packs.map((p) => p.name).sort(), ['Animals', 'Volcano']);
});

test('a change on another device replaces the copy here, unless the copy here has changes of its own', async () => {
  const db = fakeDb();
  const here = device(db, [pack('a1', 'Animals'), pack('b2', 'Volcano')]);
  await here.store.start();
  await tick();
  await here.store.flush();
  const writes = db.writes;

  // Renamed elsewhere, nothing changed here: taken in, and not written back.
  db.remoteSet('a1', { ...db.docs.get('a1'), name: 'Animals II' });
  await tick();
  assert.equal(here.packs.find((p) => p.id === 'a1').name, 'Animals II');
  await here.store.flush();
  assert.equal(db.writes, writes);

  // Changed here (not saved yet) while it changes elsewhere: the change here wins.
  here.packs.find((p) => p.id === 'b2').name = 'Volcano (mine)';
  db.remoteSet('b2', { ...db.docs.get('b2'), name: 'Volcano (theirs)' });
  await tick();
  assert.equal(here.packs.find((p) => p.id === 'b2').name, 'Volcano (mine)');
  await here.store.flush();
  assert.equal(db.docs.get('b2').name, 'Volcano (mine)');
});

test('deleting here deletes there; deleted elsewhere disappears here', async () => {
  const db = fakeDb();
  const here = device(db, [pack('a1', 'Animals'), pack('b2', 'Volcano'), pack('c3', 'Cats')]);
  await here.store.start();
  await tick();
  await here.store.flush();

  here.packs = here.packs.filter((p) => p.id !== 'a1');
  here.store.deleted('a1');
  await here.store.flush();
  assert.ok(!db.docs.has('a1'));
  await tick();
  assert.ok(!here.packs.some((p) => p.id === 'a1'), 'not brought back by the listener');

  db.remoteDelete('b2');
  await tick();
  assert.ok(!here.packs.some((p) => p.id === 'b2'));
  assert.ok(here.packs.some((p) => p.id === 'c3'));
});

test('changes made here while away are kept: the last state seen is remembered between visits', async () => {
  const db = fakeDb();
  const first = device(db, [pack('a1', 'Animals')]);
  await first.store.start();
  await tick();
  await first.store.flush();
  const saved = first.store.saveState();
  assert.equal(saved.remote.a1, packSig(first.packs[0]));

  // Next visit: renamed here before the database answered.
  const later = device(db, [{ ...first.packs[0], name: 'Animals, renamed offline' }], saved);
  await later.store.start();
  await tick();
  assert.equal(later.packs[0].name, 'Animals, renamed offline');
  await later.store.flush();
  assert.equal(db.docs.get('a1').name, 'Animals, renamed offline');
});
