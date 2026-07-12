# GB World Editor — Developer Handoff

This document describes the data the editor produces, the C the converter emits, and
how to wire that C into a GBDK-2020 project. It is the reference for anyone building
the runtime engine or extending the toolchain.

## 1. The pipeline at a glance

```
dist/gb-world-editor.html ──►  project.gbworld.json   ──►  gbworld_to_c.py   ──►  world.h / world.c
   (authoring UI)            (the single source           (build-time             (ROM data,
                              of truth, exported)          generator)              reconstructed at runtime)

                            project.gbworld.json   ──►  gbworld_visualize.py  ──►  world.png
                                                         (stitched overview)
```

The editor is a single static HTML file. It holds the whole project in memory and
saves/loads it as one JSON file (there is no server-side state). Everything
downstream consumes that JSON.

### Files

| File | Role |
|------|------|
| `dist/gb-world-editor.html` | The authoring tool. Serve over HTTP and open in a browser. |
| `tools/gbworld_to_c.py` | Converts a `.gbworld.json` into a GBDK header/source pair. Standard library only. |
| `tools/gbworld_visualize.py` | Renders the whole world (all connected maps) to one PNG. Needs Pillow. |

### Running the tooling (inside the devcontainer)

The container starts a static server automatically. Open
`http://localhost:8000/docs/gb-world-editor.html`. Then:

```bash
# Generate C from an exported project
python3 tools/gbworld_to_c.py project.gbworld.json -o build/ --name world

# Render the whole world to a PNG (3x upscaled, with map labels)
python3 tools/gbworld_visualize.py project.gbworld.json -o world.png --scale 3
```

---

## 2. The JSON format

### 2.1 Coordinate hierarchy

Everything is built from one fixed hierarchy. Internalize these units; almost every
field below is expressed in one of them.

| Unit | Size | Composition |
|------|------|-------------|
| **tile** | 8×8 px | the raw Game Boy tile, 2 bits per pixel (4 shades) |
| **metatile** | 16×16 px | 2×2 tiles; also the movement grid cell the player stands on |
| **block** | 32×32 px | 2×2 metatiles (= 4×4 tiles); the unit maps are painted with |
| **map** | W×H blocks | a grid of block references |

All four-element cell arrays use the order **TL, TR, BL, BR** (top-left, top-right,
bottom-left, bottom-right).

### 2.2 Identifiers vs. indices

