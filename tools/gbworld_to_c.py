#!/usr/bin/env python3
"""
gbworld_to_c.py - convert a GB World Editor project (.gbworld.json) into GBDK C.

It emits a header/source pair describing the whole world so it can live in a ROM
and be reconstructed at runtime (the Pokemon-style hierarchy: tile -> metatile ->
block -> map). The generated data keeps the full hierarchy rather than baking a
flat tilemap, which is what makes a large world affordable.

What gets emitted
-----------------
- GBC background palettes (RGB555).
- Per tileset: tile data (2bpp GB format), animation frame data + a small anim
  table, the metatile table (4 tile indices + 4 CGB palette attributes +
  collision + behavior) and the block table (4 metatile indices).
- Per map: width/height in blocks, the block-index grid, edge connections with
  offsets, a border block (drawn past unconnected edges; 0xFF = repeat edge),
  a warp table, and a generic event table (signs/items/npcs/triggers).
- The default player spawn point (a "spawn" event with isDefault) as
  <NAME>_SPAWN_MAP/_X/_Y/_DIR constants, used when starting a new game.
- Enums for behaviors, event types and NPC movement, plus index enums for maps
  and tilesets, and a string table for event text fields.

Coordinate / connection conventions (documented so the runtime and the
visualizer agree):
- Block = 32 px = 2x2 metatiles. Metatile = 16 px = 2x2 tiles. Tile = 8 px.
- Map dimensions are in blocks; blockGrid is row-major.
- Event coordinates are in metatile cells (the 16 px grid the player moves on).
- A connection A.<dir> = {neighbor, offset} shifts the neighbor along the shared
  edge: positive offset moves it right (north/south) or down (east/west).

Usage:
    python3 gbworld_to_c.py world.gbworld.json -o build/ --name world

Pure standard library, no dependencies.
"""

import argparse
import json
import os
import re
import sys


# ----------------------------------------------------------------------------
# Low-level conversions
# ----------------------------------------------------------------------------

def tile_to_2bpp(pixels):
    """Convert 64 pixel values (0..3) into 16 bytes of Game Boy 2bpp data.

    Each row is two bytes: the low bitplane then the high bitplane, MSB = leftmost
    pixel. This is the format set_bkg_data expects.
    """
    out = []
    for row in range(8):
        lo = hi = 0
        for col in range(8):
            v = pixels[row * 8 + col] & 3
            bit = 7 - col
            lo |= (v & 1) << bit
            hi |= ((v >> 1) & 1) << bit
        out.append(lo)
        out.append(hi)
    return out


def hex_to_rgb555(hexstr):
    """Convert '#rrggbb' to a 15-bit GBC color (5 bits per channel, BGR packed)."""
    h = hexstr.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)


def ident(name, fallback):
    """Sanitize a name into a C identifier fragment."""
    s = re.sub(r"[^0-9a-zA-Z]+", "_", str(name or "")).strip("_").upper()
    return s or fallback


# Fixed enum mappings that do not come from the project.
EVENT_TYPE_VALUES = {"warp": 0, "sign": 1, "item": 2, "npc": 3, "trigger": 4}
SPAWN_DIR_MACROS = {"up": "DIR_NORTH", "down": "DIR_SOUTH",
                    "left": "DIR_WEST", "right": "DIR_EAST"}
WARP_TYPE_MACROS = {"transport": "WARP_TRANSPORT", "door": "WARP_DOOR",
                    "stairs": "WARP_STAIRS", "fall": "WARP_FALL"}
NPC_MOVE_VALUES = {"static": 0, "wander": 1, "walk_up_down": 2, "walk_left_right": 3}
COLLISION_VALUES = {"walk": 0, "solid": 1}
COLLISION_OVERLAY_BIT = 2   # "draw over player": ORed into the collision byte
DIRS = ["north", "south", "east", "west"]
NO_BLOCK = 0xFF      # empty cell sentinel in a block grid
NO_MAP = -1          # absent neighbor
NO_STRING = 0xFFFF   # absent string


