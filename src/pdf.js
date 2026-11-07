// A small PDF 1.4 writer for vector drawings: filled / stroked paths, text in the base
// fonts Helvetica and Helvetica-Bold, and JPEG images. Enough for the challenge book.

import { textWidth, winAnsiCode } from './fonts.js';

const latin1 = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0) & 255);
const num = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '0 0 0';
  return [m[1], m[2], m[3]].map((h) => num(parseInt(h, 16) / 255)).join(' ');
}

function pdfString(text) {
  let out = '(';
  for (const ch of text) {
    const code = winAnsiCode(ch);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

export function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/**
 * Collects drawing commands for one PDF page. Coordinates are given in a "design" box
 * (x to the right, y downwards) that is mapped onto a square area of the page.
 */
export class PageCanvas {
  constructor(doc, width, height) {
    this.doc = doc;
    this.width = width;
    this.height = height;
    this.ops = [];
    this.images = new Set();
    this.frame = { x: 0, y: 0, k: 1 }; // design units -> points; y measured from the top
  }

  /** Map design coordinates (0..size) onto the square at (x, yTop) with side side points. */
  setFrame(x, yTop, side, designSize = 1000) {
    this.frame = { x, y: yTop, k: side / designSize };
  }

  X(x) {
    return this.frame.x + x * this.frame.k;
  }

  Y(y) {
    return this.height - (this.frame.y + y * this.frame.k);
  }

  op(s) {
    this.ops.push(s);
  }

  save() {
    this.op('q');
  }

  restore() {
    this.op('Q');
  }

  clipRect(x, y, w, h) {
    this.op(`${num(this.X(x))} ${num(this.Y(y + h))} ${num(w * this.frame.k)} ${num(h * this.frame.k)} re W n`);
  }

  style(fill, stroke, sw, dash) {
    if (fill) this.op(`${rgb(fill)} rg`);
    if (stroke) {
      this.op(`${rgb(stroke)} RG`);
      this.op(`${num((sw ?? 1) * this.frame.k)} w`);
      this.op(dash ? `[${dash.map((d) => num(d * this.frame.k)).join(' ')}] 0 d` : '[] 0 d');
    }
    if (fill && stroke) return 'B';
    if (fill) return 'f';
    if (stroke) return 'S';
    return 'n';
  }

  polygon(pts, { fill, stroke, sw, dash } = {}) {
    const paint = this.style(fill, stroke, sw, dash);
    const path = pts.map(([x, y], i) => `${num(this.X(x))} ${num(this.Y(y))} ${i ? 'l' : 'm'}`).join(' ');
    this.op(`${path} h ${paint}`);
  }

  rect(x, y, w, h, { r = 0, fill, stroke, sw, dash } = {}) {
    if (!r) {
      this.polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { fill, stroke, sw, dash });
      return;
    }
    const paint = this.style(fill, stroke, sw, dash);
    const c = 0.5523 * r;
    const P = (px, py) => `${num(this.X(px))} ${num(this.Y(py))}`;
    const d = [
      `${P(x + r, y)} m`,
      `${P(x + w - r, y)} l`,
      `${P(x + w - r + c, y)} ${P(x + w, y + r - c)} ${P(x + w, y + r)} c`,
      `${P(x + w, y + h - r)} l`,
      `${P(x + w, y + h - r + c)} ${P(x + w - r + c, y + h)} ${P(x + w - r, y + h)} c`,
      `${P(x + r, y + h)} l`,
      `${P(x + r - c, y + h)} ${P(x, y + h - r + c)} ${P(x, y + h - r)} c`,
      `${P(x, y + r)} l`,
      `${P(x, y + r - c)} ${P(x + r - c, y)} ${P(x + r, y)} c`,
    ];
    this.op(`${d.join(' ')} h ${paint}`);
  }

  circle(cx, cy, r, opts = {}) {
    this.rect(cx - r, cy - r, 2 * r, 2 * r, { ...opts, r });
  }

  line(x1, y1, x2, y2, { stroke = '#000000', sw = 1, dash } = {}) {
    this.style(null, stroke, sw, dash);
    this.op(`${num(this.X(x1))} ${num(this.Y(y1))} m ${num(this.X(x2))} ${num(this.Y(y2))} l S`);
  }

  /** Text with its baseline at y. anchor: start | middle | end. */
  text(x, y, text, { size = 12, bold = false, fill = '#000000', anchor = 'start' } = {}) {
    const width = textWidth(text, size, bold);
    const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    this.op(`BT /${bold ? 'F2' : 'F1'} ${num(size * this.frame.k)} Tf ${rgb(fill)} rg ${num(this.X(left))} ${num(this.Y(y))} Td ${pdfString(text)} Tj ET`);
  }

  /** A JPEG scaled to cover the box (cropped, centred). */
  image(x, y, w, h, { bytes, width, height }) {
    const name = this.doc.addImage(bytes, width, height);
    this.images.add(name);
    const scale = Math.max(w / width, h / height);
    const dw = width * scale;
    const dh = height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    this.save();
    this.clipRect(x, y, w, h);
    this.op(`${num(dw * this.frame.k)} 0 0 ${num(dh * this.frame.k)} ${num(this.X(dx))} ${num(this.Y(dy + dh))} cm /${name} Do`);
    this.restore();
  }
}

export class PdfDocument {
  constructor() {
    this.pages = [];
    this.images = [];
    this.imageByBytes = new Map();
  }

  addImage(bytes, width, height) {
    const known = this.imageByBytes.get(bytes);
    if (known) return known;
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, bytes, width, height });
    this.imageByBytes.set(bytes, name);
    return name;
  }

  page(width, height) {
    const canvas = new PageCanvas(this, width, height);
    this.pages.push(canvas);
    return canvas;
  }

  /** The finished file. */
  toBytes() {
    const chunks = [];
    let offset = 0;
    const offsets = [];
    const write = (data) => {
      const bytes = typeof data === 'string' ? latin1(data) : data;
      chunks.push(bytes);
      offset += bytes.length;
    };
    const object = (n, body) => {
      offsets[n] = offset;
      write(`${n} 0 obj\n${body}\nendobj\n`);
    };
    const stream = (n, dict, bytes) => {
      offsets[n] = offset;
      write(`${n} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);
      write(bytes);
      write('\nendstream\nendobj\n');
    };

    write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const imageObj = new Map();
    let next = 5;
    for (const img of this.images) imageObj.set(img.name, next++);
    const pageObjs = this.pages.map(() => {
      const ids = [next, next + 1];
      next += 2;
      return ids;
    });

    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, `<< /Type /Pages /Kids [${pageObjs.map(([p]) => `${p} 0 R`).join(' ')}] /Count ${this.pages.length} >>`);
    object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    for (const img of this.images) {
      stream(
        imageObj.get(img.name),
        `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        img.bytes,
      );
    }
    this.pages.forEach((page, i) => {
      const [pageId, contentId] = pageObjs[i];
      const xobjects = [...page.images].map((name) => `/${name} ${imageObj.get(name)} 0 R`).join(' ');
      object(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${contentId} 0 R >>`,
      );
      stream(contentId, '', latin1(page.ops.join('\n')));
    });

    const xrefAt = offset;
    const count = next;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n += 1) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    write(xref);
    write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(offset);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

export const MM = 72 / 25.4;