Within the JSON, every tile, metatile, block, map and palette has a stable integer
`id` (handed out by the project's `nextId` counter). **References are always by
`id`**, so reordering or deleting never silently corrupts other references.

The **array position** of each object becomes its **index** in the generated C
(tile 0, tile 1, …). The converter builds the id→index maps; the runtime only ever
sees indices.

### 2.3 Top-level shape

```jsonc
{
  "formatVersion": 1,
  "meta": { "name": "My World", "target": "GBC, DMG-compatible", "tileSize": 8 },
  "nextId": 137,
  "behaviors": ["normal", "tall_grass", "water", "...", "door", "counter"],
  "_displayPaletteId": 1,            // editor-only: which palette the tile editor renders with
  "palettes":  [ /* Palette */ ],
  "tilesets":  [ /* Tileset */ ],
  "maps":      [ /* Map */ ]
}
```

`behaviors` is an editable, ordered list; a metatile's `behavior` field is one of
these strings, and its **position in this array is its enum value** in C.

### 2.4 Palette

```jsonc
{ "id": 1, "name": "GB Green", "colors": ["#e0f8d0", "#88c070", "#346856", "#081820"] }
```

Four hex colors, one per pixel value 0–3. On GBC these become real colors; on DMG
they are ignored and pixel values 0–3 map to the four hardware shades. The target is
DMG-compatible-on-GBC: **layout never depends on color or on attribute flips**, so a
map looks identical on both, color is purely additive on GBC.

### 2.5 Tileset

```jsonc
{
  "id": 10, "name": "main", "tileBudget": 128,
  "tiles":     [ /* Tile */ ],
  "metatiles": [ /* Metatile */ ],
  "blocks":    [ /* Block */ ]
}
```

`tileBudget` is the number of VRAM tile slots the target engine can give the world
tileset (editable in the Tiles tab). The absolute DMG BG limit is 256, but engines
usually reserve slots for font/UI and sprites, so new projects default to 128.
Each map references exactly one tileset; a connection between maps with **different**
tilesets implies a VRAM reload at the seam.

#### Tile

```jsonc
{
  "id": 21, "name": "water",
  "pixels": [ /* 64 ints, 0..3, row-major */ ],   // this is frame 0
  "frames": [ [ /* 64 ints */ ], [ /* 64 ints */ ] ],  // optional extra frames
  "frameRate": 14                                  // optional: 60Hz ticks per frame
}
```

`pixels` is the base image and animation frame 0. `frames` holds any **additional**
frames; the full cycle is `[pixels] + frames`. A tile is animated iff it has at least
one extra frame. `frameRate` is how many 1/60s ticks each frame is shown.

#### Metatile

```jsonc
{
  "id": 40, "name": "water",
  "tiles":        [21, 21, 21, 21],   // tile ids (TL,TR,BL,BR), or null = empty
  "cellPalettes": [1, 1, 1, 1],       // palette id per cell (GBC); DMG ignores
  "collision":    "solid",            // "walk" | "solid"
  "behavior":     "water"             // one of project.behaviors
}
```

Collision and behavior are properties of the metatile **type**, shared by every cell
that uses it. This is why a warp's destination cannot live here (see §4.4).

#### Block

```jsonc
{ "id": 70, "name": "pond", "metatiles": [40, 40, 40, 40] }  // metatile ids, or null
```

### 2.6 Map

```jsonc
{
  "id": 90, "name": "demo map", "tilesetId": 10,
  "width": 16, "height": 16,                 // in blocks
  "blockGrid": [ /* width*height block ids, row-major; null = empty */ ],
  "connections": {
    "north": null,
    "south": null,
    "east":  { "mapId": 91, "offset": 0 },
    "west":  null
  },
  "borderBlock": 70,       // block id drawn past unconnected edges (Pokemon-style
                           // repeating border); null = engine repeats edge metatiles
  "events": [ /* Event */ ]
}
```

**Connection convention** (the converter and visualizer both follow this; commit to
it in the engine): a connection `A.<dir> = { mapId, offset }` places the neighbor on
that side and shifts it along the shared edge. Positive `offset` moves the neighbor
**right** for north/south links and **down** for east/west links, measured in blocks.

### 2.7 Events

Events live on a map at **metatile coordinates** (`x` in `[0, width*2)`, `y` in
`[0, height*2)`). Each has a stable `id` and a `type`:

```jsonc
{ "id": 101, "type": "warp",    "x": 8, "y": 6, "toMap": 91, "toX": 0, "toY": 6, "warpType": "door", "facing": "up" }
{ "id": 102, "type": "sign",    "x": 3, "y": 3, "text": "Welcome!" }
{ "id": 103, "type": "item",    "x": 5, "y": 9, "item": "potion", "qty": 1, "flag": "got_potion" }
{ "id": 104, "type": "npc",     "x": 7, "y": 4, "sprite": "oldman", "movement": "static", "script": "intro" }
{ "id": 105, "type": "trigger", "x": 2, "y": 2, "script": "on_enter" }
{ "id": 106, "type": "spawn",   "x": 4, "y": 4, "facing": "up", "isDefault": true }
```

`toMap` is a map id (or `null`). A warp's `warpType` is one of
`transport | door | stairs | fall` (how the engine presents the transition) and its
`facing` is the direction the player looks after arriving:
`same | up | down | left | right`, where `same` keeps the direction the player
walked in with. Files that predate these fields import as `transport` / `same`.
`movement` is one of `static | wander | walk_up_down | walk_left_right`. The string
fields (`text`, `item`, `sprite`, `script`, `flag`) are free-form ids your engine
resolves.

Spawn events are not emitted into the runtime event table: the converter picks the
spawn flagged `isDefault` (falling back to the first spawn found, then to the center
of map 0 with a warning) and emits it as the `<NAME>_SPAWN_MAP/_X/_Y/_DIR` constants
used when starting a new game. `facing` is one of `up | down | left | right`.

---

## 3. The generated C

`gbworld_to_c.py` writes `world.h` (declarations, structs, enums) and `world.c`
(data). The output keeps the full hierarchy so a large world stays small in ROM and
is reconstructed at runtime, rather than baking a flat tilemap.

### 3.1 Structures (in `world.h`)

```c
typedef struct {
    UINT8 tiles[4];      // tile indices: TL, TR, BL, BR
    UINT8 attrs[4];      // CGB BG attribute per cell (palette 0-7); ignored on DMG
    UINT8 collision;     // COLLISION_WALK / COLLISION_SOLID
    UINT8 behavior;      // BEHAVIOR_*
} Metatile;

typedef struct { UINT8 metatiles[4]; } Block;   // metatile indices: TL,TR,BL,BR

typedef struct {
    UINT8 tile;          // base tile index = the VRAM slot to overwrite
    UINT8 num_frames;    // includes the base frame
    UINT8 rate;          // ticks (1/60s) per frame
    const UINT8 *frames; // num_frames * 16 bytes; frame 0 == the base tile
} TileAnim;

typedef struct {
    const UINT8 *tiles;        UINT16 num_tiles;    // 2bpp, 16 bytes/tile
    const Metatile *metatiles; UINT16 num_metatiles;
    const Block *blocks;       UINT16 num_blocks;
    const TileAnim *anims;     UINT8  num_anims;
} Tileset;

typedef struct {
    UINT8 x, y, to_map, to_x, to_y;   // to_map 0xFF = unset
    UINT8 type;                       // WARP_TRANSPORT / WARP_DOOR / WARP_STAIRS / WARP_FALL
    UINT8 facing;                     // DIR_* after the warp, WARP_FACE_SAME (0xFF) keeps it
} Warp;

typedef struct {
    UINT8 type;          // EVENT_SIGN / EVENT_ITEM / EVENT_NPC / EVENT_TRIGGER
    UINT8 x, y;          // metatile coordinates
    UINT8 p0, p1;        // numeric params (item qty, npc movement, ...)
    UINT16 s0, s1;       // string-table indices, 0xFFFF = none
} Event;

typedef struct {
    UINT8 width, height;       // in blocks
    UINT8 tileset;             // index into world_tilesets
    const UINT8 *blocks;       // width*height block indices, 0xFF = empty
    INT8  conn[4];             // neighbor map index per DIR_*, -1 if none
    INT16 conn_off[4];         // connection offset (blocks)
    UINT8 border_block;        // block drawn past unconnected edges, 0xFF = repeat edge
    UINT8 num_warps;  const Warp *warps;
    UINT8 num_events; const Event *events;
    const char *name;
} Map;
```

### 3.2 Top-level data (in `world.c`)

```c
extern const UINT16  world_palettes[WORLD_NUM_PALETTES * 4];  // RGB555, 4 per palette
extern const Tileset world_tilesets[WORLD_NUM_TILESETS];
extern const Map     world_maps[WORLD_NUM_MAPS];
extern const char * const world_strings[WORLD_NUM_STRINGS];   // event text, by index
```

Enums are emitted for behaviors (`BEHAVIOR_*`, in project order), event types
(`EVENT_*`), NPC movement (`MOVE_*`), collision (`COLLISION_*`), directions
(`DIR_NORTH/SOUTH/EAST/WEST = 0/1/2/3`), and readable `MAP_*` / `TILESET_*` indices.

### 3.3 Sentinels

| Meaning | Value |
|---------|-------|
| empty cell in a block grid | `0xFF` |
| absent neighbor (`conn[d]`) | `-1` |
| unset warp destination (`to_map`) | `0xFF` |
| keep facing after a warp (`facing`) | `WARP_FACE_SAME` (`0xFF`) |
| no string (`s0`/`s1`) | `0xFFFF` |

Empty metatile/tile cells are emitted as index `0` (the conventional blank tile); the
converter prints a warning counting them.

### 3.4 Event field usage

| Type | p0 | s0 | s1 |
|------|----|----|----|
| SIGN | — | text | — |
| ITEM | quantity | item id | flag id |
| NPC | `MOVE_*` | sprite id | script id |
| TRIGGER | — | script id | — |

Warps are **not** in the `events` array; they are in the dedicated `warps` table per
map, because they drive movement and connectivity.

---

## 4. Integrating into a GBDK-2020 project

Add `world.h` / `world.c` to your sources and `#include "world.h"`. The snippets
below are a reference for the reconstruction the runtime must do, not a finished
engine. They assume GBC; on DMG the attribute writes are simply skipped by hardware.

### 4.1 Loading a map

```c
#include <gbdk/platform.h>
#include "world.h"

static const Map     *cur_map;
static const Tileset *cur_ts;

void load_map(UINT8 map_index) {
    cur_map = &world_maps[map_index];
    cur_ts  = &world_tilesets[cur_map->tileset];

    set_bkg_palette(0, WORLD_NUM_PALETTES, world_palettes);  // GBC color (no-op on DMG)
    set_bkg_data(0, cur_ts->num_tiles, cur_ts->tiles);       // tile patterns into VRAM

    // then draw the visible window by reconstructing blocks (see 4.2)
}
```

### 4.2 Reconstructing a block into tiles

A block is 4×4 tiles: 2×2 metatiles, each 2×2 tiles. This expands one block into a
16-entry tile buffer (and a matching attribute buffer) and writes it at tile coords.

```c
static const UINT8 QOFF_X[4] = {0,2,0,2};   // metatile quadrant offset, in tiles
static const UINT8 QOFF_Y[4] = {0,0,2,2};
static const UINT8 COFF_X[4] = {0,1,0,1};   // tile cell offset within a metatile
static const UINT8 COFF_Y[4] = {0,0,1,1};

void draw_block(UINT8 block_index, UINT8 tx, UINT8 ty) {
    if (block_index == 0xFF) return;                 // empty cell
    const Block *blk = &cur_ts->blocks[block_index];
    UINT8 tiles[16], attrs[16];
    for (UINT8 q = 0; q < 4; q++) {
        const Metatile *m = &cur_ts->metatiles[blk->metatiles[q]];
        for (UINT8 c = 0; c < 4; c++) {
            UINT8 idx = (QOFF_Y[q] + COFF_Y[c]) * 4 + (QOFF_X[q] + COFF_X[c]);
            tiles[idx] = m->tiles[c];
            attrs[idx] = m->attrs[c];
        }
    }
    set_bkg_tiles(tx, ty, 4, 4, tiles);
    set_bkg_attributes(tx, ty, 4, 4, attrs);          // GBC; omit/guard on DMG
}
```

To paint a whole map (small maps) or the visible window plus a margin (large maps),
loop over `cur_map->blocks[by * cur_map->width + bx]` and call `draw_block` at
`(bx*4, by*4)`. For a large world you stream: as the camera scrolls past a 32px
boundary, reconstruct the newly exposed column/row of blocks into the off-screen
edge of the 32×32 tile background, exactly as Pokémon does.

### 4.3 Tile animation

Each animated tile occupies one reserved VRAM slot (its base tile index); animating
it is just copying the current frame's 16 bytes into that slot. Drive it from the
VBL interrupt or a per-frame tick.

```c
static UINT8 anim_timer[ /* >= cur_ts->num_anims */ 16];
static UINT8 anim_frame[16];

void update_animations(void) {        // call once per frame
    for (UINT8 i = 0; i < cur_ts->num_anims; i++) {
        const TileAnim *a = &cur_ts->anims[i];
        if (++anim_timer[i] >= a->rate) {
            anim_timer[i] = 0;
            if (++anim_frame[i] >= a->num_frames) anim_frame[i] = 0;
            set_bkg_data(a->tile, 1, a->frames + anim_frame[i] * 16);  // swap the slot
        }
    }
}
```

Reset `anim_timer`/`anim_frame` to 0 in `load_map`. Because the tilemap never
changes, one animated water tile animates everywhere it appears at no extra cost.

### 4.4 Warps and behaviors (the Pokémon-style split)

The metatile `behavior` answers **"is this warp-capable and how is it entered"**
(`BEHAVIOR_WARP` triggers on step, `BEHAVIOR_DOOR` on walking up into it, etc.). The
`warps` table answers **"to where."** Resolve a step like this:

```c
const Metatile *metatile_at(UINT8 mx, UINT8 my) {     // mx,my in metatile cells
    UINT8 block = cur_map->blocks[(my >> 1) * cur_map->width + (mx >> 1)];
    if (block == 0xFF) return 0;
    const Block *blk = &cur_ts->blocks[block];
    UINT8 q = (my & 1) * 2 + (mx & 1);                 // quadrant TL,TR,BL,BR
    return &cur_ts->metatiles[blk->metatiles[q]];
}

const Warp *warp_at(UINT8 mx, UINT8 my) {
    for (UINT8 i = 0; i < cur_map->num_warps; i++)
        if (cur_map->warps[i].x == mx && cur_map->warps[i].y == my)
            return &cur_map->warps[i];
    return 0;
}

// On finishing a step onto (mx,my):
const Metatile *m = metatile_at(mx, my);
if (m && (m->behavior == BEHAVIOR_WARP || m->behavior == BEHAVIOR_DOOR)) {
    const Warp *w = warp_at(mx, my);
    if (w && w->to_map != 0xFF) {
        // (play a door animation if behavior == BEHAVIOR_DOOR)
        load_map(w->to_map);
        place_player(w->to_x, w->to_y);
    }
}
```

Use the same `metatile_at` for collision: block a move if `m->collision == COLLISION_SOLID`.

### 4.5 Connections (seamless scrolling)

`conn[DIR_*]` gives the neighbor map index (or `-1`), and `conn_off[DIR_*]` the offset
in blocks along the shared edge (per §2.6). For seamless overworld scrolling, when the
camera approaches an edge, stream blocks from the neighbor map into the background
using the offset to align rows/columns. If the neighbor uses a different tileset you
must reload tile data, so a transition (fade or doorway) usually masks that seam.

### 4.6 Events

Non-warp events are in `cur_map->events`. Look them up by `(x, y)` the same way as
warps, read `type`, and resolve string ids through `world_strings[s0]` (skip if
`0xFFFF`). What `sign`/`item`/`npc`/`trigger` actually do is your engine's domain;
the data layer only carries the parameters.

---

## 5. Conventions and gotchas

- **Cell order is always TL, TR, BL, BR**, in metatile tiles, block metatiles, and
  the attribute array.
- **Coordinates differ by layer**: map size and `blockGrid` are in *blocks*; event and
  warp coordinates are in *metatile cells* (twice the resolution per axis).
- **Connection offset sign**: positive = right (N/S) or down (E/W). If your engine's
  mental model is the opposite, flip the sign in one place; the two Python tools agree
  with each other, which is what matters for round-tripping.
- **DMG compatibility**: don't introduce attribute-based H/V flips into layout; they
  render on GBC but not DMG. Mirror a tile by drawing it as its own tile instead.
- **Tile budget**: keep each tileset within its `tileBudget` (the editor warns past
  it; the budget is editable in the Tiles tab, hard ceiling 256). Animated tiles each
  consume one reserved slot.
- **8-bit index fields**: the C uses 8-bit indices for tiles/metatiles/blocks and map
  indices. The converter warns if a tileset exceeds 255 metatiles/blocks or the project
  exceeds 255 maps; that is a generous ceiling for GB-scale content but is a real limit.
- **The JSON is the source of truth.** Regenerate the C whenever it changes; never
  hand-edit `world.c`.

## 6. Not yet implemented (roadmap)

- **Conditional tiles / map patches** (doors open/closed, a ship that is present or
  not): planned as flag-conditioned rectangular patches applied at map load, the same
  mechanism for a 1×2 door and a large docked ship.
- **Warp lint** in the editor: flag warp events whose metatile isn't warp-capable, and
  warp/door metatiles placed with no event on them.
- **Virtualized map canvas** in the editor for very large maps (currently one canvas).
