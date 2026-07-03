# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the pages

The tools are static HTML with no build step. Serve the repo root over HTTP and open a page in a browser:

```bash
python3 -m http.server 8000
# world editor:    http://localhost:8000/dist/gb-world-editor.html
# sprite editor:   http://localhost:8000/dist/gb-sprite-editor.html
# music generator: http://localhost:8000/dist/gb-music-generator.html
# tile reducer:    http://localhost:8000/dist/gb-tile-reducer.html
# pixelizer:       http://localhost:8000/dist/gb-pixelizer.html
```

Inside the devcontainer a static server starts automatically on port 5500 via VS Code Live Server.

The pages live in `dist/` and share `dist/gb-theme.css` (the DMG design tokens + generic components: top bar, tabs, cards, controls, modal) and `dist/gb-common.js` (DOM/form helpers, the modal, and `downloadBlob`/`downloadText`/`copyText`). Each page keeps its own page-specific CSS inline and links these two shared files. Because they are linked (not inlined), the pages must be served over HTTP — opening the `.html` via `file://` will not load the shared assets.

## Tooling commands

```bash
# Convert an exported project to GBDK-2020 C
python3 tools/gbworld_to_c.py project.gbworld.json -o build/ --name world

# Render a stitched world PNG (3× upscale, with map labels)
python3 tools/gbworld_visualize.py project.gbworld.json -o world.png --scale 3
```

`gbworld_to_c.py` needs only the Python standard library. `gbworld_visualize.py` needs Pillow (`pip install pillow`; preinstalled in the devcontainer).

## Architecture

### The single-file editor (`dist/gb-world-editor.html`)

The entire authoring tool lives in one ~2300-line HTML file: CSS at the top, static HTML in `<body>`, and all JavaScript in a `<script>` block starting around line 310. There is no build system, bundler, or framework — vanilla JS only.

**Data model** (`makeDefaultProject`, line ~351): The project is a plain JS object held in memory. The only persistence mechanism is Export/Import (JSON file). Browser storage is intentionally unused so the editor behaves identically when served locally or from a preview.

**App state** (`const state`, line ~492): Editor-only state (selections, active panel, tool, zoom, etc.) is kept strictly separate from the saved project object. Only `state.project` is serialized.

**Rendering pattern** (`render()`, line ~816): The entire UI re-renders on every state change — `panel.innerHTML = ""` then one of `renderPalettesPanel`, `renderTilesPanel`, `renderMetatilesPanel`, `renderBlocksPanel`, or `renderMapsPanel` rebuilds the active panel from scratch. There is no virtual DOM or incremental diffing. Event listeners are re-attached on each render via `addEventListener` calls inside the render functions.

**Undo/redo** (`history`, line ~541): History is a stack of JSON snapshots of `state.project`. Call `snapshot()` immediately before any mutation. A single pointer-stroke collapses to one undo step (snapshot on `pointerdown`, mutations on `pointermove`).

**ID system**: Every tile, metatile, block, map, palette, and event has a stable integer `id` from `project.nextId++`. All cross-references use `id` values, never array indices, so reordering and deletion are safe. The array position becomes the C index at code-generation time.

**Coordinate hierarchy** (internalize this — it governs every field in the data):
| Unit | Size | Cell order |
|------|------|-----------|
| tile | 8×8 px | — |
| metatile | 16×16 px (2×2 tiles) | TL, TR, BL, BR |
| block | 32×32 px (2×2 metatiles) | TL, TR, BL, BR |
| map | W×H blocks | row-major |

Event/warp coordinates are in **metatile cells** (2× the block resolution per axis). Map size and `blockGrid` are in **blocks**.

### The sprite editor (`dist/gb-sprite-editor.html`)

A single-file tool (same conventions as the world editor: `makeDefaultProject`, `const state`, full-rebuild `render()`, JSON-snapshot undo, stable integer ids) for authoring OBJs. Hierarchy: 8×8 tile → **metasprite** (parts = hardware sprites with pixel offsets, H/V flip, palette) → **animation** (frames = metasprite + duration in 60Hz ticks).

