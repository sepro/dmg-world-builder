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

A layer is in one of three modes: **macro** (generated from sliders), **manual**
(hand-edited per-frame steps), or **sequence** (a list of notes — see
[Sequences](#sequences-chimes-and-jingles) below). Everything — the pitch/volume
visualization, audio preview, WAV render, and C export — is driven by the same
compiled per-frame program, so what you hear is what you export.

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

## Sequences (chimes and jingles)

A macro layer is **one tone**. It can bend, jump and warble, but it cannot play
"C5, E5, G5, C6" — and a victory fanfare, a death sting or an item-get flourish
is exactly that. A **sequence layer** is a list of notes played one after
another through the layer's macro timbre and envelope.

Start one either way:

- **New chime** (left column) — Win, Death or Item get. Each drops in a
  ready-made phrase you can then edit.
- **Add sequence layer** (under the layer cards) — pick a channel, start from a
  single note. Sequence layers stack with ordinary layers, so a noise thud can
  run under a pulse melody.

### Editing notes

The **piano roll** and the **note table** show the same notes and edit the same
model, side by side:

- Drag a note **up/down** to transpose it, drag its **right edge** to stretch it.
- In the table, type a note name (`C5`, `f#4`, `Bb3`, or a bare MIDI number) or
  a length in frames. `Add note` appends; `↑`/`↓` move the selected note; the
  per-row buttons are **R** (turn the note into a rest), **+** (duplicate) and
  **×** (delete).

Per note:

| Field | Meaning |
|-------|---------|
| note / tone | pitch (MIDI note), or 0–15 tone on the noise channel |
| len | length in frames — 60 to the second at the default tick rate |
| tie | don't re-attack the next note: the envelope carries on and only the pitch changes |
| vol | 0–15 attack volume for this note, so a phrase can be shaped without touching the macro |

Every note re-triggers the channel by default — that is what makes an arpeggio
read as separate notes rather than one sliding tone. `tie` is the exception,
and a **rest** is silence: it writes nothing at all, because the note before it
already told the hardware length counter to expire exactly there.

The layer's sliders shrink to what a sequence actually uses: **Punch**,
**Decay**, **Sustain** and **Tone** shape every note. Pitch and length come from
the notes themselves, and bend/jump/vibrato are single-tone controls that a
sequence ignores.

### Randomize, Mutate, Seed

Effects are reproducible: **Randomize** re-derives the macro deterministically
from the effect's **Seed** (same seed = same sound), while **Mutate** nudges
the current values without touching the seed. Set the seed by hand to revisit
a variant. Both leave a sequence's notes alone — an authored phrase is not
something to re-roll — and only change its timbre.

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
  compact byte program for a tiny VM: a note is triggered with the hardware
  volume envelope and length counter set from the macro (so decays run on real
  hardware), and frames inside it rewrite only pitch — no re-trigger, so no
  60 Hz buzz. Frames where nothing audible changed are not written at all and
  collapse into a hold opcode, which is what keeps a one- or two-second chime
  to tens of bytes rather than seven a frame. Runtime API: `gbsfx_init()` once,
  `gbsfx_play(id)` to fire an effect, `gbsfx_update()` once per frame — and
  from inside any loop that blocks for a while (a screen fade), or a sequence
  freezes mid-note until the loop returns.
- **Import .gbsfx.json** — load a file or pasted JSON.

## Hardware notes

The preview is a close Web Audio approximation, not a cycle-accurate emulator
(duty, for instance, is treated as constant across an effect). Frequencies use
the real register formulas (`pulse = 131072/(2048-period)`,
`wave = 65536/(2048-period)`), noise tones map to LFSR clock settings, and
wave volume uses the coarse NR32 levels, so the exported C sounds like the
preview within those limits.
