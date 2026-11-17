// Where the maker's packs are kept. As a Claude artifact, the app saves them in the
// artifact's database: they last (browser storage can be cleared), reach every device, and
// Claude can read them (to add them to the repository as packs/*.json). Anywhere else they
// stay in this browser only.
//
// One document per pack: packs/<id> = the pack as a file (packToFile) + { created, updated }.
// Changes made here are written after a short pause, one write at a time. Changes made on
// another device arrive through a listener and replace the copy here, unless the copy here
// has changes of its own that are not saved yet (then those are written, last one wins).

import { normalizePack, packToFile } from './packs.js';

export const COLLECTION = 'packs';
const WRITE_PAUSE = 700;
const LOAD_TIMEOUT = 10000;

/** What counts as a change to a pack. */
export function packSig(pack) {
  return JSON.stringify([pack.name, pack.rows, pack.cols, pack.designs.map((d) => [d.looks.join(''), d.stars])]);
}

/** A pack id that is also a valid document name. */
export const isDocId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,120}$/.test(id) && id !== '.' && id !== '..';

/**
 * opts:
 *   getPacks()        the packs here (the user's own, not the built-in ones)
 *   setPacks(list)    replace them (after changes from the database)
 *   onChange()        the status or the packs changed: redraw
 *   connect()         resolves the database, or null when there is none
 *   saved             { remote: { id: sig }, deleted: [id] } from the last visit
 */
export function createPackStore({ getPacks, setPacks, onChange, connect, saved = null }) {
  let db = null;
  let status = 'connecting'; // connecting | local | ready | saving | offline | error
  let detail = '';
  let loaded = false;
  let timer = 0;
  let flushing = false;
  let again = false;
  // The database as last seen from here: id -> sig. Kept between visits, so changes made
  // here while away are told apart from changes made elsewhere.
  const remote = new Map(Object.entries(saved?.remote ?? {}).filter(([id, sig]) => isDocId(id) && typeof sig === 'string'));
  const deleted = new Set((saved?.deleted ?? []).filter(isDocId));

  const set = (s, d = '') => {
    status = s;
    detail = d;
  };

  async function start() {
    try {
      db = await connect();
    } catch {
      db = null;
    }
    if (!db) {
      set('local');
      onChange();
      return;
    }
    const slow = setTimeout(() => {
      if (!loaded) {
        set('offline');
        onChange();
      }
    }, LOAD_TIMEOUT);
    try {
      db.collection(COLLECTION).onSnapshot(
        (snap) => {
          apply(snap.docs);
          if (!snap.metadata?.fromCache) {
            loaded = true;
            clearTimeout(slow);
            if (status === 'connecting' || status === 'offline') set('ready');
          }
          onChange();
          if (loaded) schedule(0);
        },
        (err) => {
          clearTimeout(slow);
          set(err?.code === 'revoked' || err?.code === 'not_granted' || err?.code === 'capability_disabled' ? 'local' : 'error', err?.message ?? '');
          db = err?.code === 'unavailable' || err?.code === 'resource_exhausted' ? db : null;
          onChange();
        },
      );
    } catch (err) {
      clearTimeout(slow);
      set('error', err?.message ?? '');
      onChange();
    }
  }

  /** Take in the database's packs. */
  function apply(docs) {
    const local = getPacks();
    const there = new Map(); // every pack in the database
    for (const doc of docs) {
      try {
        const data = doc.data();
        const pack = normalizePack({ ...data, id: doc.id });
        pack.created = Number(data.created) || 0;
        there.set(doc.id, pack);
      } catch {
        // not a pack: leave it alone
      }
    }
    // Packs deleted here are not taken back; their delete is on its way.
    const incoming = new Map([...there].filter(([id]) => !deleted.has(id)));
    const next = [];
    for (const p of local) {
      const theirs = incoming.get(p.id);
      const was = remote.get(p.id);
      const changedHere = was !== undefined && packSig(p) !== was;
      if (theirs) {
        next.push(changedHere || packSig(p) === packSig(theirs) ? p : theirs);
      } else if (was === undefined || changedHere) {
        next.push(p); // new here, or changed here after it was deleted elsewhere: keep it
      }
      // else: deleted on another device, unchanged here: drop it
    }
    const known = new Set(local.map((p) => p.id));
    const added = [...incoming.values()].filter((p) => !known.has(p.id)).sort((a, b) => a.created - b.created);
    next.push(...added);
    remote.clear();
    for (const [id, pack] of there) remote.set(id, packSig(pack));
    for (const id of [...deleted]) if (!there.has(id)) deleted.delete(id);
    const same = next.length === local.length && next.every((p, i) => p === local[i]);
    if (!same) setPacks(next);
  }

  function schedule(delay = WRITE_PAUSE) {
    if (!db || !loaded) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  /** Write what changed here: deletions, then new and changed packs, one at a time. */
  async function flush() {
    if (!db || !loaded) return;
    if (flushing) {
      again = true;
      return;
    }
    flushing = true;
    try {
      do {
        again = false;
        for (const id of [...deleted]) {
          if (!remote.has(id)) {
            deleted.delete(id);
            continue;
          }
          set('saving');
          onChange();
          await db.doc(`${COLLECTION}/${id}`).delete();
          remote.delete(id);
          deleted.delete(id);
        }
        for (const pack of getPacks()) {
          if (!isDocId(pack.id)) continue;
          const sig = packSig(pack);
          if (remote.get(pack.id) === sig) continue;
          set('saving');
          onChange();
          if (!pack.created) pack.created = Date.now();
          await db.doc(`${COLLECTION}/${pack.id}`).set({ ...packToFile(pack), created: pack.created, updated: new Date().toISOString() });
          remote.set(pack.id, sig);
        }
      } while (again);
      set('ready');
    } catch (err) {
      set('error', err?.code === 'quota_exceeded' ? 'The database is full.' : err?.message ?? '');
    } finally {
      flushing = false;
      onChange();
    }
  }

  return {
    start,
    /** Something changed here: write it after a pause. */
    changed: () => schedule(),
    /** A pack was deleted here. */
    deleted: (id) => {
      if (remote.has(id)) deleted.add(id);
      schedule();
    },
    /** { kind, detail } for the screen. */
    status: () => ({ kind: status, detail }),
    /** What to keep for the next visit. */
    saveState: () => ({ remote: Object.fromEntries(remote), deleted: [...deleted] }),
    /** For tests: write now. */
    flush,
  };
}
