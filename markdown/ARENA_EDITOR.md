# Boss Arena Editor

The Boss Arena Editor creates one fixed Game Boy combat screen: 20×18 background
cells (160×144 pixels). Its terrain is semantic rather than tied to overworld
tiles, so the combat renderer can use completely different art.

## Terrain and annotations

- **Solid** — full collision geometry.
- **Platform** — one-way landing surface; a player can pass through from below.
- **Water** — a distinct water volume, normally used for a respawn/damage rule.
- **Hazard** — a separate damage/respawn volume.
- **Ladder** and **Decor** — semantic climbable/no-collision visual cells.
- **Player spawn**, **boss anchor**, checkpoint, and optional left/right exits.

The editor saves `.gbarena.json`; import and export are lossless. The `terrain`
array is row-major: index `y * 20 + x`. Marker coordinates are tile coordinates.
A runtime can map each semantic value to any combat art and collision behavior.

## Snapjaw Marsh preset

`public/arenas/snapjaw-marsh.gbarena.json` is the same preset that loads when
the editor opens or when **Load Snapjaw** is pressed. It was read from the ROM:

| ROM behavior | Arena data |
| --- | --- |
| Floor from 0–79px at y=128 | solid x=0–9, y=16–17 |
| Water from 80–159px | water x=10–19, y=16–17 |
| Middle ledge at y=96 | platform x=3–8, y=12 |
| Upper ledge at y=64 | platform x=6–7, y=8 |
| `cb_player_init(40)` | player spawn x=5, y=15 |
| Snapjaw visible at `(144,112)` | boss anchor x=18, y=14 |

This is a deliberately semantic handoff: it does not claim that the current
combat C code loads `.gbarena.json` at runtime. To wire an exported room into
GBDK, turn the row-major terrain into the collision/render table used by the
combat bank, then read the two marker positions for its initial player and boss
placement.
