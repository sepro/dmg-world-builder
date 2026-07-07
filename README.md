# GB Tools

Six browser-based Game Boy authoring tools, plus the tooling around them. Every
tool is a single self-contained HTML page with no build step — vanilla JS, served
as static files. A themed landing page (`docs/index.html`) links them all.

![The GB Tool Suite landing page](docs/screenshots/landing.png)

## The tools

### World Editor

Author Pokémon-style Game Boy worlds (tiles → metatiles → blocks → maps, with
connections and an events layer) and export them to GBDK-2020 C. See the
[World Editor guide](markdown/WORLD_EDITOR.md).

![World Editor](docs/screenshots/world-editor.png)

### Sprite Editor

Draw or import sprite sheets, arrange 8×8 / 8×16 hardware sprites into metasprites,
and sequence them into animations. Exports `.gbsprite.json` and PNG.

![Sprite Editor](docs/screenshots/sprite-editor.png)

### Music Generator

A deterministic chiptune improviser for the four GB channels that exports settings
and Standard MIDI. See the [Music Generator guide](markdown/MUSIC_GENERATOR.md).

![Music Generator](docs/screenshots/music-generator.png)

### SFX Generator

A sound-effect designer for the four GB channels. Start from a preset (coin, laser,
jump, explosion, hit, power-up, blip), refine with semantic sliders, and export
`.gbsfx.json`, a WAV, or GBDK-2020 C with a tiny frame player.

![SFX Generator](docs/screenshots/sfx-generator.png)

### Pixelizer

Turn any image into 2-bit pixel art: tone controls, pixel-art-aware downscaling
(k-centroid and friends), optional dithering, and a live tile-count readout. The
PNG re-imports losslessly into the world and sprite editors — or hand it straight
to the Tile Reducer.

![Pixelizer with a sample landscape loaded](docs/screenshots/pixelizer.png)

### Tile Reducer

Load a PNG, count its unique 8×8 tiles, and merge similar ones until the image fits
a VRAM budget while staying close to the original.

![Tile Reducer with the pixelizer output loaded](docs/screenshots/tile-reducer.png)

## Structure

```
dmg-world-builder/
├── docs/                          # the apps + landing page (served over HTTP)
│   ├── index.html                 # landing page linking every tool
│   ├── gb-world-editor.html       # the world editor
│   ├── gb-sprite-editor.html      # the sprite editor
│   ├── gb-music-generator.html    # the music generator
│   ├── gb-sfx-generator.html      # the sfx generator
│   ├── gb-pixelizer.html          # the pixelizer
│   ├── gb-tile-reducer.html       # the tile reducer
│   ├── gb-theme.css               # shared DMG design tokens + components
│   ├── gb-common.js               # shared DOM/form helpers
│   └── screenshots/               # README screenshots (see tools/screenshots)
├── tools/
│   ├── gbworld_to_c.py            # project JSON  ->  GBDK world.h / world.c
│   ├── gbworld_visualize.py       # project JSON  ->  stitched world.png
│   └── screenshots/               # headless-browser capture of the screenshots
├── markdown/
│   ├── WORLD_EDITOR.md            # world editor guide
│   ├── MUSIC_GENERATOR.md         # music generator option reference
│   └── DEVELOPER_HANDOFF.md       # JSON schema, C structures, integration guide
├── worlds/                        # example projects
├── .devcontainer/
└── README.md
```

The apps live in `docs/` so the suite can be published straight to GitHub Pages
(serve from the `docs/` folder). When published, the landing page is the site root.

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
# landing page:     http://localhost:8000/docs/
# world editor:     http://localhost:8000/docs/gb-world-editor.html
# sprite editor:    http://localhost:8000/docs/gb-sprite-editor.html
# music generator:  http://localhost:8000/docs/gb-music-generator.html
# sfx generator:    http://localhost:8000/docs/gb-sfx-generator.html
# pixelizer:        http://localhost:8000/docs/gb-pixelizer.html
# tile reducer:     http://localhost:8000/docs/gb-tile-reducer.html
```

Every tool runs entirely in the browser; the server only delivers the files.

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
[markdown/DEVELOPER_HANDOFF.md](markdown/DEVELOPER_HANDOFF.md) for the JSON schema,
the generated C structures, and a GBDK-2020 integration walkthrough.
