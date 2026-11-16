// Checks designs in the background: can the pieces of the tray build them? Results are kept
// per design, so each design is only checked once. Runs in its own Web Worker (the Check tab
// has another one), one design at a time; without workers it runs on the page, in turns.

import { defaultInventory } from './board.js';
import { designKey } from './packs.js';
import { solvePattern } from './solver.js';

const BUDGET = 1500000;
const LONG_BUDGET = 8000000;

export function createChecker({ workerSource = null, onResult = () => {} } = {}) {
  const results = new Map(); // key -> { status, pieces?, reason? }
  const waiting = new Map(); // key -> [resolve]
  let queue = []; // { key, rows, cols, looks, budget }
  let busy = null;
  let worker = null;
  let broken = !workerSource;
  let seq = 0;

  function getWorker() {
    if (worker || broken) return worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
      worker.onmessage = (event) => {
        if (busy && event.data.id === busy.id) finish(busy, event.data.result);
      };
      worker.onerror = () => {
        broken = true;
        worker = null;
        if (busy) {
          const job = busy;
          busy = null;
          queue.unshift(job);
          setTimeout(pump, 0);
        }
      };
    } catch {
      broken = true;
      worker = null;
    }
    return worker;
  }

  function finish(job, result) {
    busy = null;
    // A design too busy to decide quickly gets one longer try.
    if (result.status === 'unknown' && job.budget < LONG_BUDGET) {
      queue.push({ ...job, budget: LONG_BUDGET });
    } else {
      const kept = result.status === 'possible' ? { status: 'possible', pieces: result.pieces } : { status: result.status, reason: result.reason };
      results.set(job.key, kept);
      for (const resolve of waiting.get(job.key) ?? []) resolve(kept);
      waiting.delete(job.key);
      onResult(job.key, kept);
    }
    setTimeout(pump, 0);
  }

  function pump() {
    if (busy || !queue.length) return;
    const job = queue.shift();
    if (results.has(job.key)) {
      setTimeout(pump, 0);
      return;
    }
    seq += 1;
    busy = { ...job, id: seq };
    const w = getWorker();
    if (w) {
      w.postMessage({ id: busy.id, rows: job.rows, cols: job.cols, looks: job.looks, inventory: defaultInventory(job.rows, job.cols), maxNodes: job.budget });
    } else {
      const current = busy;
      setTimeout(() => {
        let result;
        try {
          result = solvePattern(job.rows, job.cols, job.looks, defaultInventory(job.rows, job.cols), { maxNodes: job.budget });
        } catch (err) {
          result = { status: 'unknown', reason: err.message };
        }
        if (busy === current) finish(current, result);
      }, 10);
    }
  }

  /** The result for a design if known: { status, pieces?, reason? } or undefined. */
  function get(rows, cols, looks) {
    return results.get(designKey(rows, cols, looks));
  }

  /**
   * Ask for a design to be checked. first: check it before the others (the design being
   * painted). Returns a promise of the result.
   */
  function check(rows, cols, looks, { first = false } = {}) {
    const key = designKey(rows, cols, looks);
    if (results.has(key)) return Promise.resolve(results.get(key));
    const promise = new Promise((resolve) => {
      if (!waiting.has(key)) waiting.set(key, []);
      waiting.get(key).push(resolve);
    });
    const queued = queue.findIndex((j) => j.key === key);
    if (busy?.key !== key) {
      const job = queued >= 0 ? queue.splice(queued, 1)[0] : { key, rows, cols, looks: looks.slice(), budget: BUDGET };
      if (first) queue.unshift(job);
      else queue.push(job);
    }
    pump();
    return promise;
  }

  /** Stop waiting for a design (the painted design changes with every stroke). */
  function drop(rows, cols, looks) {
    const key = designKey(rows, cols, looks);
    queue = queue.filter((j) => j.key !== key);
    waiting.delete(key);
  }

  return { get, check, drop, pending: () => queue.length + (busy ? 1 : 0) };
}
