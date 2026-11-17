// The cover art for the top of the box lid: the pictures in art/ (listed in art/covers.json),
// built into the page. Each box takes the picture whose shape is closest to its lid top.

/* global __COVER_ART__ */
export const COVER_ART = typeof __COVER_ART__ !== 'undefined' ? __COVER_ART__ : [];

/**
 * The picture for a lid top of l × w mm: { src, width, height, file, fits }, or null.
 * fits is false when the picture has to lose more than about 6% of its width or height.
 */
export function coverFor(l, w, art = COVER_ART) {
  if (!art.length) return null;
  const want = l / w;
  let best = null;
  for (const a of art) {
    const off = Math.abs(Math.log(a.width / a.height / want));
    if (!best || off < best.off) best = { ...a, off };
  }
  return { ...best, fits: best.off < 0.06 };
}
