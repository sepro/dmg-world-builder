# SFX Generator — Guide

A sound-effect designer for the four Game Boy channels, sfxr-style: pick a
category, refine with a handful of semantic sliders, and export the result as
a `.gbsfx.json` file, a WAV, or GBDK-2020 C with a tiny frame-stepped player.

This tool makes **single-tone** effects — a hit, a laser, a coin, an explosion.
A sound that plays *several notes* (a victory fanfare, a fail sting, a UI
confirm) is a chime, and chimes are authored next door in the
[SFX Sequencer](SFX_SEQUENCER.md). Both tools read and write the same
`.gbsfx.json`.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-sfx-generator.html> (see the main
[README](../README.md) for serving instructions).

## Model

You work on **one sound at a time** — exports are one sound per file, so there
is no session library to keep track of. **New** and the preset buttons replace
what you have, and **Undo** (or `Ctrl`/`Cmd`+`Z`) brings it back.

A sound has a tick rate (default 60 Hz — one step per frame) and one or more
**layers**. A layer targets one channel:

| Channel | Hardware | Typical use |
|---------|----------|-------------|
| Pulse 1 | square + sweep | zaps, jumps, coins |
| Pulse 2 | square | second voice, chords |
| Wave | 32-sample wavetable | soft/bassy tones |
| Noise | LFSR | hits, explosions, percussion |

A layer is in one of three modes: **macro** (generated from sliders), **manual**
(hand-edited per-frame steps), or **sequence** (a list of notes, edited in the
sequencer). Everything — the pitch/volume visualization, audio preview, WAV
render, and C export — is driven by the same compiled per-frame program, so what
you hear is what you export.

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
3. **Play** to preview (sliders re-trigger on release) and **Add layer** to
   stack channels — a noise thud under a pulse blip, say.

## Undo

Every edit is undoable: **Undo** / **Redo** in the top bar, or `Ctrl`/`Cmd`+`Z`
and `Ctrl`/`Cmd`+`Shift`+`Z`. A whole slider drag is one step, so undo walks
back through decisions rather than pixels, and pressing a preset by mistake
costs nothing.

## Randomize, Mutate, Seed

Sounds are reproducible: **Randomize** re-derives the macro deterministically
from the **Seed** (same seed = same sound), while **Mutate** nudges the current
values without touching the seed. Set the seed by hand to revisit a variant.

## Advanced drawer

Extra macros: **Sustain** (hold level before decay), **Bend amt**, **Jump** /
**Jump at** (a discrete pitch jump of ±24 semitones at a point in the effect —
the classic coin "bling"), **Vib rate** / **Vib depth** (vibrato), and the
**Tick rate** (15–120 Hz). It also shows the per-frame **register inspector**
(NRx0–NRx4 values) and **Edit frames by hand**, which converts the layer to
manual mode: drag on the top half of the visualization to draw pitch, the
bottom half to draw volume (**Back to macro** discards the hand edits).

## Opening a chime here

A file with a sequence layer loads, plays and exports normally; its layer is
shown read-only with a link to the sequencer, because notes are edited there.
Any single-tone layers in the same file stay fully editable here — so a chime's
noise underlay can be tuned in this tool without the melody going anywhere.

## Export / Import

- **Download .gbsfx.json** — the sound you are working on, one sound per file
  (`formatVersion 1`). This is the editable source of truth.
- **Download .wav** — an offline render using the same scheduler as the
  preview.
- **Show gbsfx.c / .h** — GBDK-2020 C export. The sound compiles to a compact
  byte program for a tiny VM: a note is triggered with the hardware volume
  envelope and length counter set from the macro (so decays run on real
  hardware), and frames inside it rewrite only pitch — no re-trigger, so no
  60 Hz buzz. Frames where nothing audible changed are not written at all and
  collapse into a hold opcode, which is what keeps a one- or two-second chime
  to tens of bytes rather than seven a frame. Runtime API: `gbsfx_init()` once,
  `gbsfx_play(id)` to fire an effect, `gbsfx_update()` once per frame — and
  from inside any loop that blocks for a while (a screen fade), or a sound
  freezes mid-note until the loop returns.
- **Import .gbsfx.json** — load a file or pasted JSON. An older bank file
  holding several sounds loads its first one and says so.

## Hardware notes

The preview is a close Web Audio approximation, not a cycle-accurate emulator
(duty, for instance, is treated as constant across an effect). Frequencies use
the real register formulas (`pulse = 131072/(2048-period)`,
`wave = 65536/(2048-period)`), noise tones map to LFSR clock settings, and
wave volume uses the coarse NR32 levels, so the exported C sounds like the
preview within those limits.
