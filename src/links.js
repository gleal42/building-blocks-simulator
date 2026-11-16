// Unlock codes and the link printed as a QR code on the unlock card in each box.
//   code   12 letters and digits in groups of 4, like K7QM-3XTP-ZR8D (no 0/O or 1/I)
//   link   <where the app lives>#u-K7QM-3XTP-ZR8D (only the part after "#", which every host
//          passes on to the page)
// For now the customer side is a preview: each pack has one sample code (sampleCode). Real
// codes, one per box, come from the setup in docs/going-live.md.

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

/** A code as typed or scanned: upper case, groups of 4 with hyphens. */
export function normalizeCode(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

export const isCode = (code) => new RegExp(`^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`).test(code);

/**
 * The first code in any text: typed with or without hyphens or spaces, in lower case, or
 * pasted with other words or other codes around it (a whole list, a link). '' if none.
 */
export function findCode(text) {
  const upper = String(text ?? '').toUpperCase();
  const ch = `[${CODE_ALPHABET}]`;
  // Written in groups (K7QM-3XTP-ZR8D, or with spaces). A one-line box glues a pasted list
  // into one line, so the code may run straight into the next one.
  const grouped = new RegExp(`(?:^|[^0-9A-Z])(${ch}{4}[-\\s]${ch}{4}[-\\s]${ch}{4})`).exec(upper);
  if (grouped) return normalizeCode(grouped[1]);
  // Written in one go (K7QM3XTPZR8D).
  const plain = new RegExp(`(?:^|[^0-9A-Z])(${ch}{12})(?![0-9A-Z])`).exec(upper);
  if (plain) return normalizeCode(plain[1]);
  const whole = normalizeCode(upper);
  return isCode(whole) ? whole : '';
}

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

/** The sample code of a pack in the customer preview: always the same for the same pack. */
export function sampleCode(packId) {
  // FNV-1a, twice with different seeds, gives 60 bits: plenty for 12 letters of 5 bits.
  const hash = (seed) => {
    let h = seed >>> 0;
    for (const c of String(packId)) {
      h ^= c.codePointAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  };
  const a = hash(2166136261);
  const b = hash(0x9e3779b9);
  let bits = BigInt(a) * 4294967296n + BigInt(b);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += CODE_ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }
  return normalizeCode(out);
}
