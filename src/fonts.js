// Widths of Helvetica and Helvetica-Bold (the PDF base fonts; Arial has the same widths),
// in 1/1000 em, for characters 32..126. Used to centre and wrap text identically on screen
// and in the PDF.

const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Unicode -> WinAnsiEncoding byte for the characters outside Latin-1 that the PDF fonts
// still have.
const WIN_ANSI_EXTRA = {
  0x20ac: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
  0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99,
};

/** Byte code of a character in WinAnsiEncoding ("?" when the fonts cannot show it). */
export function winAnsiCode(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  return WIN_ANSI_EXTRA[cp] ?? 63;
}

/** Plain base letter for accented Latin-1 letters, used only to look up a width. */
function baseLetter(ch) {
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return plain.length === 1 ? plain : ch;
}

export function charWidth(ch, bold = false) {
  const table = bold ? BOLD : REGULAR;
  let code = ch.codePointAt(0);
  if (code < 32 || code > 126) code = baseLetter(ch).codePointAt(0);
  if (code === 0xd7) return 584; // multiplication sign
  if (code >= 32 && code <= 126) return table[code - 32];
  return 556;
}

/** Width of a string in font units (size = 1). */
export function textWidth(text, size = 1, bold = false) {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w / 1000) * size;
}

/** Break text into lines no wider than maxWidth. */
export function wrapText(text, size, maxWidth, bold = false) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
