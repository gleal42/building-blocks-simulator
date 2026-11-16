// Links printed as QR codes. They only use the part of the address after "#", in a form
// that every host passes on (letters, digits and hyphens):
//   #u-ABCD-EFGH-JKLM         an unlock code: adds the pack it belongs to
// The address before "#" is where the app lives (set in the Packs tab).

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

export function unlockLink(base, code) {
  return `${baseAddress(base)}#u-${code}`;
}

/** Read a "#..." part: { kind: 'unlock', code } | null. */
export function parseLink(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  const m = /^u-([0-9A-Za-z-]{12,20})$/.exec(h);
  if (m) {
    const code = normalizeCode(m[1]);
    return isCode(code) ? { kind: 'unlock', code } : null;
  }
  return null;
}
