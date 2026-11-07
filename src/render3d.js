// Small orthographic 3D renderer for convex pieces: rotation icons and the 3D board view.
// World axes: x east, y north, z up. Square (r, c) of a board with R rows covers
// x in [c, c+1], y in [R-1-r, R-r].

import { DC, DR, MIX_ORIENTS, cubeSolid, halfSolid, isCap, isRamp, isUpright } from './geometry.js';

const deg = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const fmt = (n) => (Math.round(n * 100) / 100).toString();

export function makeCamera(azimuth = 22, elevation = 52) {
  const az = azimuth * deg;
  const el = elevation * deg;
  const d = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)]; // towards camera
  const right = [Math.cos(az), Math.sin(az), 0];
  const up = cross(d, right);
  return {
    d,
    project: (p) => [dot(p, right), -dot(p, up)],
    depth: (p) => dot(p, d),
  };
}

// Light from the front-left and high up (fixed in the world, so turning the 3D view
// changes which faces are lit). Top, front and side faces all get different shades.
const LIGHT = norm([-0.42, -0.55, 0.8]);

const PALETTE = {
  W: { dark: [138, 139, 135], light: [253, 253, 251] },
  B: { dark: [5, 6, 7], light: [70, 74, 80] },
  tray: { dark: [150, 120, 70], light: [244, 226, 182] },
  floor: { dark: [160, 128, 78], light: [214, 190, 140] },
};

