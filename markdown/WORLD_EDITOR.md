# World Editor — Guide

A browser-based authoring tool for Pokémon-style Game Boy worlds. It builds worlds
from a fixed hierarchy and exports a single `.gbworld.json` project file that the
tooling turns into GBDK-2020 C or a stitched overview PNG.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-world-editor.html> (see the main
[README](../README.md) for serving instructions).

## The coordinate hierarchy

Every field in the data is expressed in one of these units. Internalize the order —
it governs the whole format.

| Unit | Size | Made of | Cell order |
|------|------|---------|-----------|
| tile | 8×8 px | — | — |
| metatile | 16×16 px | 2×2 tiles | TL, TR, BL, BR |
| block | 32×32 px | 2×2 metatiles | TL, TR, BL, BR |
| map | W×H blocks | grid of blocks | row-major |

Every four-element array (metatile tiles, block metatiles, attribute arrays) is
always ordered **TL, TR, BL, BR**. Map size and `blockGrid` are in **blocks**.
Event/warp coordinates are in **metatile cells** (2× the block resolution per axis).

## Panels and workflow

The editor's left rail switches between panels; the typical bottom-up workflow is:

1. **Palettes** — define the DMG colour sets used by tiles.
2. **Tiles** — draw or import the 8×8 tiles. Each tileset has an editable VRAM
   budget (default 128 — engines reserve slots for font/UI and sprites; the
   absolute DMG limit is 256); animated tiles each reserve one slot.

   **Import PNG** slices any 2-bit sheet into 8×8 tiles (left-to-right,
   top-to-bottom) and deduplicates them. If the sheet is a laid-out tilemap, the
   import dialog can also assemble **metatiles** (each 2×2 tile block of the
   image) and **blocks** (each 2×2 metatile block) in the same pass, so a full
   scene comes in ready to paint. Generated metatiles use the first palette with
   walkable collision and normal behavior; identical metatiles/blocks are reused,
   and any that already exist in the tileset are shared rather than duplicated.
   Leftover odd rows/columns at the right/bottom edge are ignored.

   A project can hold **multiple tilesets** (each map picks one in its
   properties). The bar at the top of the Tiles, Metatiles, and Blocks panels
   switches the active tileset and can create, rename, or delete tilesets;
   deletion is blocked while any map still uses the tileset.
3. **Metatiles** — assemble 2×2 tiles into 16×16 metatiles. Besides collision
   (`walk | solid`) and behavior, a metatile can be flagged **Draw over player
   (overlay)**: its background art covers sprites standing on it (tree canopy,
   tall grass, archways). The flag is independent of collision — a canopy is
   solid + overlay, tall grass walk + overlay. An overlay picks a **coverage**
   mode: *Full sprite* hides everything standing on the tile (canopy,
   archway), *Bottom half (tall grass)* hides only the lower half of the
   sprite, so feet sink into the grass while the head stays visible. On DMG
   only shades 1–3 cover the sprite; the lightest shade always shows it
   through.
4. **Blocks** — assemble 2×2 metatiles into 32×32 blocks.
5. **Maps** — paint blocks onto maps, set edge connections between maps, pick a
   border block (drawn past unconnected edges), and place the events layer
   (spawn points, warps, signs, items, NPCs, triggers). A warp has a type
   (`transport | door | stairs | fall` — how the engine presents the transition),
   a destination map/cell, and a facing after the warp
   (`same | up | down | left | right`; `same` keeps the walking direction).

Painting tools, zoom, selection, and undo/redo (a single pointer stroke collapses
to one undo step) operate on the active panel.

## Persistence

There is no browser storage. **Export** saves the whole project as a
`.gbworld.json`; **Import** loads one back. The JSON file is the single source of
truth — the generated C should never be hand-edited; regenerate it whenever the
JSON changes.

The Maps panel also offers **Export world PNG**: every map is stitched into one
image using the edge connections (disconnected maps stack below with a one-block
gap), with a selectable 1–4× scale and optional map borders/name labels. It is
the in-browser equivalent of `tools/gbworld_visualize.py`.

## Key constraints

- **Tile budget**: keep each tileset within its editable budget (default 128,
  hard DMG ceiling 256; animated tiles each cost one slot).
- **DMG compatibility**: don't rely on CGB attribute flips (H/V mirror) — mirror by
  drawing a separate tile instead.
- **8-bit index ceiling**: tile / metatile / block / map counts each stay ≤ 255; the
  converter warns when exceeded.

## Tooling

Convert and visualize an exported project from the repo root:

```bash
# project JSON -> GBDK-2020 world.h / world.c
python3 tools/gbworld_to_c.py project.gbworld.json -o build/ --name world

# project JSON -> stitched world.png (3× upscale, with map labels)
python3 tools/gbworld_visualize.py project.gbworld.json -o world.png --scale 3
```

`gbworld_to_c.py` needs only the Python standard library; `gbworld_visualize.py`
needs Pillow (`pip install pillow`, preinstalled in the devcontainer).

## Going deeper

See [DEVELOPER_HANDOFF.md](DEVELOPER_HANDOFF.md) for the full JSON schema, the
generated C structures, and a GBDK-2020 runtime integration walkthrough (loading a
map, reconstructing blocks into the tilemap, tile animation, and the Pokémon-style
warp/behavior split).