Hardware rules the editor models — keep these invariants when editing:
- **OBJ size is global**: `meta.spriteMode` is `"8x8"` or `"8x16"` for the whole project (LCDC bit 2 can't mix sizes). In 8×16 mode a part has `tiles: [top, bottom]`; switching modes converts parts losslessly (`convertSpriteMode`).
- **Pixel value 0 is always transparent** for sprites (rendered as a checker). PNG import maps alpha → 0, or, for opaque sheets, a user-chosen shade → 0 with the rest remapped to 1..3.
- **Part order = OAM priority**: `parts[0]` draws on top; drawing iterates parts last-to-first.
- Sprites *do* support per-object H/V flip (unlike DMG BG tiles); `drawPart` swaps the two 8×8 halves on vertical flip in 8×16 mode.

PNG export writes value 0 as transparent and 1..3 at the importer's bucket midpoints (`#aaaaaa`/`#555555`/`#000000`) so a tile sheet round-trips losslessly. The saved file is `.gbsprite.json` (settings-free full project, `formatVersion 1`); import rejects `.gbworld.json` files by detecting `tilesets`.

### The music generator (`dist/gb-music-generator.html`)

A deterministic chiptune improviser for the four GB channels (Pulse 1 = lead, Pulse 2 = harmony, Wave = bass, Noise = drums). Like the editor it is vanilla JS in one `<script>` block, links the two shared files, and holds all settings in a plain object (`state.settings`, `makeDefaultSettings`).

**Reproducibility is the core contract**: a tune is *fully determined by `settings` + `seed`*. `generate(settings)` seeds `makeRng(seed)` (mulberry32) and produces the `song` object (per-channel note tracks + chord list). Same settings ⇒ identical output, so export/import only stores the settings (the `.gbmusic.json` file); the song is regenerated on import. Don't introduce nondeterminism (`Math.random`, `Date`, unordered iteration) into the generation path — only `audio` playback (Web Audio) and `Math.random` for the "Random seed" button may use it.

**Theory tables** (top of script): `SCALES`, `PROGRESSIONS` (diatonic degree lists), `PATTERNS` (rhythmic archetypes), `MOODS` (parameter profiles), `DUTIES`/`WAVES`/`DRUMS`. Time is quantized to 16th-note steps (`STEPS_PER_QUARTER = 4`); `stepsPerBar = beats * (16/unit)`. Swing + humanize are baked into each note's float onset `t` and velocity at generation time so playback, the score, and MIDI all agree.

**Output**: piano-roll and simplified-staff views are drawn to `<canvas>` (`buildPianoRoll`, `buildStaff`), with a separate overlay canvas for the playhead. Export is `.gbmusic.json` (settings) and Standard MIDI File (`midiBytes`, format 1, drums on MIDI channel 10).

See `docs/MUSIC_GENERATOR.md` for an end-user guide to every control.

### The tile reducer (`dist/gb-tile-reducer.html`)

A stateless single-file utility (no project file, no undo): load a PNG, quantize it to the four DMG shades (same luminance buckets as the editors' importers, alpha = lightest), slice into 8×8 tiles, and merge similar tiles so the image fits a tile budget. Mirrored tiles are deliberately NOT merged — DMG BG tiles can't be flipped, so counts stay honest for the target.

Two clusterers (`greedyCluster`, `agglomerativeCluster`) share the cluster bookkeeping (per-pixel shade histogram, hybrid rep = frequency-weighted per-pixel mode, always 0..3, no gray averaging). Greedy: single pass over unique tiles ordered by frequency; a tile joins the closest cluster within the weighted-SSD threshold or seeds a new one; "target count" mode binary-searches the smallest threshold that fits. Agglomerative: merge the globally cheapest pair repeatedly via nearest-neighbor arrays; O(n²), falls back to greedy above `AGGLO_MAX` (4096) unique tiles. User options in `state`: `repMode` (hybrid synthesized / most-used member / best-fit member), `freqWeight` (Ward factor n1·n2/(n1+n2) so frequent tiles resist merging), `edgeWeight` (border pixels ×2, normalized so thresholds stay comparable), and `refinePasses` (k-means-style reassignment, never grows the cluster count). The reduced PNG downloads at 1× in either bundled palette; both quantize back to the same values, so the file re-imports losslessly into the world/sprite editors.

### The pixelizer (`dist/gb-pixelizer.html`)

A stateless single-file utility that turns arbitrary images into small 2-bit pixel art. Pipeline: tone map (optional 1–99 percentile auto-levels, then brightness/contrast/gamma) → downscale → quantize to the four shades, with the order of the last two steps selectable (`state.order`; quantize-first is the default and scales in shade space, keeping hard 2-bit edges). Downscalers (`scaleArray` reducers, all operating per output-pixel source block so they work on luminance or shades alike): k-centroid (1D k-means per block, keep the dominant cluster's centroid — the pixel-art community standard), dominant value (block mode), box average, nearest sample. Quantization uses three adjustable shade boundaries (plus a "Balance shades" button: Otsu-style weighted 1D k-means over the histogram, thresholds at midpoints between the four cluster centers — robust to a dominant background brightness) and optional dithering: ordered Bayer 2×2/4×4/8×8 or Floyd–Steinberg, with a strength slider (dithering inflates unique-tile counts; the UI warns). The result shows a live unique-8×8-tile count against the 256 budget; the PNG downloads at 1× in either bundled palette and re-imports losslessly into the editors.

### Converter (`tools/gbworld_to_c.py`)

Reads `project.gbworld.json`, resolves `id`→index maps, and emits `world.h` / `world.c` for GBDK-2020. Warps are separated from other events because they drive movement; they get their own `warps` table per map. Sentinels: empty cell = `0xFF`, absent connection = `-1`, no string = `0xFFFF`.

### Visualizer (`tools/gbworld_visualize.py`)

Follows the same connection-offset convention as the converter (positive offset = right for N/S links, down for E/W links) to stitch connected maps into one PNG.

### The JSON format (`.gbworld.json`)

The JSON file is the single source of truth. The C should never be hand-edited — regenerate it whenever the JSON changes. See `docs/DEVELOPER_HANDOFF.md` for the full schema, generated C structures, and GBDK runtime integration snippets.

## Key constraints

- **Tile budget**: each tileset must stay ≤ 256 tiles (the DMG VRAM limit). Animated tiles each consume one reserved slot.
- **DMG compatibility**: layout must not rely on CGB attribute flips (H/V mirror). Mirror by drawing a separate tile instead.
- **8-bit index ceiling**: tile/metatile/block/map counts must stay ≤ 255 each; the converter warns when exceeded.
- **Cell order is always TL, TR, BL, BR** in every four-element array (metatile tiles, block metatiles, attribute arrays).
