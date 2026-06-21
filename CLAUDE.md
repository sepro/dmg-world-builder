# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the editor

The editor is a single static HTML file with no build step. Serve the repo root over HTTP and open it in a browser:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/gb-world-editor.html
```

Inside the devcontainer a static server starts automatically on port 5500 via VS Code Live Server.

## Tooling commands

```bash
# Convert an exported project to GBDK-2020 C
python3 tools/gbworld_to_c.py project.gbworld.json -o build/ --name world

# Render a stitched world PNG (3× upscale, with map labels)
python3 tools/gbworld_visualize.py project.gbworld.json -o world.png --scale 3
```

`gbworld_to_c.py` needs only the Python standard library. `gbworld_visualize.py` needs Pillow (`pip install pillow`; preinstalled in the devcontainer).

## Architecture

### The single-file editor (`gb-world-editor.html`)

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
