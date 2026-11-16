// Locked packs: a pack sold with unlock codes, one per buyer.
//
// The designs are encrypted (AES-GCM) with a random pack key. The pack key is then encrypted
// once per code, with a key worked out from that code (PBKDF2). So the app can carry a locked
// pack openly: without one of its codes nobody can read the designs, and each code printed on
// a box opens the same pack. Nothing needs a server.
//
// A locked pack (plain JSON, safe to put in the app):
//   { format, version, id, name, rows, cols, count, salt, iterations, iv, data, keys: [{ iv, key }] }
// The codes themselves are kept only by the maker (never inside the app).

import { CODE_ALPHABET, normalizeCode } from './links.js';
import { normalizePack } from './packs.js';

export const LOCK_FORMAT = 'building-blocks-locked-pack';
export const LOCK_VERSION = 1;
const ITERATIONS = 120000;

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This browser cannot unlock packs (no Web Crypto).');
  return s;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** n new codes like "K7QM-3XTP-ZR8D" (60 bits each), all different. */
export function makeCodes(n) {
  const codes = new Set();
  while (codes.size < n) {
    const bytes = randomBytes(12);
    let raw = '';
    for (const b of bytes) raw += CODE_ALPHABET[b % CODE_ALPHABET.length];
    codes.add(normalizeCode(raw));
  }
  return [...codes];
}

async function codeKey(code, salt, iterations) {
  const material = await subtle().importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Lock a pack with a list of codes (lock it again with the same codes after editing it). */
export async function lockPack(pack, codes, { iterations = ITERATIONS } = {}) {
  const s = subtle();
  const rawKey = randomBytes(32);
  const packKey = await s.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const designs = pack.designs.map((d) => ({ looks: d.looks.join(''), stars: d.stars }));
  const data = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv }, packKey, enc.encode(JSON.stringify(designs))));
  const keys = [];
  for (const code of codes) {
    const k = await codeKey(code, salt, iterations);
    const kiv = randomBytes(12);
    keys.push({ iv: toBase64(kiv), key: toBase64(new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv: kiv }, k, rawKey))) });
  }
  // The order of the entries must not give away which code is which.
  keys.sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    format: LOCK_FORMAT,
    version: LOCK_VERSION,
    id: pack.id.replace(/^builtin:/, ''),
    name: pack.name,
    rows: pack.rows,
    cols: pack.cols,
    count: pack.designs.length,
    salt: toBase64(salt),
    iterations,
    iv: toBase64(iv),
    data: toBase64(data),
    keys,
  };
}

/** Is this a locked pack (shape only; the codes decide the rest)? */
export function isLockedPack(x) {
  return !!x && x.format === LOCK_FORMAT && typeof x.data === 'string' && Array.isArray(x.keys) && typeof x.salt === 'string'
    && Number.isInteger(x.rows) && Number.isInteger(x.cols) && Number.isInteger(x.iterations);
}

/** Open a locked pack with a code: the pack (unlocked), or null when the code is not one of its codes. */
export async function unlockPack(locked, code) {
  if (!isLockedPack(locked)) return null;
  const s = subtle();
  const k = await codeKey(code, fromBase64(locked.salt), locked.iterations);
  for (const entry of locked.keys) {
    let rawKey;
    try {
      rawKey = await s.decrypt({ name: 'AES-GCM', iv: fromBase64(entry.iv) }, k, fromBase64(entry.key));
    } catch {
      continue; // another code's entry
    }
    const packKey = await s.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await s.decrypt({ name: 'AES-GCM', iv: fromBase64(locked.iv) }, packKey, fromBase64(locked.data));
    const designs = JSON.parse(dec.decode(plain));
    return normalizePack({ id: locked.id, name: locked.name, rows: locked.rows, cols: locked.cols, designs });
  }
  return null;
}

/** Try a code on several locked packs: { locked, pack } for the first it opens, or null. */
export async function unlockAny(lockedPacks, code) {
  for (const locked of lockedPacks) {
    const pack = await unlockPack(locked, code);
    if (pack) return { locked, pack };
  }
  return null;
}
