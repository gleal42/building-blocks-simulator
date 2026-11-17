# Box cover art (drafts)

The art for the top of the box lid. Drafts, made with an image generator.

The app builds these pictures in (see `covers.json`). In Print › Box, each box shows the one
whose shape is closest to its lid, on the flat lid, on a sketch of the closed box, and in the
PDF. To change the art, replace a `.jpg` (same name and shape) or add one to `covers.json`, then
run `npm run build`. The `.png` files are the originals.

| File | Size | Fits |
|---|---|---|
| `cover-square.jpg` | 1264 × 1264 | 4×4 box, cards on top (lid top 116 × 116 mm) |
| `cover-3x2.jpg` | 1536 × 1024 | 4×4 box, cards beside the tray (lid top 182 × 116 mm) |

Still to do before printing:

- **4×8 box:** a wider version, about 1.8:1 (lid top 209 × 116 mm, cards on top).
- **The red frame:** move it at least 8% in from every edge, or drop it. At about 3.5 mm from the edge it lands on the cut and the fold.
- **Phone icon:** shows a paintbrush. A phone with a QR code would say "scan".
- **Resolution:** upscale the final versions to about 2600 px across.

Until then, the 4×8 box shows `cover-3x2.jpg` cropped, and Print › Box says so.
