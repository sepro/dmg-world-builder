# Boss Arena Editor

The Boss Arena Editor builds one fixed Game Boy combat screen: 20×18
background cells (160×144 pixels). It deliberately does **not** use overworld
metatiles or blocks. Each arena owns its tile art and a separate gameplay layer.

## Tile art layer

The tile library and 8×8 pixel editor work like the World Editor's tile panel:
select a tile, edit its four DMG pixel values, then paint it onto the arena map.
New, duplicate, and delete controls let each boss arena own only the art it
needs.

Each tile can have additional animation frames. The frame strip selects the
frame to edit; **+** duplicates the current frame. Set the frame rate in 60 Hz
ticks, and use the map toolbar's **Animation: playing/paused** toggle to preview
live water, flames, or other animated environment tiles in the editor.

## Undo and redo

The top bar has **Undo** and **Redo** controls, with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` shortcuts. History keeps the last 60 arena-project snapshots. A map or pixel drag is one undo step, while tile creation, frame changes, overlay/marker placement, preset loads, and property edits are individually reversible.

## Gameplay overlay layer

The art map is separate from gameplay annotations. Turn on **Gameplay overlays**
in the map toolbar to see and paint semantic cells without hiding the authored
art:

- **Solid** — full collision geometry.
- **Platform** — one-way landing surface.
- **Water** — a distinct water volume, normally a respawn/damage rule.
- **Hazard**, **Ladder**, and **Decor** — independent damage, climbable, and
  art-only annotations.
- Player spawn, boss anchor, checkpoint, and optional left/right exits are
  independent markers.

With overlays visible, pointer painting changes the selected overlay. With them
hidden, pointer painting changes tile art. This makes it safe to refine visuals
without accidentally replacing collision. Press `O` to toggle the overlay view
and Space to pause/play animation.

## File format and Snapjaw

`.gbarena.json` version 2 stores `tiles` (8×8 pixels plus optional `frames`), a
row-major `map` tile-ID layer, a row-major `overlays` layer, markers, and notes.
Version 1 semantic-only projects import automatically and are upgraded with a
starter art set.

`public/arenas/snapjaw-marsh.gbarena.json` is the same animated preset that
loads when the editor opens or when **Load Snapjaw** is pressed. It matches the
ROM's arena geometry:

| ROM behavior | Arena data |
| --- | --- |
| Floor from 0–79px at y=128 | stone + solid x=0–9, y=16–17 |
| Water from 80–159px | animated water x=10–19, y=16–17 |
| Middle ledge at y=96 | ledge + platform x=3–8, y=12 |
| Upper ledge at y=64 | ledge + platform x=6–7, y=8 |
| `cb_player_init(40)` | player spawn x=5, y=15 |
| Snapjaw visible at `(144,112)` | boss anchor x=18, y=14 |

The export is an authoring handoff. Current combat C does not yet load JSON at
runtime; use the tile map for rendering and the overlay/marker layers for the
combat-bank data when wiring a finished arena into the ROM.
