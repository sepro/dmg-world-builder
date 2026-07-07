# SFX Generator — Guide

A sound-effect designer for the four Game Boy channels, sfxr-style: pick a
category, refine with a handful of semantic sliders, and export the result as
a `.gbsfx.json` bank, a WAV, or GBDK-2020 C with a tiny frame-stepped player.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-sfx-generator.html> (see the main
[README](../README.md) for serving instructions).

## Model

The file is a **bank of effects**. Each effect has a tick rate (default 60 Hz
— one step per frame) and one or more **layers**. A layer targets one channel:

| Channel | Hardware | Typical use |
|---------|----------|-------------|
| Pulse 1 | square + sweep | zaps, jumps, coins |
| Pulse 2 | square | second voice, chords |
| Wave | 32-sample wavetable | soft/bassy tones |
| Noise | LFSR | hits, explosions, percussion |

A layer is either **macro** mode (generated from sliders) or **manual** mode
(hand-edited per-frame steps). Everything — the pitch/volume visualization,
audio preview, WAV render, and C export — is driven by the same compiled
per-frame program, so what you hear is what you export.

## Workflow

1. **New from preset** — pick a category: Coin, Laser, Jump, Explode, Hit,
   Power-up, Blip, or Custom (blank). The preset seeds the sliders.
2. Refine with the macro sliders (per layer):
   - **Length** — duration in ms (40–2000).
   - **Pitch** — base note (pulse/wave) or noise tone 0–15 (noise).
   - **Bend** — continuous pitch slide up or down.
   - **Punch** — extra loudness at the very start.
   - **Decay** — how fast the volume falls off.
   - **Tone** — timbre: pulse duty cycle, wave preset, or noise width
     (15-bit hiss vs 7-bit metallic).
3. **Play** to preview (sliders re-trigger on release), **Add layer** to stack
   channels, **Duplicate**/**Delete** to manage the library list.

### Randomize, Mutate, Seed

Effects are reproducible: **Randomize** re-derives the macro deterministically
from the effect's **Seed** (same seed = same sound), while **Mutate** nudges
the current values without touching the seed. Set the seed by hand to revisit
a variant.

### Advanced drawer

Extra macros: **Sustain** (hold level before decay), **Bend amt**, **Jump** /
**Jump at** (a discrete pitch jump of ±24 semitones at a point in the effect —
the classic coin "bling"), **Vib rate** / **Vib depth** (vibrato), and the
effect's **Tick rate** (15–120 Hz). It also shows the per-frame **register
inspector** (NRx0–NRx4 values) and **Edit frames by hand**, which converts the
layer to manual mode for direct per-frame editing (**Back to macro** discards
the hand edits).

## Export / Import

- **Download .gbsfx.json** — the whole bank (`formatVersion 1`).
- **Download .wav (selected)** — an offline render of the selected effect
  using the same scheduler as the preview.
- **Show gbsfx.c / .h** — GBDK-2020 C export. Each effect compiles to a
  compact byte program for a tiny VM: frame 0 triggers the channels with the
  hardware volume envelope and length counter set from the macro (so decays
  run on real hardware), later frames rewrite only pitch — no re-trigger, so
  no 60 Hz buzz. Runtime API: `gbsfx_init()` once, `gbsfx_play(id)` to fire an
  effect, `gbsfx_update()` once per frame.
- **Import .gbsfx.json** — load a file or pasted JSON.

## Hardware notes

The preview is a close Web Audio approximation, not a cycle-accurate emulator
(duty, for instance, is treated as constant across an effect). Frequencies use
the real register formulas (`pulse = 131072/(2048-period)`,
`wave = 65536/(2048-period)`), noise tones map to LFSR clock settings, and
wave volume uses the coarse NR32 levels, so the exported C sounds like the
preview within those limits.
