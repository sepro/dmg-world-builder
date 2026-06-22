# GB Tools

Two browser-based Game Boy authoring tools, plus the tooling around them. Both are
single self-contained HTML pages with no build step — vanilla JS, served as static
files.

- **World Editor** — author Pokémon-style Game Boy worlds (tiles → metatiles →
  blocks → maps, with connections and an events layer) and export them to GBDK-2020
  C. See the [World Editor guide](docs/WORLD_EDITOR.md).
- **Music Generator** — a deterministic chiptune improviser for the four GB channels
  that exports settings and Standard MIDI. See the
  [Music Generator guide](docs/MUSIC_GENERATOR.md).

## Structure

```
gb-world-editor/
├── dist/                          # the apps (served over HTTP)
│   ├── gb-world-editor.html       # the world editor
│   ├── gb-music-generator.html    # the music generator
│   ├── gb-theme.css               # shared DMG design tokens + components
│   └── gb-common.js               # shared DOM/form helpers
├── tools/
│   ├── gbworld_to_c.py            # project JSON  ->  GBDK world.h / world.c
│   └── gbworld_visualize.py       # project JSON  ->  stitched world.png
├── docs/
│   ├── WORLD_EDITOR.md            # world editor guide
│   ├── MUSIC_GENERATOR.md         # music generator option reference
│   └── DEVELOPER_HANDOFF.md       # JSON schema, C structures, integration guide
├── worlds/                        # example projects
├── .devcontainer/
└── README.md
```

## Quick start

The pages are static, but they link the shared `gb-theme.css` / `gb-common.js`, so
they **must be served over HTTP** — opening a `.html` via `file://` won't load the
shared assets.

### With VS Code Dev Containers (recommended)

Open this folder in VS Code and choose **Dev Containers: Reopen in Container**. A
static server (Live Server) starts automatically on port 5500.

### Without Docker

Serve the repo root with anything static:

```bash
python3 -m http.server 8000
# world editor:    http://localhost:8000/dist/gb-world-editor.html
# music generator: http://localhost:8000/dist/gb-music-generator.html
```

Both apps run entirely in the browser; the server only delivers the files.

## World tooling

The World Editor's **Export** saves your project as a `.gbworld.json` (the single
source of truth). Turn it into ROM data or a preview image from the repo root:

```bash
# Generate GBDK C from an exported project
python3 tools/gbworld_to_c.py project.gbworld.json -o build/ --name world

# Render the whole world (all connected maps) to one PNG
python3 tools/gbworld_visualize.py project.gbworld.json -o world.png --scale 3
```

`gbworld_to_c.py` needs only the Python standard library. `gbworld_visualize.py`
needs Pillow (`pip install pillow`; preinstalled in the devcontainer). See
[docs/DEVELOPER_HANDOFF.md](docs/DEVELOPER_HANDOFF.md) for the JSON schema, the
generated C structures, and a GBDK-2020 integration walkthrough.
