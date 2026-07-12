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
3. **Metatiles** — assemble 2×2 tiles into 16×16 metatiles.
4. **Blocks** — assemble 2×2 metatiles into 32×32 blocks.
5. **Maps** — paint blocks onto maps, set edge connections between maps, pick a
   border block (drawn past unconnected edges), and place the events layer
   (spawn points, warps, signs, items, NPCs, triggers).

Painting tools, zoom, selection, and undo/redo (a single pointer stroke collapses
to one undo step) operate on the active panel.

## Persistence

There is no browser storage. **Export** saves the whole project as a
`.gbworld.json`; **Import** loads one back. The JSON file is the single source of
truth — the generated C should never be hand-edited; regenerate it whenever the
JSON changes.

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
