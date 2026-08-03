# SFX Sequencer — Guide

The chime tool. A victory fanfare, a fail sting, an item-get flourish or a UI
confirm is not one tone with a bend on it — it is a run of notes, and this is
where those are written: a piano roll and a note table side by side, over one
timbre.

Single-tone effects (hits, lasers, explosions) are the
[SFX Generator](SFX_GENERATOR.md). Both tools read and write the same
`.gbsfx.json`, so a sound can move between them freely.

Open it by serving the repo root over HTTP and visiting
<http://localhost:8000/docs/gb-sfx-sequencer.html> (see the main
[README](../README.md) for serving instructions).

## Chimes are generated, not fixed

The six buttons in **New chime** are **archetypes**, not phrases. Each one
describes a shape — which chord to walk, in which direction, how fast, how long
the last note is held, and the timbre underneath — and pressing it takes one
draw from that shape:

| Archetype | Shape |
|-----------|-------|
| **Victory** | rises through a major chord, lands on a long held note, often after a beat of silence |
| **Sad** | falls through a minor or diminished chord, slowing as it goes |
| **UI** | two or three very short high blips — a confirm, not a tune |
| **Item get** | a quick rising flourish into a held note |
| **Level up** | a longer run up to a peak and back, landing above where it started |
| **Alert** | two notes traded back and forth, a siren rather than a run |

Press the same button again for another draw. **Re-roll** in the transport does
the same without changing archetype, and **Seed** is the number the draw came
from: type an old seed back in and you get that exact chime again. Each layer
also has its own **Archetype** dropdown and **Re-roll layer** button.

After the draw it is an ordinary sequence — every note can be edited, and the
seed just stays behind as a record of where the notes came from.

## Editing notes

The **piano roll** and the **note table** show the same notes and edit the same
model:

- Drag a note **up/down** to transpose it, drag its **right edge** to stretch
  it, and drag its bar in the **volume strip** along the bottom to set how hard
  that note is struck.
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
| vol | 0–15 attack volume for this note, so a phrase can be shaped without touching the timbre |

Every note re-triggers the channel by default — that is what makes an arpeggio
read as separate notes rather than one sliding tone. `tie` is the exception,
and a **rest** is silence: it writes nothing at all, because the note before it
already told the hardware length counter to expire exactly there.

Both pictures update on every edit, including volume: the roll shows what is
authored, and the visualization above it shows what the envelope actually does
with it.

## Timbre

The sliders under the roll are what every note is struck with: **Punch**,
**Decay**, **Sustain** and **Tone** (pulse duty, wave preset, or noise width).
Pitch and length come from the notes themselves, and bend/jump/vibrato are
single-tone controls a sequence ignores — so they are not offered here.

## Layers

**Add sequence layer** stacks a second voice on another channel: a harmony
under the melody, or a noise pulse under both. Each layer has its own notes,
its own timbre and its own roll.

## Undo

Every edit is undoable: **Undo** / **Redo** in the top bar, or `Ctrl`/`Cmd`+`Z`
and `Ctrl`/`Cmd`+`Shift`+`Z`. A whole drag — transposing, stretching, setting a
volume — is one step, so pressing a chime button over work you liked, or
re-rolling one draw too many, costs nothing.

## Export / Import

Identical to the generator's: **.gbsfx.json** (the editable source of truth,
one sound per file), **.wav** (an offline render of the preview), and
**gbsfx.c / .h** for GBDK-2020. A generated chime of five or six notes compiles
to roughly 50–140 bytes, because frames where nothing audible changed collapse
into a hold opcode rather than costing seven bytes each — see the
[generator guide](SFX_GENERATOR.md#export--import) for the runtime API.

Opening a **single-tone** file here works the same way the reverse does: it
loads, plays and exports, and its layer is shown read-only with a link back to
the generator.
