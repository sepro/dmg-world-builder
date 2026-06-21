# GB World Editor

A browser-based authoring tool for Pokémon-style Game Boy worlds, plus the tooling to
turn an exported project into GBDK-2020 C and to visualize the whole world.

The editor builds worlds from a fixed hierarchy: 8×8 tiles → 16×16 metatiles → 32×32
blocks → maps of blocks, with edge connections between maps, an events layer (warps,
signs, items, NPCs, triggers), per-tile animation, and undo/redo. Everything lives in
one project file you export and import as JSON.

## Structure

```
gb-world-editor/
├── gb-world-editor.html          # the editor (single self-contained file)
├── tools/
│   ├── gbworld_to_c.py           # project JSON  ->  GBDK world.h / world.c
│   └── gbworld_visualize.py      # project JSON  ->  stitched world.png
├── docs/
│   └── DEVELOPER_HANDOFF.md       # JSON schema, C structures, integration guide
├── .devcontainer/
│   ├── Dockerfile
│   └── devcontainer.json
└── README.md
```

## Quick start

### With VS Code Dev Containers (recommended)

1. Open this folder in VS Code and choose **Dev Containers: Reopen in Container**.
2. The container serves the editor automatically. Open
   <http://localhost:8000/gb-world-editor.html>.

### Without Docker

Serve the folder with anything static, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/gb-world-editor.html
```

The editor runs entirely in the browser; the server only delivers the HTML file. Use
**Export** in the editor to save your project as a `.gbworld.json`, and **Import** to
load it back.

## Tooling

```bash
# Generate GBDK C from an exported project
python3 tools/gbworld_to_c.py project.gbworld.json -o build/ --name world

# Render the whole world (all connected maps) to one PNG
python3 tools/gbworld_visualize.py project.gbworld.json -o world.png --scale 3
```

`gbworld_to_c.py` needs only the Python standard library. `gbworld_visualize.py`
needs Pillow (`pip install pillow`; preinstalled in the devcontainer).

## Integrating into a ROM

The converter keeps the full tile→metatile→block→map hierarchy so a large world stays
small in ROM and is reconstructed at runtime. See **docs/DEVELOPER_HANDOFF.md** for the
JSON schema, the generated C structures, and a GBDK-2020 integration walkthrough
(loading a map, reconstructing blocks into the tilemap, tile animation, and the
Pokémon-style warp/behavior split).
