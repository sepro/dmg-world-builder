/*
  gbsfx-chimes.js - procedural chime generation for the SFX sequencer.

  A chime is a tiny tune, and the useful ones are a small family: a victory
  fanfare rises through a major chord and holds the top note; a fail sting
  falls through a minor one and slows down; a UI blip is one or two very short
  notes. Rather than shipping three fixed phrases, each of those is an
  **archetype** -- the chord to walk, the contour to walk it in, how long the
  notes are, how the last one is held, and the timbre underneath -- and a chime
  is one deterministic draw from it.

  `generateChime(key, seed)` is pure: the same key and seed always produce the
  same notes, so a generated chime survives export/import and can be re-rolled
  by changing one number. The result is an ordinary sequence layer afterwards;
  nothing downstream knows or cares that it was generated, and every note can
  be edited by hand.
*/

import { clampInt } from "./common.js";
import {
  MAX_NOTE_FRAMES, clampf, makeLayer, makeMacro, makeNote, makeRng,
} from "./gbsfx-core.js";

// Degree sets the walk climbs through, in semitones above the root. Index
// past the end and it keeps going in the next octave (see `degreeAt`).
const CHORDS = {
  major:      [0, 4, 7],
  major7:     [0, 4, 7, 11],
  major6:     [0, 4, 7, 9],
  minor:      [0, 3, 7],
  minor7:     [0, 3, 7, 10],
  dim:        [0, 3, 6],
  sus4:       [0, 5, 7],
  pentatonic: [0, 2, 4, 7, 9],
  fifths:     [0, 7],
};

/* Each archetype is a shape, not a phrase:

     chords    candidate degree sets, one picked per draw
     root      MIDI note the degrees are measured from (a range to pick in)
     contour   how the walk moves through the degrees
     count     how many notes
     step      how many degrees each note moves
     len       frames per note before shaping
     shape     "even" | "accel" (notes shorten) | "ritard" (notes lengthen)
     tail      multiplier on the last note -- what makes a chime land
     pause     chance of a short rest before that last note
     tie       chance of tying a note into the next (one swell, stepped pitch)
     macro     timbre + envelope the notes are struck with
*/
export const CHIME_ARCHETYPES = [
  {
    key: "victory", label: "Victory", hint: "fanfare", channel: "pulse1",
    chords: ["major", "major6", "major7"], root: [67, 74], contour: "up",
    count: [4, 6], step: [1, 2], len: [5, 8], shape: "even", tail: [4, 6],
    pause: 0.35, tie: 0.1,
    macro: { punch: [0.7, 0.9], decay: [0.12, 0.22], sustain: [0.25, 0.45], duty: [2, 2] },
  },
  {
    key: "sad", label: "Sad", hint: "fail", channel: "pulse2",
    chords: ["minor", "minor7", "dim"], root: [64, 71], contour: "down",
    count: [3, 5], step: [1, 2], len: [9, 13], shape: "ritard", tail: [3, 5],
    pause: 0.15, tie: 0.35,
    macro: { punch: [0.45, 0.65], decay: [0.18, 0.3], sustain: [0.1, 0.25], duty: [1, 1] },
  },
  {
    key: "ui", label: "UI", hint: "confirm", channel: "pulse2",
    chords: ["fifths", "sus4", "major"], root: [77, 84], contour: "up",
    count: [2, 3], step: [1, 1], len: [3, 5], shape: "even", tail: [1, 2],
    pause: 0, tie: 0,
    macro: { punch: [0.8, 0.95], decay: [0.45, 0.7], sustain: [0, 0], duty: [1, 1] },
  },
  {
    key: "itemget", label: "Item get", hint: "flourish", channel: "pulse1",
    chords: ["major", "pentatonic"], root: [76, 82], contour: "up",
    count: [3, 4], step: [1, 2], len: [4, 6], shape: "accel", tail: [3, 4],
    pause: 0, tie: 0.15,
    macro: { punch: [0.8, 0.95], decay: [0.35, 0.5], sustain: [0, 0.1], duty: [2, 2] },
  },
  {
    key: "levelup", label: "Level up", hint: "ascend", channel: "pulse1",
    chords: ["pentatonic", "major7"], root: [64, 70], contour: "updown",
    count: [6, 8], step: [1, 1], len: [4, 6], shape: "accel", tail: [5, 7],
    pause: 0.2, tie: 0.2,
    macro: { punch: [0.6, 0.8], decay: [0.1, 0.2], sustain: [0.3, 0.5], duty: [2, 3] },
  },
  {
    key: "alert", label: "Alert", hint: "warning", channel: "pulse2",
    chords: ["fifths", "dim"], root: [72, 79], contour: "alt",
    count: [4, 6], step: [1, 1], len: [7, 10], shape: "even", tail: [1, 1],
    pause: 0, tie: 0,
    macro: { punch: [0.7, 0.85], decay: [0.3, 0.45], sustain: [0, 0.15], duty: [0, 1] },
  },
];

export function chimeArchetype(key) {
  return CHIME_ARCHETYPES.find(a => a.key === key) || CHIME_ARCHETYPES[0];
}

/* ---- the draw ---- */

// Every archetype field that varies is written as a [low, high] range.
function pick(rng, list) { return list[Math.floor(rng() * list.length) % list.length]; }
function pickInt(rng, range) { return range[0] + Math.floor(rng() * (range[1] - range[0] + 1)); }
function pickF(rng, range) { return range[0] + rng() * (range[1] - range[0]); }

// Walk a degree set past its own length: index 4 of a three-note chord is the
// root an octave up. Negative indices walk down the same way.
function degreeAt(chord, i) {
  const n = chord.length;
  const wrapped = ((i % n) + n) % n;
  return chord[wrapped] + 12 * Math.floor(i / n);
}

