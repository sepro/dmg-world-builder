#!/usr/bin/env python3
"""
gbworld_visualize.py - render a whole GB World Editor project to a single PNG by
stitching every map into place using its edge connections.

Each map is rendered from the hierarchy (block -> metatile -> tile -> pixels)
using its GBC palette assignments, then all maps are laid out in one image
according to their connections. Disconnected groups are stacked below each other.

Connection convention (must match gbworld_to_c.py):
- Coordinates increase right (x) and down (y), measured in blocks (32 px).
- A connection A.<dir> = {neighbor, offset} places the neighbor on that side and
  shifts it along the shared edge: positive offset moves it right (north/south)
  or down (east/west).

Usage:
    python3 gbworld_visualize.py world.gbworld.json -o world.png
    python3 gbworld_visualize.py world.gbworld.json --scale 2 --plain

Requires Pillow:  pip install pillow
"""

import argparse
import json
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("This script needs Pillow. Install it with:  pip install pillow")


TILE = 8
BLOCK = 32          # pixels per block
DIRS = ["north", "south", "east", "west"]
BG = (12, 22, 14)   # background behind empty cells
GRID_OUTLINE = (44, 88, 64)
LABEL = (216, 240, 200)


def hex_to_rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


class Renderer:
    """Renders maps to images, caching tile/metatile/block images per tileset."""

    def __init__(self, project, frame=0):
        self.p = project
        self.frame = frame
        self.palettes = {pal["id"]: [hex_to_rgb(c) for c in pal["colors"]]
                         for pal in project["palettes"]}
        self.tilesets = {ts["id"]: ts for ts in project["tilesets"]}
        self.tile_by_id = {}
        self.metatile_by_id = {}
        self.block_by_id = {}
        for ts in project["tilesets"]:
            self.tile_by_id[ts["id"]] = {t["id"]: t for t in ts["tiles"]}
            self.metatile_by_id[ts["id"]] = {m["id"]: m for m in ts["metatiles"]}
            self.block_by_id[ts["id"]] = {b["id"]: b for b in ts["blocks"]}
        # Image caches keyed within a tileset.
        self._tile_cache = {}       # (ts_id, tile_id, palette_id) -> Image
        self._metatile_cache = {}   # (ts_id, metatile_id) -> Image
        self._block_cache = {}      # (ts_id, block_id) -> Image

    def _frame_pixels(self, tile):
        frames = [tile["pixels"]] + (tile.get("frames") or [])
        return frames[self.frame % len(frames)]

    def tile_image(self, ts_id, tile_id, palette_id):
        key = (ts_id, tile_id, palette_id)
        if key not in self._tile_cache:
            tile = self.tile_by_id[ts_id].get(tile_id)
            colors = self.palettes.get(palette_id) or [(0, 0, 0)] * 4
            img = Image.new("RGB", (TILE, TILE), BG)
            if tile:
                px = self._frame_pixels(tile)
                img.putdata([colors[v & 3] for v in px])
            self._tile_cache[key] = img
        return self._tile_cache[key]

    def metatile_image(self, ts_id, metatile_id):
        key = (ts_id, metatile_id)
        if key not in self._metatile_cache:
            m = self.metatile_by_id[ts_id].get(metatile_id)
            img = Image.new("RGB", (TILE * 2, TILE * 2), BG)
            if m:
                offsets = [(0, 0), (TILE, 0), (0, TILE), (TILE, TILE)]
                pals = m.get("cellPalettes", [None, None, None, None])
                for i, tile_id in enumerate(m["tiles"]):
                    if tile_id is None:
                        continue
                    img.paste(self.tile_image(ts_id, tile_id, pals[i]), offsets[i])
            self._metatile_cache[key] = img
        return self._metatile_cache[key]

    def block_image(self, ts_id, block_id):
        key = (ts_id, block_id)
        if key not in self._block_cache:
            blk = self.block_by_id[ts_id].get(block_id)
            img = Image.new("RGB", (TILE * 4, TILE * 4), BG)
            if blk:
                offsets = [(0, 0), (TILE * 2, 0), (0, TILE * 2), (TILE * 2, TILE * 2)]
                for i, mid in enumerate(blk["metatiles"]):
                    if mid is None:
                        continue
                    img.paste(self.metatile_image(ts_id, mid), offsets[i])
            self._block_cache[key] = img
        return self._block_cache[key]

    def map_image(self, m):
        ts_id = m["tilesetId"]
        w, h = m["width"], m["height"]
        img = Image.new("RGB", (w * BLOCK, h * BLOCK), BG)
        for idx, block_id in enumerate(m["blockGrid"]):
            if block_id is None:
                continue
            cx, cy = idx % w, idx // w
            img.paste(self.block_image(ts_id, block_id), (cx * BLOCK, cy * BLOCK))
        return img


