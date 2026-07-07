# Tile Reducer — Guide

Load a PNG, see how many unique 8×8 tiles it needs, and merge similar tiles
until the image fits a VRAM budget while staying as close as possible to the
original. The reduced PNG re-imports losslessly into the World and Sprite
editors.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-tile-reducer.html> (see the main
[README](../README.md) for serving instructions).

## What it does

On load, the image is quantized to the four DMG shades (the same luminance
buckets as the editors' importers; alpha reads as the lightest shade) and padded
to a multiple of 8 px so no edge is cropped. It is then sliced into 8×8 tiles and
identical tiles are collapsed into a unique set — that count is your starting
VRAM cost.

**Mirrored tiles are deliberately not merged.** DMG background tiles can't be
flipped in hardware, so a mirrored tile really is a second tile on this target
and the counts stay honest. (Sprites *can* flip — reduce sprite sheets with care.)

Like the Pixelizer, this tool is **stateless**: no project file, no undo. The
outputs are the stats and the reduced PNG.

## Reduction modes

Two modes in the left panel:

- **Target count** — merge until the unique count fits a number you set
  (defaults to the 256 budget). It finds the gentlest merge that fits.
- **Threshold** — merge any tiles closer than a chosen distance. A slider from 0
  (exact duplicates only) to the maximum sum-of-squared-difference between two
  4-shade tiles (everything merges). Good for exploring how aggressively tiles
  collapse.

## Algorithms

- **Greedy (fast)** — one pass over unique tiles ordered by frequency; each tile
  joins the closest cluster within the distance threshold or seeds a new one. In
  target mode it binary-searches the smallest threshold that fits.
- **Agglomerative (quality)** — repeatedly merges the globally cheapest pair.
  Higher quality but O(n²); it can take a few seconds on very detailed images and
  automatically falls back to greedy above ~4096 unique tiles (the stats note when
  it does).

## Merge behavior

- **Merged tile becomes** — what a cluster renders as:
  - **Hybrid (synthesized)** — a new tile from the per-pixel majority of the
    merged tiles (always valid shades, never gray averages).
  - **Most-used member** — keeps the most frequent original tile; no synthesized
    art.
  - **Best-fit member** — keeps the original tile with the least total error to
    the others.
- **Protect frequent tiles** — weighs merges by how often tiles are used (a Ward
  factor), so common art resists changing.
- **Weight tile edges 2×** — border pixels count double in the distance, keeping
  seams between neighboring tiles cleaner.
- **Refinement passes (0–3)** — re-match every tile to its nearest merged tile
  afterward, k-means style. Polishes assignments without growing the cluster count.

## Protected regions

Mark tiles that must survive the reduction untouched — faces, text, logos. On the
original preview, choose **Protect** or **Erase**, then drag to paint single tiles
or **Shift-drag** for a rectangle (**Clear** removes all). Protected tiles are
pinned exactly as drawn, but other tiles may still merge *into* them: reusing a
pinned tile elsewhere is free, since it already occupies a VRAM slot. If you pin
more distinct tiles than the target, they set the floor and the stats say so.

## Reading the result

The stats table reports tiles before/after, the algorithm actually used, how many
tile positions changed, and the protected count. **Highlight changed tiles**
outlines every tile the reduction altered in the after view, and the protected
overlay confirms pinned art came through unchanged. **Palette** and **Zoom**
affect only the preview.

## Output

**Download reduced PNG** writes the result at 1× in the selected palette (GB Green
or Grayscale). Both palettes quantize back to the same four values, so the file
re-imports losslessly into the World and Sprite editors.