class Builder:
    def __init__(self, project, prefix):
        self.p = project
        self.prefix = prefix
        self.warnings = []
        # Index lookups.
        self.map_index = {m["id"]: i for i, m in enumerate(project["maps"])}
        self.tileset_index = {t["id"]: i for i, t in enumerate(project["tilesets"])}
        self.palette_index = {pal["id"]: i for i, pal in enumerate(project["palettes"])}
        # Per-tileset id->index maps for tiles/metatiles/blocks.
        self.tile_index = {}
        self.metatile_index = {}
        self.block_index = {}
        for ts in project["tilesets"]:
            self.tile_index[ts["id"]] = {t["id"]: i for i, t in enumerate(ts["tiles"])}
            self.metatile_index[ts["id"]] = {m["id"]: i for i, m in enumerate(ts["metatiles"])}
            self.block_index[ts["id"]] = {b["id"]: i for i, b in enumerate(ts["blocks"])}
        # String table for event text fields.
        self.strings = []
        self.string_lookup = {}
        if len(project["palettes"]) > 8:
            self.warnings.append("More than 8 palettes; GBC supports 8 background palettes. "
                                 "Cell palette attributes above 7 will be clamped.")

    def warn(self, msg):
        # Deduplicated: the header is generated twice (string count fixup).
        if msg not in self.warnings:
            self.warnings.append(msg)

    def intern_string(self, s):
        if not s:
            return NO_STRING
        if s not in self.string_lookup:
            self.string_lookup[s] = len(self.strings)
            self.strings.append(s)
        return self.string_lookup[s]

    # -- behavior enum (from the project's editable list) -------------------
    def behavior_value(self, behavior):
        behaviors = self.p.get("behaviors", [])
        return behaviors.index(behavior) if behavior in behaviors else 0

    def behavior_enum_names(self):
        names, seen = [], set()
        for b in self.p.get("behaviors", []):
            base = "BEHAVIOR_" + ident(b, "UNNAMED")
            name = base
            n = 1
            while name in seen:
                name = base + "_" + str(n)
                n += 1
            seen.add(name)
            names.append(name)
        return names


# ----------------------------------------------------------------------------
# C formatting helpers
# ----------------------------------------------------------------------------

def c_byte_array(values, per_line=16, indent="  "):
    lines, row = [], []
    for i, v in enumerate(values):
        row.append(str(v) + "U")
        if len(row) == per_line:
            lines.append(indent + ", ".join(row) + ",")
            row = []
    if row:
        lines.append(indent + ", ".join(row) + ",")
    return "\n".join(lines) if lines else indent + "/* (empty) */"


def c_word_array(values, per_line=8, indent="  "):
    lines, row = [], []
    for v in values:
        row.append("0x%04X" % v)
        if len(row) == per_line:
            lines.append(indent + ", ".join(row) + ",")
            row = []
    if row:
        lines.append(indent + ", ".join(row) + ",")
    return "\n".join(lines) if lines else indent + "/* (empty) */"


