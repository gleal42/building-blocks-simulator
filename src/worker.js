// Runs the pattern search off the main thread so the page stays responsive.
import { solvePattern } from './solver.js';

self.onmessage = (event) => {
  const { id, rows, cols, looks, inventory, maxNodes } = event.data;
  let result;
  try {
    result = solvePattern(rows, cols, looks, inventory, { maxNodes });
  } catch (err) {
    result = { status: 'unknown', reason: `The check stopped with an error: ${err.message}` };
  }
  self.postMessage({ id, result });
};