function shade(paletteKey, normal) {
  const { dark, light } = PALETTE[paletteKey];
  const lambert = Math.max(0, dot(normal, LIGHT));
  const t = Math.min(1, 0.22 + 0.82 * lambert);
  const c = dark.map((x, i) => Math.round(x + (light[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Faces of a convex solid with outward normals: [{ pts: [[x,y,z]], normal }]. */
function facesOf(solid, toWorld) {
  const verts = solid.verts.map(toWorld);
  const centre = verts.reduce((a, v) => [a[0] + v[0] / verts.length, a[1] + v[1] / verts.length, a[2] + v[2] / verts.length], [0, 0, 0]);
  return solid.faces.map((f) => {
    const pts = f.map((i) => verts[i]);
    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const fc = pts.reduce((a, v) => [a[0] + v[0] / pts.length, a[1] + v[1] / pts.length, a[2] + v[2] / pts.length], [0, 0, 0]);
    if (dot(n, sub(fc, centre)) < 0) n = n.map((x) => -x);
    return { pts, normal: n, centre: fc };
  });
}

function polygonSvg(points2d, fill, stroke = fill, width = 0.012) {
  const d = points2d.map(([x, y]) => `${fmt3(x)},${fmt3(y)}`).join(' ');
  return `<polygon points="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
}
const fmt3 = (n) => (Math.round(n * 1000) / 1000).toString();

/**
 * The convex parts of a piece in world space: [{ solid, toWorld, cell: [r, c], layer }].
 * shrink: fraction of a square left as a gap between neighbouring pieces.
 */
export function pieceParts(piece, rows, shrink = 0) {
  const parts = [];
  const cellWorld = (r, c) => [c, rows - 1 - r];
  const cells = [];
  if (piece.type === 'tri') {
    cells.push({ r: piece.r, c: piece.c, solid: halfSolid(piece.o), layer: layerOf(piece.o) });
  } else {
    const m = MIX_ORIENTS[piece.o];
    cells.push({ r: piece.r, c: piece.c, solid: cubeSolid(), layer: 1 });
    cells.push({ r: piece.r + DR[m.dir], c: piece.c + DC[m.dir], solid: halfSolid(m.half), layer: layerOf(m.half) });
  }
  // Centre of the whole piece footprint, used to shrink it as one body.
  const centre = cells.reduce(
    (a, x) => {
      const [wx, wy] = cellWorld(x.r, x.c);
      return [a[0] + (wx + 0.5) / cells.length, a[1] + (wy + 0.5) / cells.length];
    },
    [0, 0],
  );
  const k = 1 - shrink;
  for (const x of cells) {
    const [wx, wy] = cellWorld(x.r, x.c);
    const toWorld = ([u, v, w]) => [centre[0] + (wx + u - centre[0]) * k, centre[1] + (wy + v - centre[1]) * k, w];
    parts.push({ solid: x.solid, toWorld, cell: [x.r, x.c], layer: x.layer });
  }
  return parts;
}

/** A cube + prism as one convex solid, in the cube's square-local coordinates. */
export function mixSolid(o) {
  const m = MIX_ORIENTS[o];
  const off = [[0, 1], [1, 0], [0, -1], [-1, 0]][m.dir];
  const pts = [...cubeSolid().verts, ...halfSolid(m.half).verts.map(([u, v, w]) => [u + off[0], v + off[1], w])];
  // The piece is a prism along one axis: up for standing poses, across the piece otherwise.
  const axis = isUpright(m.half) ? 2 : m.dir === 1 || m.dir === 3 ? 1 : 0;
  const [a, b] = [0, 1, 2].filter((k) => k !== axis);
  const section = hull2d(pts.map((p) => [p[a], p[b]]));
  const lift = (q, t) => {
    const out = [0, 0, 0];
    out[a] = q[0];
    out[b] = q[1];
    out[axis] = t;
    return out;
  };
  const n = section.length;
  const verts = [...section.map((q) => lift(q, 0)), ...section.map((q) => lift(q, 1))];
  const faces = [section.map((_, i) => i), section.map((_, i) => n + i)];
  for (let i = 0; i < n; i += 1) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  return { verts, faces };
}

function hull2d(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const crossZ = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const build = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && crossZ(out[out.length - 2], out[out.length - 1], p) <= 1e-12) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

function layerOf(h) {
  if (isRamp(h)) return 0;
  if (isCap(h)) return 2;
  return 1;
}

/** SVG markup for a rotation icon of one piece. */
export function pieceIcon(type, color, o, { size = 56, azimuth = 30, elevation = 36 } = {}) {
  const camera = makeCamera(azimuth, elevation);
  // Footprint (squares the piece stands on), with the cube's square at the origin.
  const cells = [[0, 0]];
  let solid;
  if (type === 'mix') {
    const m = MIX_ORIENTS[o];
    cells.push([[0, 1], [1, 0], [0, -1], [-1, 0]][m.dir]);
    solid = mixSolid(o);
  } else {
    solid = halfSolid(o);
  }
  const footprint = cells.map(([x, y]) => [[x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]]);
  // Frame of a fixed size centred on the footprint, so all icons of a kind share one scale.
  const cx = cells.reduce((acc, q) => acc + q[0] + 0.5, 0) / cells.length;
  const cy = cells.reduce((acc, q) => acc + q[1] + 0.5, 0) / cells.length;
  const half = type === 'mix' ? 1.02 : 0.62;
  const frame = [];
  for (const x of [cx - half, cx + half]) for (const y of [cy - half, cy + half]) for (const z of [0, 1]) frame.push(camera.project([x, y, z]));
  const minX = Math.min(...frame.map((p) => p[0]));
  const maxX = Math.max(...frame.map((p) => p[0]));
  const minY = Math.min(...frame.map((p) => p[1]));
  const maxY = Math.max(...frame.map((p) => p[1]));
  const pad = 0.06;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  const vb = `${fmt3(minX - pad)} ${fmt3(minY - pad)} ${fmt3(w)} ${fmt3(h)}`;
  const edge = color === 'W' ? 'rgba(70,68,60,0.75)' : 'rgba(205,212,222,0.45)';
  const shadow = footprint
    .map((quad) => `<polygon points="${quad.map((p) => camera.project(p).map(fmt3).join(',')).join(' ')}" class="icon-floor"/>`)
    .join('');
  const body = facesOf(solid, (p) => p)
    .filter((f) => dot(f.normal, camera.d) > 1e-6)
    .map((f) => polygonSvg(f.pts.map(camera.project), shade(color, f.normal), edge, 0.022))
    .join('');
  return `<svg viewBox="${vb}" width="${size}" height="${Math.round((size * h) / w)}" aria-hidden="true" focusable="false">${shadow}${body}</svg>`;
}

/** SVG markup of the whole board in 3D. */
export function board3d(board, { azimuth = 22, elevation = 48 } = {}) {
  const camera = makeCamera(azimuth, elevation);
  const R = board.rows;
  const C = board.cols;
  const rim = 0.32;
  const wallH = 0.32;
  const box = (x0, y0, x1, y1, z0, z1) => ({
    solid: cubeSolid(),
    toWorld: ([u, v, w]) => [x0 + u * (x1 - x0), y0 + v * (y1 - y0), z0 + w * (z1 - z0)],
  });
  const walls = [
    box(-rim, R, C + rim, R + rim, 0, wallH), // north
    box(-rim, -rim, C + rim, 0, 0, wallH), // south
    box(C, 0, C + rim, R, 0, wallH), // east
    box(-rim, 0, 0, R, 0, wallH), // west
  ];
  const base = box(-rim, -rim, C + rim, R + rim, -0.18, 0);
  const shapes = [];
  // Drawn in tiers: tray base, floor, far walls, pieces (back to front), near walls.
  const pushSolid = (part, key, tier, order = 0) => {
    for (const face of facesOf(part.solid, part.toWorld)) {
      if (dot(face.normal, camera.d) <= 1e-6) continue;
      shapes.push({ pts: face.pts, fill: shade(key, face.normal), tier, order: order + camera.depth(face.centre) * 1e-3 });
    }
  };
  pushSolid(base, 'tray', 0);
  const floor = [[0, 0, 0.001], [C, 0, 0.001], [C, R, 0.001], [0, R, 0.001]];
  shapes.push({ pts: floor, fill: shade('floor', [0, 0, 1]), tier: 1, order: 0 });
  const centreDepth = camera.depth([C / 2, R / 2, 0]);
  for (const wall of walls) {
    const mid = wall.toWorld([0.5, 0.5, 0.5]);
    pushSolid(wall, 'tray', camera.depth(mid) < centreDepth ? 2 : 4, camera.depth(mid));
  }
  // Pieces, square by square from the back to the front; lower halves before upper ones.
  const parts = [];
  for (const piece of board.pieces.values()) {
    for (const part of pieceParts(piece, R, 0.035)) parts.push({ part, color: piece.color });
  }
  for (const { part, color } of parts) {
    const [r, c] = part.cell;
    const cellDepth = camera.depth([c + 0.5, R - 1 - r + 0.5, 0]);
    const faces = facesOf(part.solid, part.toWorld);
    const partDepth = camera.depth(faces.reduce((a, f) => [a[0] + f.centre[0], a[1] + f.centre[1], a[2] + f.centre[2]], [0, 0, 0]).map((x) => x / faces.length));
    for (const face of faces) {
      if (dot(face.normal, camera.d) <= 1e-6) continue;
      shapes.push({ pts: face.pts, fill: shade(color, face.normal), tier: 3, order: cellDepth * 1000 + part.layer * 10 + partDepth * 0.01 });
    }
  }
  shapes.sort((a, b) => a.tier - b.tier || a.order - b.order);
  const all = shapes.flatMap((s) => s.pts.map(camera.project));
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const pad = 0.3;
  const vb = `${fmt(minX - pad)} ${fmt(minY - pad)} ${fmt(maxX - minX + 2 * pad)} ${fmt(maxY - minY + 2 * pad)}`;
  const body = shapes.map((s) => polygonSvg(s.pts.map(camera.project), s.fill)).join('');
  return { viewBox: vb, markup: body, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}

