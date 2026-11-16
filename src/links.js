// Links printed as QR codes. They only use the part of the address after "#", in a form
// that every host passes on (letters, digits and hyphens):
//   #d-4x4-1121112211221122   a design: opens it as a challenge in the tray
//   #u-ABCD-EFGH-JKLM         an unlock code: adds the pack it belongs to
// The address before "#" is where the app lives (set in the Packs tab).

import { isPackSize } from './packs.js';

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

/** A code as typed or scanned: upper case, groups of 4 with hyphens. */
export function normalizeCode(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

export const isCode = (code) => new RegExp(`^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`).test(code);

/** The app's address without any "#...". */
export function baseAddress(url) {
  return String(url ?? '').trim().replace(/#.*$/, '');
}

export function designLink(base, rows, cols, looks) {
  return `${baseAddress(base)}#d-${rows}x${cols}-${looks.join('')}`;
}

export function unlockLink(base, code) {
  return `${baseAddress(base)}#u-${code}`;
}

/** Read a "#..." part: { kind: 'design', rows, cols, looks } | { kind: 'unlock', code } | null. */
export function parseLink(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  let m = /^d-(\d{1,2})x(\d{1,2})-([1-6]+)$/.exec(h);
  if (m) {
    const rows = Number(m[1]);
    const cols = Number(m[2]);
    if (!isPackSize(rows, cols) || m[3].length !== rows * cols) return null;
    return { kind: 'design', rows, cols, looks: [...m[3]].map(Number) };
  }
  m = /^u-([0-9A-Za-z-]{12,20})$/.exec(h);
  if (m) {
    const code = normalizeCode(m[1]);
    return isCode(code) ? { kind: 'unlock', code } : null;
  }
  return null;
}