def layout_maps(project):
    """Assign each map a block-space origin (bx, by) by walking connections.

    Returns {map_id: (bx, by)}. Disconnected groups are stacked vertically.
    """
    maps = {m["id"]: m for m in project["maps"]}
    pos = {}
    placed_order = []

    def place_component(start_id, base_y):
        pos[start_id] = (0, base_y)
        stack = [start_id]
        component = [start_id]
        while stack:
            mid = stack.pop()
            m = maps[mid]
            bx, by = pos[mid]
            conns = m.get("connections") or {}
            for d in DIRS:
                c = conns.get(d)
                if not c or c.get("mapId") not in maps:
                    continue
                nid = c["mapId"]
                if nid in pos:
                    continue
                nm = maps[nid]
                off = int(c.get("offset", 0))
                if d == "north":
                    npos = (bx + off, by - nm["height"])
                elif d == "south":
                    npos = (bx + off, by + m["height"])
                elif d == "east":
                    npos = (bx + m["width"], by + off)
                else:  # west
                    npos = (bx - nm["width"], by + off)
                pos[nid] = npos
                stack.append(nid)
                component.append(nid)
        return component

    # Place connected components one after another, stacked below each other.
    next_base = 0
    for m in project["maps"]:
        if m["id"] in pos:
            continue
        comp = place_component(m["id"], next_base)
        placed_order.extend(comp)
        # Normalize this component's vertical position and find its extent so the
        # next component starts below it with a small gap.
        ys = [pos[mid][1] for mid in comp]
        ymins = min(ys)
        # shift component so its top is at next_base
        shift = next_base - ymins
        if shift:
            for mid in comp:
                x, y = pos[mid]
                pos[mid] = (x, y + shift)
        bottom = max(pos[mid][1] + maps[mid]["height"] for mid in comp)
        next_base = bottom + 1   # one-block gap between components

    return pos


def render_world(project, scale=1, plain=False, frame=0):
    renderer = Renderer(project, frame=frame)
    pos = layout_maps(project)
    maps = {m["id"]: m for m in project["maps"]}
    if not pos:
        sys.exit("No maps to render.")

    # Global bounds in blocks.
    min_x = min(p[0] for p in pos.values())
    min_y = min(p[1] for p in pos.values())
    max_x = max(pos[mid][0] + maps[mid]["width"] for mid in pos)
    max_y = max(pos[mid][1] + maps[mid]["height"] for mid in pos)
    world_w = (max_x - min_x) * BLOCK
    world_h = (max_y - min_y) * BLOCK

    world = Image.new("RGB", (world_w, world_h), BG)
    draw = ImageDraw.Draw(world)

    for mid, (bx, by) in pos.items():
        m = maps[mid]
        px = (bx - min_x) * BLOCK
        py = (by - min_y) * BLOCK
        world.paste(renderer.map_image(m), (px, py))
        if not plain:
            draw.rectangle([px, py, px + m["width"] * BLOCK - 1, py + m["height"] * BLOCK - 1],
                           outline=GRID_OUTLINE)
            draw.text((px + 3, py + 2), m["name"], fill=LABEL)

    if scale != 1:
        world = world.resize((world_w * scale, world_h * scale), Image.NEAREST)
    return world


def main():
    ap = argparse.ArgumentParser(description="Stitch a .gbworld.json project into one PNG.")
    ap.add_argument("input", help="Path to the .gbworld.json project file")
    ap.add_argument("-o", "--output", default="world.png", help="Output PNG path (default: world.png)")
    ap.add_argument("--scale", type=int, default=1, help="Integer upscale factor (nearest neighbor)")
    ap.add_argument("--plain", action="store_true", help="Omit map borders and name labels")
    ap.add_argument("--frame", type=int, default=0, help="Animation frame to render for animated tiles")
    args = ap.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        project = json.load(f)
    for key in ("palettes", "tilesets", "maps"):
        if key not in project:
            sys.exit("Error: input does not look like a project (missing '%s')." % key)

    world = render_world(project, scale=args.scale, plain=args.plain, frame=args.frame)
    world.save(args.output)
    print("Wrote %s  (%d x %d px, %d maps)"
          % (args.output, world.width, world.height, len(project["maps"])))


if __name__ == "__main__":
    main()
