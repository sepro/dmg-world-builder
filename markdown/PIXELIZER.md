# Pixelizer — Guide

Turn any full-resolution image into small 2-bit pixel art for the Game Boy:
tone-map it, downscale it with a pixel-art-aware algorithm, and quantize it to
the four DMG shades. The output PNG re-imports losslessly into the World and
Sprite editors, or hands straight off to the Tile Reducer.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-pixelizer.html> (see the main
[README](../README.md) for serving instructions).

## Why not just resize and threshold?

Standard scaling filters (bicubic and friends) average across edges, so once
you quantize down to four shades everything turns to mush. The Pixelizer uses
the downscalers the pixel-art community actually reaches for, and it lets you
choose the order of the two lossy steps because that choice changes the look.

The tool is **stateless**: no project file and no undo. Load an image, tune the
controls (everything recomputes live), and download the result.

## The pipeline

Every control feeds one pipeline. Reading top to bottom in the left panel:

1. **Output width** — target width in pixels; height follows the aspect ratio.
   Defaults to 160 (the GB screen width). Minimum 8, capped at the source width.
2. **Order** — which lossy step runs first:
   - **4 shades first, then scale** (default): quantize at source resolution,
     then scale in shade space. Keeps hard 2-bit edges through the scaler.
     Dithering happens before scaling, so fine dither mostly washes out.
   - **Scale first, then 4 shades**: scale the tone-mapped luminance, then
     quantize. Keeps gradients for the quantizer and lets dithering work at
     output resolution (usually what dithering wants).
3. **Scale algorithm** — how each output pixel reduces its source block:
   - **K-centroid** (recommended): 1D k-means over the block, keep the centroid
     of the biggest cluster. Preserves the block's dominant feature instead of
     averaging across an edge. The **K** value (2–4) sets clusters per block.
   - **Dominant value** — the most frequent value in the block (mode). Crispest
     for art that is already flat-shaded.
   - **Box average** — plain area average. Smooth but the blurriest.
   - **Nearest sample** — a single center sample. Aliased but razor sharp.

## Transparency (chroma key)

Optionally key out one color so it becomes the alpha channel. Enable it, pick
the color with the swatch or the **Pick from image** eyedropper (then click the
source preview), and set a **Tolerance** (RGB radius around the key color).
Matching pixels are left out of tone mapping, the shade split, and the tile
count, and are written transparent in the PNG. Pixels already transparent in
the source are always treated as transparent.

## Tone

Applied before scaling and quantizing:

- **Auto levels** — stretch the 1st–99th luminance percentile to full range
  before the manual knobs. Robust to outliers; keyed-out pixels are excluded so
  a chroma-key background can't skew the levels.
- **Brightness** / **Contrast** (−100…100) and **Gamma** (0.2…3).

## Shades

Quantization uses three boundaries splitting luminance into the four shades
(0 = lightest … 3 = darkest). Drag them by hand, or click **Balance shades** to
fit them to the image: a weighted 1D k-means over the tone-mapped histogram
places the boundaries between the four cluster centers. This is more robust than
percentile splits, which collapse on an image dominated by one brightness (a
mostly-white background otherwise pushes every boundary to the top).

**Dithering** (optional): ordered Bayer 2×2 / 4×4 / 8×8 or Floyd–Steinberg, with
a **strength** slider (percent of one shade step). Dithering trades a smoother
gradient for many more unique tiles, so watch the tile stat if the art is headed
for a tileset — leave it on **None** for the tightest tile count.

## Reading the output

The stats table shows the source, the output size, and the **unique 8×8 tile**
count — a preview of the VRAM cost before the image goes anywhere near a map.
The budget line turns red past the 256-tile DMG ceiling and points you at the
Tile Reducer. The **Palette** picker (GB Green or Grayscale) and **Zoom** only
affect the preview; both palettes quantize back to the same four values.

## Output

- **Download PNG** — the result at 1× in the current palette. It re-imports
  losslessly into the World and Sprite editors (transparent pixels stay
  transparent).
- **Send to Reducer** — hand the exact same pixels to the
  [Tile Reducer](TILE_REDUCER.md) with no download/upload round trip, for when
  the tile count is over budget.
