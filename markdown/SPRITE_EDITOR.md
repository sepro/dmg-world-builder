# Sprite Editor — Guide

A browser-based tool for authoring Game Boy OBJs (hardware sprites): draw 8×8
tiles, arrange them into **metasprites**, and sequence metasprites into
**animations**. Projects save as `.gbsprite.json`; artwork exports as PNG that
round-trips losslessly back into the editor.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-sprite-editor.html> (see the main
[README](../README.md) for serving instructions).

## The hierarchy

| Level | What it is |
|-------|-----------|
| tile | one 8×8 (or, in 8×16 mode, half of an 8×16) hardware pattern |
| metasprite | a group of *parts* — hardware sprites placed at pixel offsets, each with H/V flip and a palette |
| animation | a sequence of frames, each `metasprite + duration` in 60 Hz ticks (60 = 1 second) |

The editor models the real DMG OBJ rules, so what you build here is what the
hardware can actually show:

- **OBJ size is global.** `OBJ size` in the top bar switches the whole project
  between 8×8 and 8×16 sprites (hardware LCDC bit 2 — sizes can't be mixed). In
  8×16 mode each part has a *top* and *bottom* tile. Switching modes converts
  every part losslessly.
- **Pixel value 0 is always transparent** on sprites. The editor draws it as a
  checkerboard.
- **Part order = OAM priority.** The first part in the list draws on top.
  *Raise* / *Lower* reorder parts.
- Sprites support **per-object H/V flip** (unlike DMG background tiles), so the
  editor reuses mirrored tiles for free wherever it can.

## Panels

The tab bar switches between four panels.

### Palettes

DMG sprite palettes (value 0 is fixed as transparent; values 1–3 map to
shades). One palette is the *editing* palette used to display tiles; each
metasprite part also picks its own palette.

### Tiles

The tile list plus an editing canvas. Tools: **pencil**, **fill**,
**eyedropper**, and **select** (drag a marquee, then drag inside it to move
those pixels; the source is left transparent). Ink swatches pick pixel values
0–3, with 0 (marked `T`) as the transparent eraser. **Delete unused** sweeps
tiles no metasprite references. The tile budget readout tracks the 256-slot
VRAM ceiling.

**Import PNG sheet** slices a PNG into tiles: alpha maps to value 0, or for
opaque sheets you pick which of the four shades becomes transparent (the rest
remap to 1–3). Optionally the sheet is also sliced into metasprites, one per
frame cell of a chosen frame size (multiples of 8 px). Imported tiles dedupe
against existing tiles under all four flip combinations. **Export PNG** writes
the tile sheet back out with value 0 transparent, at the same shade values the
importer uses, so a sheet re-imports losslessly.

### Metasprites

A 64×64 composer canvas with a center crosshair. Click a part to select it,
drag to move it (optionally with **Snap to 8px grid**). Per part: tile
assignment (top/bottom in 8×16 mode) via the tile picker, H/V flip, palette,
Raise/Lower (OAM priority), duplicate, delete. **Mirror H** flips the whole
metasprite horizontally in one click — parts swap sides and toggle their
`hFlip` flag, which is free on hardware. **Onion skin** ghosts the neighboring
animation frames (previous in orange, next in cyan) so poses line up.
**Export PNG** / **Export sheet PNG** rasterize one or all metasprites.

### Animations

Frame strips per animation: each frame references a metasprite and a duration
in ticks (the badge shows ticks; 60 ticks = 1 s). A live preview plays the
animation with **Loop**, and frames can be reordered, duplicated, and deleted.

**Draw on frame** is the free-form workflow: it rasterizes a frame's
metasprite into a flat 64×64 bitmap you can paint on directly (with onion
skinning), then **Bake to frame** recompiles the drawing back into tiles and
parts. The bake searches grid alignments, matches each cell against existing
tiles under all four flips, and picks the alignment that needs the fewest new
tiles. Baking only ever *adds* tiles (never edits shared ones) and rebuilds
the metasprite in place only if no other frame uses it — clean up afterwards
with *Delete unused* in the Tiles tab.

## Persistence

No browser storage. **Export** downloads (or copies) the project as a
`.gbsprite.json` (`formatVersion 1`); **Import** loads a file or pasted JSON.
Importing a `.gbworld.json` world file is rejected — the two formats are
deliberately separate.

## Key constraints

- **Tile budget**: ≤ 256 OBJ tile slots (shared with BG tiles in a real game —
  budget accordingly).
- **10 sprites per scanline / 40 per screen** on hardware: the editor doesn't
  enforce this, but keep metasprites narrow where it matters.
- **One OBJ size per project** (8×8 or 8×16), matching the hardware's global
  LCDC flag.