def c_string_literal(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def find_default_spawn(b):
    """Pick the world's default spawn point: (map_index, x, y, dir_macro).

    Prefers the spawn event flagged isDefault; falls back to the first spawn
    found, then (with a warning) to map 0's center facing south.
    """
    spawns = []
    for mi, m in enumerate(b.p["maps"]):
        for e in m.get("events", []):
            if e.get("type") == "spawn":
                spawns.append((mi, e))
    chosen = None
    defaults = [s for s in spawns if s[1].get("isDefault")]
    if len(defaults) > 1:
        b.warn("Multiple default spawn points; using the first one.")
    if defaults:
        chosen = defaults[0]
    elif spawns:
        b.warn("No spawn point flagged as default; using the first spawn found.")
        chosen = spawns[0]
    if chosen is None:
        b.warn("No spawn point in the world; defaulting to the center of map 0.")
        m0 = b.p["maps"][0]
        # width/height are in blocks == the center cell's metatile coords.
        return 0, m0["width"], m0["height"], "DIR_SOUTH"
    mi, e = chosen
    facing = e.get("facing", "down")
    if facing not in SPAWN_DIR_MACROS:
        b.warn("Spawn facing '%s' is unknown; using down." % facing)
    return mi, e["x"], e["y"], SPAWN_DIR_MACROS.get(facing, "DIR_SOUTH")


# ----------------------------------------------------------------------------
# Header generation
# ----------------------------------------------------------------------------

def generate_header(b, name, bank=None):
    p = b.p
    guard = ident(name, "WORLD") + "_H"
    L = []
    L.append("/* Generated by gbworld_to_c.py from \"%s\". Do not edit by hand. */"
             % p.get("meta", {}).get("name", "world"))
    L.append("#ifndef " + guard)
    L.append("#define " + guard)
    L.append("")
    L.append("#include <gbdk/platform.h>   /* UINT8, INT8, UINT16, INT16 */")
    L.append("")
    if bank is not None:
        L.append("BANKREF_EXTERN(%s)" % name)
        L.append("")

    # Counts.
    L.append("#define %s_NUM_TILESETS %d" % (name.upper(), len(p["tilesets"])))
    L.append("#define %s_NUM_MAPS %d" % (name.upper(), len(p["maps"])))
    L.append("#define %s_NUM_PALETTES %d" % (name.upper(), len(p["palettes"])))
    L.append("#define %s_NUM_STRINGS %d" % (name.upper(), len(b.strings)))
    L.append("")

    # Behavior enum.
    names = b.behavior_enum_names()
    if names:
        L.append("/* Metatile behaviors (from the project's behavior list). */")
        L.append("enum {")
        for i, n in enumerate(names):
            L.append("  %s = %d," % (n, i))
        L.append("};")
        L.append("")

    # Event type + movement enums.
    L.append("enum { EVENT_WARP = 0, EVENT_SIGN = 1, EVENT_ITEM = 2, EVENT_NPC = 3, EVENT_TRIGGER = 4 };")
    L.append("enum { MOVE_STATIC = 0, MOVE_WANDER = 1, MOVE_WALK_UP_DOWN = 2, MOVE_WALK_LEFT_RIGHT = 3 };")
    L.append("/* Metatile.collision is a bitfield: bit 0 = solid, bit 1 = overlay")
    L.append("   (BG art drawn over the player -- canopy, tall grass, archways). */")
    L.append("enum { COLLISION_WALK = 0, COLLISION_SOLID = 1, COLLISION_OVERLAY = 2 };")
    L.append("#define DIR_NORTH 0\n#define DIR_SOUTH 1\n#define DIR_EAST 2\n#define DIR_WEST 3")
    L.append("")
    L.append("/* Warp presentation (Warp.type) and post-warp facing (Warp.facing). */")
    L.append("enum { WARP_TRANSPORT = 0, WARP_DOOR = 1, WARP_STAIRS = 2, WARP_FALL = 3 };")
    L.append("#define WARP_FACE_SAME 0xFF  /* keep the facing the player warped in with */")
    L.append("")

    # Default spawn point (new game start).
    sp_map, sp_x, sp_y, sp_dir = find_default_spawn(b)
    L.append("/* Default player spawn point, used when starting a new game. */")
    L.append("#define %s_SPAWN_MAP %d  /* %s */"
             % (name.upper(), sp_map, p["maps"][sp_map]["name"]))
    L.append("#define %s_SPAWN_X %d" % (name.upper(), sp_x))
    L.append("#define %s_SPAWN_Y %d" % (name.upper(), sp_y))
    L.append("#define %s_SPAWN_DIR %s" % (name.upper(), sp_dir))
    L.append("")

    # Map and tileset index enums for readable cross-references.
    if p["maps"]:
        L.append("/* Map indices. */")
        L.append("enum {")
        for i, m in enumerate(p["maps"]):
            L.append("  MAP_%s = %d," % (ident(m["name"], "MAP" + str(i)), i))
        L.append("};")
        L.append("")
    if p["tilesets"]:
        L.append("/* Tileset indices. */")
        L.append("enum {")
        for i, ts in enumerate(p["tilesets"]):
            L.append("  TILESET_%s = %d," % (ident(ts["name"], "TS" + str(i)), i))
        L.append("};")
        L.append("")

    # Struct typedefs.
    L.append("""\
typedef struct {
    UINT8 tiles[4];      /* tile indices: top-left, top-right, bottom-left, bottom-right */
    UINT8 attrs[4];      /* CGB BG attribute per cell (palette 0-7); ignored on DMG */
    UINT8 collision;     /* COLLISION_SOLID | COLLISION_OVERLAY bitfield */
    UINT8 behavior;      /* BEHAVIOR_* */
} Metatile;

typedef struct {
    UINT8 metatiles[4];  /* metatile indices: tl, tr, bl, br */
} Block;

typedef struct {
    UINT8 tile;          /* base tile index (the VRAM slot to overwrite) */
    UINT8 num_frames;    /* number of frames, including the base frame */
    UINT8 rate;          /* ticks (1/60 s) each frame is shown */
    const UINT8 *frames; /* num_frames * 16 bytes; frame 0 == the base tile */
} TileAnim;

typedef struct {
    const UINT8 *tiles;        UINT16 num_tiles;       /* 2bpp data, 16 bytes per tile */
    const Metatile *metatiles; UINT16 num_metatiles;
    const Block *blocks;       UINT16 num_blocks;
    const TileAnim *anims;     UINT8  num_anims;
} Tileset;

typedef struct {
    UINT8 x, y;          /* metatile coordinates of the warp tile */
    UINT8 to_map;        /* destination map index, 0xFF if unset */
    UINT8 to_x, to_y;    /* destination metatile coordinates */
    UINT8 type;          /* WARP_* presentation (transport/door/stairs/fall) */
    UINT8 facing;        /* DIR_* after the warp, WARP_FACE_SAME to keep it */
} Warp;

typedef struct {
    UINT8 type;          /* EVENT_SIGN / EVENT_ITEM / EVENT_NPC / EVENT_TRIGGER */
    UINT8 x, y;          /* metatile coordinates */
    UINT8 p0, p1;        /* numeric params: item qty / npc movement, etc. */
    UINT16 s0, s1;       /* string-table indices (0xFFFF = none) */
} Event;

typedef struct {
    UINT8 width, height;       /* in blocks */
    UINT8 tileset;             /* index into world_tilesets */
    const UINT8 *blocks;       /* width*height block indices, 0xFF = empty */
    INT8  conn[4];             /* neighbor map index per DIR_*, -1 if none */
    INT16 conn_off[4];         /* connection offset along the shared edge, in blocks */
    UINT8 border_block;        /* block drawn past unconnected edges, 0xFF = repeat edge */
    UINT8 num_warps;
    const Warp *warps;
    UINT8 num_events;
    const Event *events;
    const char *name;
} Map;""")
    L.append("")

    # Extern declarations.
    L.append("extern const UINT16 %s_palettes[%s_NUM_PALETTES * 4];" % (name, name.upper()))
    L.append("extern const Tileset %s_tilesets[%s_NUM_TILESETS];" % (name, name.upper()))
    L.append("extern const Map %s_maps[%s_NUM_MAPS];" % (name, name.upper()))
    if b.strings:
        L.append("extern const char * const %s_strings[%s_NUM_STRINGS];" % (name, name.upper()))
    L.append("")
    L.append("/* Event field usage by type:")
    L.append("   SIGN:    s0 = text")
    L.append("   ITEM:    s0 = item id, p0 = quantity, s1 = flag id")
    L.append("   NPC:     s0 = sprite id, p0 = MOVE_*, s1 = script id")
    L.append("   TRIGGER: s0 = script id   */")
    L.append("")
    L.append("#endif /* " + guard + " */")
    return "\n".join(L) + "\n"


# ----------------------------------------------------------------------------
# Source generation
# ----------------------------------------------------------------------------

def generate_source(b, name, header_filename, bank=None):
    p = b.p
    L = []
    L.append("/* Generated by gbworld_to_c.py. Do not edit by hand. */")
    if bank is not None:
        L.append("#pragma bank %d" % bank)
    L.append('#include "%s"' % header_filename)
    L.append("")
    if bank is not None:
        L.append("BANKREF(%s)" % name)
        L.append("")

    # Palettes.
    pal_words = []
    for pal in p["palettes"]:
        for c in pal["colors"]:
            pal_words.append(hex_to_rgb555(c))
    L.append("/* GBC background palettes, 4 colors (RGB555) each. */")
    L.append("const UINT16 %s_palettes[%s_NUM_PALETTES * 4] = {" % (name, name.upper()))
    L.append(c_word_array(pal_words))
    L.append("};")
    L.append("")

    # Per tileset data.
    for tsi, ts in enumerate(p["tilesets"]):
        tprefix = "%s_ts%d" % (name, tsi)
        tname = ident(ts["name"], "TS" + str(tsi))

        # Base tile data (frame 0), in index order.
        tile_bytes = []
        for t in ts["tiles"]:
            tile_bytes.extend(tile_to_2bpp(t["pixels"]))
        if len(ts["tiles"]) > 256:
            b.warn("Tileset '%s' has %d tiles (>256); they will not all fit in VRAM at once."
                   % (ts["name"], len(ts["tiles"])))
        L.append("/* Tileset %d: %s -- %d tiles */" % (tsi, ts["name"], len(ts["tiles"])))
        L.append("const UINT8 %s_tiles[] = {" % tprefix)
        L.append(c_byte_array(tile_bytes))
        L.append("};")
        L.append("")

        # Animation frame blobs + table.
        anim_entries = []  # (tile_index, num_frames, rate, frames_symbol)
        for ti, t in enumerate(ts["tiles"]):
            frames = t.get("frames")
            if not frames:
                continue
            all_frames = [t["pixels"]] + frames     # frame 0 is the base
            blob = []
            for fp in all_frames:
                blob.extend(tile_to_2bpp(fp))
            sym = "%s_anim%d" % (tprefix, ti)
            L.append("/* Animation for tile %d: %d frames @ %d ticks */"
                     % (ti, len(all_frames), t.get("frameRate", 15)))
            L.append("const UINT8 %s[] = {" % sym)
            L.append(c_byte_array(blob))
            L.append("};")
            L.append("")
            anim_entries.append((ti, len(all_frames), t.get("frameRate", 15), sym))

        if anim_entries:
            L.append("const TileAnim %s_anims[] = {" % tprefix)
            for ti, nf, rate, sym in anim_entries:
                L.append("  { %d, %d, %d, %s }," % (ti, nf, rate, sym))
            L.append("};")
            L.append("")

        # Metatile table.
        ti_map = b.tile_index[ts["id"]]
        null_tiles = 0
        L.append("const Metatile %s_metatiles[] = {" % tprefix)
        for m in ts["metatiles"]:
            tids = []
            for cell in m["tiles"]:
                if cell is None:
                    tids.append(0)
                    null_tiles += 1
                else:
                    tids.append(ti_map.get(cell, 0))
            attrs = []
            for pid in m.get("cellPalettes", [None, None, None, None]):
                idx = b.palette_index.get(pid, 0)
                attrs.append(min(idx, 7))
            coll = COLLISION_VALUES.get(m.get("collision", "walk"), 0)
            if m.get("overlay"):
                coll |= COLLISION_OVERLAY_BIT
            beh = b.behavior_value(m.get("behavior", "normal"))
            L.append("  { {%d,%d,%d,%d}, {%d,%d,%d,%d}, %d, %d }, /* %s */"
                     % (tids[0], tids[1], tids[2], tids[3],
                        attrs[0], attrs[1], attrs[2], attrs[3], coll, beh, m.get("name", "")))
        L.append("};")
        L.append("")
        if null_tiles:
            b.warn("Tileset '%s' has %d empty metatile cells; emitted as tile 0."
                   % (ts["name"], null_tiles))
        if len(ts["metatiles"]) > 256:
            b.warn("Tileset '%s' has >256 metatiles; block indices into them use 8-bit fields."
                   % ts["name"])

        # Block table.
        mt_map = b.metatile_index[ts["id"]]
        null_mts = 0
        L.append("const Block %s_blocks[] = {" % tprefix)
        for blk in ts["blocks"]:
            mids = []
            for cell in blk["metatiles"]:
                if cell is None:
                    mids.append(0)
                    null_mts += 1
                else:
                    mids.append(mt_map.get(cell, 0))
            L.append("  { {%d,%d,%d,%d} }, /* %s */"
                     % (mids[0], mids[1], mids[2], mids[3], blk.get("name", "")))
        L.append("};")
        L.append("")
        if null_mts:
            b.warn("Tileset '%s' has %d empty block cells; emitted as metatile 0." % (ts["name"], null_mts))

        # Save symbols for the tileset table.
        ts["_sym"] = tprefix
        ts["_has_anim"] = bool(anim_entries)
        ts["_num_anims"] = len(anim_entries)

    # Tileset table.
    L.append("const Tileset %s_tilesets[%s_NUM_TILESETS] = {" % (name, name.upper()))
    for tsi, ts in enumerate(p["tilesets"]):
        sym = ts["_sym"]
        anims = ("%s_anims" % sym) if ts["_has_anim"] else "0"
        L.append("  { %s_tiles, %d, %s_metatiles, %d, %s_blocks, %d, %s, %d },"
                 % (sym, len(ts["tiles"]), sym, len(ts["metatiles"]),
                    sym, len(ts["blocks"]), anims, ts["_num_anims"]))
    L.append("};")
    L.append("")

    # Per-map data.
    for mi, m in enumerate(p["maps"]):
        mprefix = "%s_map%d" % (name, mi)
        ts_id = m["tilesetId"]
        bi_map = b.block_index.get(ts_id, {})

        # Block grid.
        grid = []
        for cell in m["blockGrid"]:
            grid.append(NO_BLOCK if cell is None else bi_map.get(cell, NO_BLOCK))
        if len(b.block_index.get(ts_id, {})) > 255:
            b.warn("Map '%s' references a tileset with >255 blocks; grid indices are 8-bit." % m["name"])
        L.append("/* Map %d: %s (%dx%d blocks) */" % (mi, m["name"], m["width"], m["height"]))
        L.append("const UINT8 %s_blocks[] = {" % mprefix)
        L.append(c_byte_array(grid, per_line=max(1, min(32, m["width"]))))
        L.append("};")

        # Warps (warp events).
        warps = [e for e in m.get("events", []) if e.get("type") == "warp"]
        if warps:
            L.append("const Warp %s_warps[] = {" % mprefix)
            for w in warps:
                to_map = b.map_index.get(w.get("toMap"), 0xFF)
                if w.get("toMap") is None:
                    to_map = 0xFF
                wt = w.get("warpType", "transport")
                if wt not in WARP_TYPE_MACROS:
                    b.warn("Map '%s': warp at (%d,%d) has unknown type '%s'; using transport."
                           % (m["name"], w["x"], w["y"], wt))
                facing = w.get("facing", "same")
                if facing != "same" and facing not in SPAWN_DIR_MACROS:
                    b.warn("Map '%s': warp at (%d,%d) has unknown facing '%s'; keeping it."
                           % (m["name"], w["x"], w["y"], facing))
                    facing = "same"
                L.append("  { %d, %d, %d, %d, %d, %s, %s },"
                         % (w["x"], w["y"], to_map, w.get("toX", 0), w.get("toY", 0),
                            WARP_TYPE_MACROS.get(wt, "WARP_TRANSPORT"),
                            SPAWN_DIR_MACROS.get(facing, "WARP_FACE_SAME")))
            L.append("};")

        # Other events. Spawn points are emitted as world-level constants,
        # not runtime events.
        others = [e for e in m.get("events", [])
                  if e.get("type") not in ("warp", "spawn")]
        if others:
            L.append("const Event %s_events[] = {" % mprefix)
            for e in others:
                t = e.get("type")
                tv = EVENT_TYPE_VALUES.get(t, 1)
                p0 = p1 = 0
                s0 = s1 = NO_STRING
                if t == "sign":
                    s0 = b.intern_string(e.get("text", ""))
                elif t == "item":
                    s0 = b.intern_string(e.get("item", ""))
                    p0 = int(e.get("qty", 1))
                    s1 = b.intern_string(e.get("flag", ""))
                elif t == "npc":
                    s0 = b.intern_string(e.get("sprite", ""))
                    p0 = NPC_MOVE_VALUES.get(e.get("movement", "static"), 0)
                    s1 = b.intern_string(e.get("script", ""))
                elif t == "trigger":
                    s0 = b.intern_string(e.get("script", ""))
                L.append("  { %d, %d, %d, %d, %d, 0x%04X, 0x%04X }, /* %s */"
                         % (tv, e["x"], e["y"], p0, p1, s0, s1, t))
            L.append("};")
        L.append("")

        m["_sym"] = mprefix
        m["_warps"] = warps
        m["_events"] = others

    # Map table.
    L.append("const Map %s_maps[%s_NUM_MAPS] = {" % (name, name.upper()))
    for mi, m in enumerate(p["maps"]):
        sym = m["_sym"]
        conn = []
        off = []
        for d in DIRS:
            c = (m.get("connections") or {}).get(d)
            if c and c.get("mapId") in b.map_index:
                conn.append(b.map_index[c["mapId"]])
                off.append(int(c.get("offset", 0)))
            else:
                conn.append(NO_MAP)
                off.append(0)
        warps_sym = ("%s_warps" % sym) if m["_warps"] else "0"
        events_sym = ("%s_events" % sym) if m["_events"] else "0"
        # Border block: rendered past unconnected map edges (Pokemon-style
        # repeating border). NO_BLOCK means "repeat the edge metatiles".
        bb = NO_BLOCK
        if m.get("borderBlock") is not None:
            bb = b.block_index.get(m["tilesetId"], {}).get(m["borderBlock"], NO_BLOCK)
            if bb == NO_BLOCK:
                b.warn("Map '%s' has a border block that is not in its tileset; ignored."
                       % m["name"])
        L.append("  { %d, %d, %d, %s_blocks, {%d,%d,%d,%d}, {%d,%d,%d,%d}, 0x%02X, %d, %s, %d, %s, %s },"
                 % (m["width"], m["height"], b.tileset_index.get(m["tilesetId"], 0), sym,
                    conn[0], conn[1], conn[2], conn[3],
                    off[0], off[1], off[2], off[3], bb,
                    len(m["_warps"]), warps_sym, len(m["_events"]), events_sym,
                    c_string_literal(m["name"])))
    L.append("};")
    L.append("")

    # String table.
    if b.strings:
        L.append("const char * const %s_strings[%s_NUM_STRINGS] = {" % (name, name.upper()))
        for s in b.strings:
            L.append("  %s," % c_string_literal(s))
        L.append("};")
        L.append("")

    return "\n".join(L) + "\n"


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Convert a .gbworld.json project to GBDK C.")
    ap.add_argument("input", help="Path to the .gbworld.json project file")
    ap.add_argument("-o", "--outdir", default=".", help="Output directory (default: current)")
    ap.add_argument("--name", default="world", help="Base name for files/identifiers (default: world)")
    ap.add_argument("--bank", type=int, default=None,
                    help="ROM bank for the data (#pragma bank + BANKREF)")
    args = ap.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        project = json.load(f)
    for key in ("palettes", "tilesets", "maps"):
        if key not in project:
            sys.exit("Error: input does not look like a project (missing '%s')." % key)

    os.makedirs(args.outdir, exist_ok=True)
    name = re.sub(r"[^0-9a-zA-Z_]", "_", args.name)

    b = Builder(project, name)
    header_filename = name + ".h"
    header = generate_header(b, name, args.bank)
    source = generate_source(b, name, header_filename, args.bank)
    # The header references the string count, which is only known after the
    # source pass interns strings, so regenerate the header now.
    header = generate_header(b, name, args.bank)

    h_path = os.path.join(args.outdir, header_filename)
    c_path = os.path.join(args.outdir, name + ".c")
    with open(h_path, "w", encoding="utf-8") as f:
        f.write(header)
    with open(c_path, "w", encoding="utf-8") as f:
        f.write(source)

    print("Wrote %s and %s" % (h_path, c_path))
    print("  %d tilesets, %d maps, %d palettes, %d strings"
          % (len(project["tilesets"]), len(project["maps"]),
             len(project["palettes"]), len(b.strings)))
    for w in b.warnings:
        print("  warning:", w)


if __name__ == "__main__":
    main()