// The index the walk sits on for each note of the phrase.
function contourIndices(contour, count, step, rng) {
  const idx = [];
  switch (contour) {
    case "down":
      for (let i = 0; i < count; i++) idx.push((count - 1 - i) * step);
      break;
    case "updown": {
      // Up to a peak two thirds of the way in, then fall back a little: the
      // "level up" shape, which lands above where it started.
      const peak = Math.max(1, Math.round(count * 0.66));
      for (let i = 0; i < count; i++) idx.push((i <= peak ? i : peak - (i - peak)) * step);
      break;
    }
    case "alt": {
      // Two notes traded back and forth -- a siren rather than a run.
      const hi = step + 1;
      for (let i = 0; i < count; i++) idx.push(i % 2 === 0 ? 0 : hi);
      break;
    }
    case "flat":
      for (let i = 0; i < count; i++) idx.push(0);
      break;
    default: // "up"
      for (let i = 0; i < count; i++) idx.push(i * step);
      // A rising run that repeats its first interval once reads as more of a
      // tune and less of a scale; take it now and then.
      if (count > 3 && rng() < 0.3) idx[1] = idx[0];
      break;
  }
  return idx;
}

// Widest a chime may reach, low note to high: an octave and a fifth.
// A full major arpeggio over two octaves (C E G C E G) is the ceiling; the
// draws that used to overshoot it climbed two and a half.
const MAX_CHIME_SPAN = 19;

function chordSpan(chord, idx) {
  const pitches = idx.map(i => degreeAt(chord, i));
  return Math.max.apply(null, pitches) - Math.min.apply(null, pitches);
}

// Per-note length before the tail: `shape` bends the phrase's pacing.
function shapeLen(shape, base, i, count) {
  if (count < 2) return base;
  const t = i / (count - 1);
  if (shape === "accel") return base * (1 - 0.35 * t);
  if (shape === "ritard") return base * (1 + 0.6 * t);
  return base;
}

/* Generate one chime. Returns the pieces of a sequence layer -- channel,
   timbre macro, and the notes -- plus the archetype/seed it came from, so the
   sequencer can re-roll it. Pure and deterministic in (key, seed). */
export function generateChime(key, seed) {
  const a = chimeArchetype(key);
  const rng = makeRng(seed >>> 0);

  const chord = CHORDS[pick(rng, a.chords)] || CHORDS.major;
  const root = pickInt(rng, a.root);
  const count = pickInt(rng, a.count);
  const step = pickInt(rng, a.step);
  const baseLen = pickInt(rng, a.len);
  const tail = pickF(rng, a.tail);

  // A walk with a wide step and many notes can climb two and a half octaves,
  // which stops reading as one gesture and starts sounding like a scale
  // exercise. Narrow the step until the phrase fits the ceiling above.
  let idx = contourIndices(a.contour, count, step, rng);
  for (let s = step; s > 1 && chordSpan(chord, idx) > MAX_CHIME_SPAN; s--) {
    idx = contourIndices(a.contour, count, s - 1, rng);
  }

  const notes = [];
  idx.forEach((degreeIndex, i) => {
    const last = i === count - 1;
    // A short rest just before the final note is what turns a run into a
    // phrase with a landing. Only where the archetype asks for one.
    if (last && a.pause > 0 && rng() < a.pause) {
      notes.push(makeNote({ rest: true, len: Math.max(2, Math.round(baseLen * 0.6)), vol: 0 }));
    }
    const len = clampInt(
      Math.round(shapeLen(a.shape, baseLen, i, count) * (last ? tail : 1)),
      1, MAX_NOTE_FRAMES,
    );
    // First and last notes carry the accent; the middle sits a little under
    // so the landing reads as the loudest thing in the chime.
    const accent = (i === 0 || last) ? 15 : 11 + Math.floor(rng() * 3);
    notes.push(makeNote({
      note: clampInt(root + degreeAt(chord, degreeIndex), 24, 108),
      len,
      vol: accent,
      // Never tie the last note: there is nothing after it to carry into.
      tie: !last && rng() < a.tie,
    }));
  });

  const macro = makeMacro({
    lengthMs: 240,
    baseNote: root,
    punch: clampf(pickF(rng, a.macro.punch), 0, 1),
    decay: clampf(pickF(rng, a.macro.decay), 0, 1),
    sustain: clampf(pickF(rng, a.macro.sustain), 0, 1),
    duty: pickInt(rng, a.macro.duty),
  });

  return { archetype: a.key, seed: seed >>> 0, channel: a.channel, macro, notes };
}

/* Build a ready-to-use sequence layer from an archetype draw. `chime` is kept
   on the layer so "re-roll" knows what to draw again; it is an extra field the
   converter and the game ignore, and hand-editing the notes leaves it as a
   record of where they came from. */
export function makeChimeLayer(proj, key, seed) {
  const drawn = generateChime(key, seed);
  const layer = makeLayer(proj, "custom");
  layer.channel = drawn.channel;
  layer.mode = "sequence";
  layer.macro = drawn.macro;
  layer.notes = drawn.notes;
  layer.chime = { archetype: drawn.archetype, seed: drawn.seed };
  return layer;
}

/* Re-roll an existing chime layer in place: new notes and timbre from the same
   archetype, everything else (channel choice aside) left alone. A layer with
   no `chime` record was authored by hand, so there is nothing to re-roll. */
export function rerollChimeLayer(layer, seed) {
  if (!layer.chime) return false;
  const drawn = generateChime(layer.chime.archetype, seed);
  layer.channel = drawn.channel;
  layer.macro = drawn.macro;
  layer.notes = drawn.notes;
  layer.chime = { archetype: drawn.archetype, seed: drawn.seed };
  return true;
}
