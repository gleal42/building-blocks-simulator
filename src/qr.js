/*! QR codes made with qrcode-generator, (c) 2009 Kazuhiko Arase, MIT license. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED. */
// QR codes as drawing items (the same items the book and the cards are drawn with), so they
// print sharp in the PDFs and show in the page.

import qrcode from 'qrcode-generator';

/**
 * The QR code for some text: { size, dark(row, col) }. Error correction M (15% of the code
 * can be damaged) suits printed cards.
 */
export function qrMatrix(text, level = 'M') {
  const qr = qrcode(0, level);
  qr.addData(String(text), 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return { size, dark: (r, c) => qr.isDark(r, c) };
}

/**
 * Drawing items for a QR code in the square (x, y, side), with a white quiet zone of 4
 * modules included in the square. Dark modules are merged into runs along each row.
 */
export function qrItems(text, x, y, side, { fill = '#000000', background = '#ffffff' } = {}) {
  const { size, dark } = qrMatrix(text);
  const total = size + 8;
  const m = side / total;
  const items = [{ t: 'rect', x, y, w: side, h: side, fill: background }];
  for (let r = 0; r < size; r += 1) {
    let c = 0;
    while (c < size) {
      if (!dark(r, c)) {
        c += 1;
        continue;
      }
      let end = c;
      while (end + 1 < size && dark(r, end + 1)) end += 1;
      // A hair of overlap so neighbouring rows print without white seams.
      items.push({ t: 'rect', x: x + (4 + c) * m, y: y + (4 + r) * m, w: (end - c + 1) * m + m * 0.02, h: m * 1.02, fill });
      c = end + 1;
    }
  }
  return items;
}

/** A QR code as an SVG path (one path, for the page). */
export function qrSvg(text, { className = 'qr', label = 'QR code' } = {}) {
  const { size, dark } = qrMatrix(text);
  let d = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (dark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  }
  const total = size + 8;
  return `<svg viewBox="0 0 ${total} ${total}" class="${className}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
