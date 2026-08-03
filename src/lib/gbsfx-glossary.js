/*
  gbsfx-glossary.js - what every word in the two sound tools means.

  The sound tools are full of borrowed vocabulary: decay, duty, envelope,
  LFSR, tie. Someone who has designed sound before reads those as labels;
  everyone else reads them as noise. So every term the tools put on screen has
  an entry here, and the UI underlines it with a dashed line, blurbs it on
  hover and opens the full entry on click (`gbsfx-glossary-ui.js`).

  An entry is deliberately four things, in this order:

    short      one sentence, the hover blurb -- what it does to the sound
    plain      the definition in everyday words, no register talk
    example    what a value actually sounds like, in game terms
    hardware   the bridge to the register table, for when plain isn't enough

  ...plus `demo`, an A/B pair of throwaway effects that differ *only* in the
  term being explained, so it can be heard rather than read. The demos are
  built here but played by the UI: this module stays free of Web Audio and the
  DOM so it can be unit-tested (`gbsfx-glossary.test.js`).

  Definitions are shared by both tools -- one term, one definition, no drift.
*/

import { DEFAULT_TICK_HZ, makeMacro, makeNote } from "./gbsfx-core.js";

/* ============================================================
   Demo effects
   ============================================================
   Every demo starts from one neutral tone so an A/B pair differs in exactly
   the thing under discussion. They are throwaway objects shaped like a real
   effect (the compiler and the audio engine take them as-is); nothing here
   touches the sound the user is editing.
*/

const BASE_MACRO = {
  lengthMs: 420, baseNote: 81, noiseTone: 8,
  bend: 0, bendAmount: 0, jump: 0, jumpAt: 0.3,
  punch: 0.7, decay: 0.35, sustain: 0,
  duty: 2, width: 1, vibratoRate: 0, vibratoDepth: 0,
};

let demoId = 0;

/* A demo effect. `spec.layers` is a list of partial layers -- give a `notes`
   array for a sequence layer, `macro` overrides for a single-tone one. */
export function demoEffect(spec) {
  const layers = (spec.layers || [{}]).map((l) => ({
    id: ++demoId,
    channel: l.channel || "pulse2",
    category: "custom",
    mode: l.notes ? "sequence" : "macro",
    macro: makeMacro(Object.assign({}, BASE_MACRO, l.macro)),
    wavePreset: l.wavePreset || "triangle",
    gain: l.gain == null ? 1 : l.gain,
    steps: null,
    notes: l.notes ? l.notes.map(makeNote) : null,
  }));
  return {
    id: 0,
    name: "glossary_demo",
    seed: 1,
    tickHz: spec.tickHz || DEFAULT_TICK_HZ,
    layers,
  };
}

// The common case: one single-tone layer with a few macro fields changed.
const tone = (macro, channel) => demoEffect({ layers: [{ channel, macro }] });

// The other common case: one sequence layer of notes on the default voice.
const phrase = (notes, macro) => demoEffect({
  layers: [{ macro: Object.assign({ punch: 0.8, decay: 0.5 }, macro), notes }],
});

const ab = (aLabel, aEffect, bLabel, bEffect) => ({
  a: { label: aLabel, build: () => aEffect() },
  b: { label: bLabel, build: () => bEffect() },
});

/* ============================================================
   The terms
   ============================================================
   `group` is only used by the browse-all Glossary modal; the order below is
   the order it lists them in.
*/

export const GLOSSARY_GROUPS = [
  { key: "shape", label: "Shaping the sound" },
  { key: "pitch", label: "Pitch and movement" },
  { key: "voice", label: "Voices and channels" },
  { key: "sequence", label: "Notes and sequences" },
  { key: "hood", label: "Under the hood" },
];

const ENTRIES = [
  /* ---- shaping the sound ---- */
  {
    key: "length",
    term: "Length",
    group: "shape",
    short: "How long the sound lasts, in milliseconds.",
    plain: [
      "The total running time of this layer, from the moment it triggers to the moment it stops.",
      "Everything else is measured as a fraction of this: the fade, the pitch slide, the wobble. So stretching the length stretches the whole shape rather than tacking silence onto the end.",
    ],
    example: "A menu blip is 60-120 ms. A coin is around 250 ms. An explosion tail runs 700 ms or more.",
    hardware: "Decides how many frames the compiled program runs for (length x tick rate / 1000), capped at 300.",
    demo: ab(
      "90 ms - a blip", () => tone({ lengthMs: 90, decay: 0.5 }),
      "900 ms - a long tone", () => tone({ lengthMs: 900, decay: 0.08 }),
    ),
  },
  {
    key: "punch",
    term: "Punch",
    group: "shape",
    short: "How hard the sound hits on its very first frame - the attack.",
    plain: [
      "High punch starts at full volume immediately, which the ear reads as an impact. Low punch eases in, which reads as something swelling or arriving.",
      "It sets both how sharp the attack is and how loud the sound gets at its peak.",
    ],
    example: "A hit or an explosion wants punch near 1. A magic shimmer coming into being wants it near 0.1.",
    hardware: "Sets the starting volume in the envelope byte NRx2 (bits 4-7) and how quickly the sound reaches it.",
    demo: ab(
      "Soft - swells in", () => tone({ punch: 0.05, decay: 0.08, lengthMs: 700 }),
      "Hard - hits at once", () => tone({ punch: 1, decay: 0.08, lengthMs: 700 }),
    ),
  },
  {
    key: "decay",
    term: "Decay",
    group: "shape",
    short: "How fast the sound fades out after it starts.",
    plain: [
      "Once the attack has landed, decay decides how quickly the volume falls away.",
      "Fast decay gives short, dry, percussive sounds. Slow decay leaves a tail that rings on. At zero the sound holds its volume until Length runs out.",
    ],
    example: "0.9 is a coin blip that is gone instantly. 0.1 is an explosion tail that rolls out and away.",
    hardware: "Sets the envelope step time in NRx2 (bits 0-2, direction in bit 3) - the chip fades the channel with no help from the CPU.",
    demo: ab(
      "Slow - a long tail", () => tone({ decay: 0.05, lengthMs: 900 }),
      "Fast - gone at once", () => tone({ decay: 0.9, lengthMs: 900 }),
    ),
  },
  {
    key: "sustain",
    term: "Sustain",
    group: "shape",
    short: "The volume floor the fade settles onto instead of silence.",
    plain: [
      "Decay pulls the volume down; sustain says how far down it is allowed to go.",
      "At zero the sound decays away to nothing. Raise it and the sound drops to a quieter level and holds there until Length runs out - the difference between a note that dies and a note that is being held.",
    ],
    example: "An alarm, an engine or a held organ note wants a high sustain. A drum hit wants zero.",
    hardware: "The tool's own idea, not the chip's: the compiler simply stops stepping the envelope down once it reaches the floor.",
    demo: ab(
      "0.00 - fades to nothing", () => tone({ sustain: 0, decay: 0.6, lengthMs: 900 }),
      "0.55 - holds a level", () => tone({ sustain: 0.55, decay: 0.6, lengthMs: 900 }),
    ),
  },
  {
    key: "envelope",
    term: "Envelope",
    group: "shape",
    short: "The volume shape of a sound over time: attack, fade, floor.",
    plain: [
      "Punch, Decay and Sustain together are the envelope - how fast the sound gets loud, how fast it gets quiet again, and where it stops on the way down.",
      "It is the cheapest way to give a sound a character, because once it is set the sound chip runs it without any further work.",
    ],
    example: "Sharp attack plus fast decay is a hit. Slow attack with no decay is a swell. Same note either way.",
    hardware: "One byte, NRx2: a starting volume, a direction, and a step time.",
    demo: ab(
      "Sharp - a hit", () => tone({ punch: 1, decay: 0.85, lengthMs: 700 }),
      "Flat - a held tone", () => tone({ punch: 0.15, decay: 0, sustain: 1, lengthMs: 700 }),
    ),
  },

  /* ---- pitch and movement ---- */
  {
    key: "pitch",
    term: "Pitch",
    group: "pitch",
    short: "How high or low the sound is - the note it starts on.",
    plain: [
      "On the three pitched channels this is a musical note (C4, A5 and so on): where the sound starts, before any bend, jump or vibrato moves it. The number is the octave, so A5 is an octave above A4.",
      "The noise channel has no notes, so there Pitch means how coarse the static is instead: low values rumble, high values hiss.",
    ],
    example: "High reads as small and bright - a coin, a UI beep. Low reads as big and heavy - a door, a thud.",
    hardware: "Pitched: a MIDI note turned into an 11-bit frequency period across NRx3/NRx4. Noise: the clock shift and divisor in NR43.",
    demo: ab(
      "Low - A3", () => tone({ baseNote: 57 }),
      "High - A6", () => tone({ baseNote: 93 }),
    ),
  },
  {
    key: "bend",
    term: "Bend",
    group: "pitch",
    short: "Whether the pitch slides up or down while the sound plays.",
    plain: [
      "A tone that holds one pitch sounds static; a tone that slides sounds like it is doing something.",
      "Bend is the direction and how much of the slide is used: negative slides down over the sound's length, positive slides up, zero holds still. How far it slides is Bend amt.",
    ],
    example: "Lasers bend hard down. Jumps bend up. An explosion bends slowly down as it collapses.",
    hardware: "Pulse 1 has a real hardware sweep, but this tool writes the slide into the frequency registers frame by frame instead - which works on any channel, at a register write per frame.",
    demo: ab(
      "Down - a laser", () => tone({ bend: -0.9, bendAmount: 0.6, lengthMs: 500 }),
      "Up - a jump", () => tone({ bend: 0.9, bendAmount: 0.6, lengthMs: 500 }),
    ),
  },
  {
    key: "bend-amount",
    term: "Bend amt",
    group: "pitch",
    short: "How far the pitch slides. Bend picks the direction, this picks the distance.",
    plain: [
      "Scales the slide from a barely-there waver at 0 to roughly three octaves at 1.",
      "It does nothing on its own - with Bend at zero there is no slide to size.",
    ],
    example: "0.2 is a small drop that just reads as weight. 0.9 is a full laser dive.",
    hardware: "0..1 maps to about 36 semitones of glide spread across the sound's frames.",
    demo: ab(
      "0.15 - a small drop", () => tone({ bend: -1, bendAmount: 0.15, lengthMs: 500 }),
      "0.90 - a long dive", () => tone({ bend: -1, bendAmount: 0.9, lengthMs: 500 }),
    ),
  },
  {
    key: "jump",
    term: "Jump",
    group: "pitch",
    short: "A one-off pitch step part-way through, counted in semitones.",
    plain: [
      "Where Bend is a continuous slide, Jump is a single hop: the pitch snaps up or down by this many semitones when the sound reaches the point set by Jump at, and stays there.",
      "It is what makes a coin sound like two notes rather than one. Twelve semitones is an octave; seven is a fifth.",
    ],
    example: "+7 or +12 is the classic pickup. Negative values drop instead, which sounds like a fail.",
    hardware: "Added to the note before the frequency period is worked out, so it costs nothing extra.",
    demo: ab(
      "0 - one note", () => tone({ jump: 0, jumpAt: 0.35 }),
      "+12 - hops an octave", () => tone({ jump: 12, jumpAt: 0.35 }),
    ),
  },
  {
    key: "jump-at",
    term: "Jump at",
    group: "pitch",
    short: "How far into the sound the Jump happens, from 0 (start) to 1 (end).",
    plain: [
      "0.25 means a quarter of the way through. An early jump sounds like two quick notes; a late one sounds like a tail flicking up at the end.",
      "It has no effect while Jump is zero.",
    ],
    example: "0.3 with +7 semitones is the standard coin. 0.8 turns the hop into a flourish on the way out.",
    hardware: "Just an index into the compiled frame list - no register cost at all.",
    demo: ab(
      "0.15 - hops early", () => tone({ jump: 12, jumpAt: 0.15, lengthMs: 700, decay: 0.1 }),
      "0.75 - hops late", () => tone({ jump: 12, jumpAt: 0.75, lengthMs: 700, decay: 0.1 }),
    ),
  },
  {
    key: "vibrato-rate",
    term: "Vib rate",
    group: "pitch",
    short: "How fast the pitch wobbles.",
    plain: [
      "Vibrato is a small repeated wave up and down in pitch. Rate is its speed, from a slow drift at low values to a fast warble of about 24 wobbles a second at 1.",
      "You will hear nothing at all until Vib depth is also above zero.",
    ],
    example: "Slow is a wooden creak or a ghostly waver. Fast is an arcade power-up or an alarm.",
    hardware: "Worked out per frame and folded into the frequency write - a software effect, not something the chip does.",
    demo: ab(
      "Slow - a drift", () => tone({ vibratoRate: 0.12, vibratoDepth: 0.7, decay: 0.04, lengthMs: 900 }),
      "Fast - a warble", () => tone({ vibratoRate: 0.85, vibratoDepth: 0.7, decay: 0.04, lengthMs: 900 }),
    ),
  },
  {
    key: "vibrato-depth",
    term: "Vib depth",
    group: "pitch",
    short: "How far the pitch wobbles - the size of the warble.",
    plain: [
      "Sets how many semitones the vibrato swings through, up to about two at full.",
      "Small depths add life to a held note without changing which note it is. Large depths turn the wobble into the point of the sound.",
    ],
    example: "0.1 is a note with a little life in it. 0.9 is a siren.",
    hardware: "Same software path as Vib rate: the swing is added to the note before the frequency is computed.",
    demo: ab(
      "0.15 - a little life", () => tone({ vibratoRate: 0.5, vibratoDepth: 0.15, decay: 0.04, lengthMs: 900 }),
      "1.00 - a siren", () => tone({ vibratoRate: 0.5, vibratoDepth: 1, decay: 0.04, lengthMs: 900 }),
    ),
  },

  /* ---- voices and channels ---- */
  {
    key: "tone",
    term: "Tone",
    group: "voice",
    short: "The character of the voice - thin, full, buzzy, hissy.",
    plain: [
      "Pitch decides which note; Tone decides what that note sounds like. What it offers depends on the channel.",
      "On the pulse channels it is the duty cycle - how much of each cycle the wave spends switched on. 12.5% is thin and nasal, 25% is reedy, 50% is the full hollow square, and 75% sounds the same as 25% (the wave is just upside down).",
      "On the wave channel it picks a wavetable: sine is soft and flute-like, triangle mellow, saw buzzy, square hard, organ hollow.",
      "On the noise channel it picks the texture of the static: 15-bit hiss is broad and airy (steam, wind, an explosion), 7-bit metallic is short and ringing (a clang, a robot, a coin hitting stone).",
    ],
    example: "One note, three tones: 12.5% chirps, 50% is the classic Game Boy lead, a saw wavetable growls.",
    hardware: "Pulse: duty bits 6-7 of NRx1. Wave: the 32-step table copied into wave RAM. Noise: the LFSR width bit in NR43.",
    demo: ab(
      "Pulse 12.5% - thin", () => tone({ duty: 0, lengthMs: 600, decay: 0.1 }),
      "Pulse 50% - full", () => tone({ duty: 2, lengthMs: 600, decay: 0.1 }),
    ),
  },
  {
    key: "layer",
    term: "Layer",
    group: "voice",
    short: "One channel's worth of sound. An effect can stack several at once.",
    plain: [
      "Each layer is one of the four channels playing its own thing at the same time as the others.",
      "Stacking is how a single effect gets both a body and an edge - a noise layer under a pulse layer is the standard impact-plus-tone recipe. Layers play together, export together, and each costs its own register writes.",
    ],
    example: "An explosion: a noise layer for the blast, a low pulse layer beneath it for the weight.",
    hardware: "The four channels are independent hardware; a layer is simply your claim on one of them for the duration of the effect.",
    demo: ab(
      "One layer - a tone", () => demoEffect({ layers: [{ channel: "pulse2", macro: { baseNote: 60, decay: 0.25, lengthMs: 600 } }] }),
      "Two layers - tone + noise", () => demoEffect({
        layers: [
          { channel: "pulse2", macro: { baseNote: 60, decay: 0.25, lengthMs: 600 } },
          { channel: "noise", macro: { noiseTone: 6, punch: 1, decay: 0.5, lengthMs: 600 } },
        ],
      }),
    ),
  },
  {
    key: "channel-pulse1",
    term: "Pulse 1",
    group: "voice",
    short: "A square-wave voice with a hardware pitch sweep - the lead.",
    plain: [
      "One of two identical square-wave channels, except that Pulse 1 alone can slide its own pitch in hardware.",
      "Bright and cutting: melodies, coins, lasers and jumps mostly live here. If a sound is built around a big pitch slide, this is the cheapest channel to put it on.",
    ],
    example: "The laser preset lands here by default, and so does the coin.",
    hardware: "NR10-NR14. NR10 is the sweep unit no other channel has.",
    demo: ab(
      "Plain tone", () => tone({ lengthMs: 500 }, "pulse1"),
      "Its speciality - a sweep", () => tone({ bend: -0.9, bendAmount: 0.6, lengthMs: 500 }, "pulse1"),
    ),
  },
  {
    key: "channel-pulse2",
    term: "Pulse 2",
    group: "voice",
    short: "The second square-wave voice - the same sound, without the sweep.",
    plain: [
      "Identical to Pulse 1 apart from the missing sweep unit.",
      "Having a second square voice is what lets a UI beep play without interrupting the melody, or lets two pulses harmonise.",
    ],
    example: "Short blips that do not slide belong here, leaving Pulse 1 free for whatever does.",
    hardware: "NR21-NR24. Note there is no NR20 - the register slot exists but does nothing.",
    demo: ab(
      "One pulse", () => tone({ baseNote: 76, lengthMs: 600, decay: 0.15 }, "pulse2"),
      "Two pulses, a fifth apart", () => demoEffect({
        layers: [
          { channel: "pulse1", macro: { baseNote: 76, lengthMs: 600, decay: 0.15 } },
          { channel: "pulse2", macro: { baseNote: 83, lengthMs: 600, decay: 0.15 } },
        ],
      }),
    ),
  },
  {
    key: "channel-wave",
    term: "Wave",
    group: "voice",
    short: "A voice that plays a 32-step waveform you supply - softer, rounder.",
    plain: [
      "Instead of a fixed square, this channel reads a table of 32 volume steps, so its character is whatever shape you load into it.",
      "It is the mellow voice - bass lines, bells, pads - and the only one whose timbre you can define outright rather than choose from a list of four.",
    ],
    example: "A sine table is a soft flute; a saw table buzzes; an organ shape sounds hollow and church-like.",
    hardware: "NR30-NR34, plus 16 bytes of wave RAM holding the table (two steps per byte).",
    demo: ab(
      "Sine - soft", () => demoEffect({ layers: [{ channel: "wave", wavePreset: "sine", macro: { baseNote: 69, lengthMs: 700, decay: 0.1 } }] }),
      "Saw - buzzy", () => demoEffect({ layers: [{ channel: "wave", wavePreset: "saw", macro: { baseNote: 69, lengthMs: 700, decay: 0.1 } }] }),
    ),
  },
  {
    key: "channel-noise",
    term: "Noise",
    group: "voice",
    short: "The percussion voice: static rather than a note.",
    plain: [
      "Noise has no pitch, only a texture - a pseudo-random stream of bits whose speed you set. Slow settings rumble, fast ones hiss.",
      "Every drum, explosion, footstep, gust of wind and impact in a Game Boy game comes from here.",
    ],
    example: "A short, fast, hard-decaying noise is a hit. A long, slow, soft one is a distant boom.",
    hardware: "NR41-NR44. The randomness comes from an LFSR (linear-feedback shift register), which is why its width is a setting.",
    demo: ab(
      "15-bit - a rumble", () => tone({ noiseTone: 4, width: 1, punch: 1, decay: 0.25, lengthMs: 700 }, "noise"),
      "7-bit - metallic", () => tone({ noiseTone: 11, width: 0, punch: 1, decay: 0.25, lengthMs: 700 }, "noise"),
    ),
  },

  /* ---- notes and sequences ---- */
  {
    key: "sequence",
    term: "Sequence",
    group: "sequence",
    short: "A layer that plays a list of notes instead of a single tone.",
    plain: [
      "A single-tone layer is one strike, shaped by sliders. A sequence layer is a little melody: a list of notes, each with its own pitch, length and volume, all played through the same voice and envelope.",
      "Fanfares, jingles and item chimes are sequences. Hits, lasers and blips are single tones - which is why they live in two separate tools.",
    ],
    example: "The victory jingle is a sequence; the sword swing that precedes it is a single tone.",
    hardware: "Each note re-triggers the channel; only what changes is written, so a sequence costs little more than a long tone.",
    demo: ab(
      "One tone", () => tone({ baseNote: 72, lengthMs: 600, decay: 0.2 }),
      "A four-note sequence", () => phrase([
        { note: 72, len: 8 }, { note: 76, len: 8 }, { note: 79, len: 8 }, { note: 84, len: 20 },
      ]),
    ),
  },
  {
    key: "note",
    term: "Note",
    group: "sequence",
    short: "One entry in a sequence: a pitch, a length and a volume.",
    plain: [
      "Notes play in order, each for its own number of frames. On the pitched channels a note is written like C5 or F#4 - the number is the octave, so C5 is an octave above C4.",
      "On the noise channel a note has no pitch at all, only a tone value from 0 to 15.",
    ],
    example: "Drag a note up in the roll to transpose it, or drag its right edge to make it last longer.",
    hardware: "A note becomes a frequency period plus a trigger, written on its first frame; the frames after it write nothing.",
    demo: ab(
      "Rising - C5 E5 G5", () => phrase([{ note: 72, len: 10 }, { note: 76, len: 10 }, { note: 79, len: 18 }]),
      "Falling - G5 E5 C5", () => phrase([{ note: 79, len: 10 }, { note: 76, len: 10 }, { note: 72, len: 18 }]),
    ),
  },
  {
    key: "rest",
    term: "Rest",
    group: "sequence",
    short: "A slot in the sequence that stays silent - a gap in the phrase.",
    plain: [
      "A rest takes up its length like any other note but writes nothing at all, so the channel falls quiet for that long.",
      "Rests are what give a jingle its rhythm. Without them every note runs straight into the next one.",
    ],
    example: "Two notes, a rest, then a third - the pause is what makes the third one land.",
    hardware: "Costs nothing: the rest's frames are folded into a single hold in the exported data.",
    demo: ab(
      "No rest - runs together", () => phrase([
        { note: 72, len: 8 }, { note: 76, len: 8 }, { note: 79, len: 8 }, { note: 84, len: 16 },
      ]),
      "With a rest before the last", () => phrase([
        { note: 72, len: 8 }, { note: 76, len: 8 }, { note: 79, len: 8, rest: true }, { note: 84, len: 16 },
      ]),
    ),
  },
  {
    key: "tie",
    term: "Tie",
    group: "sequence",
    short: "Play the next note without re-striking it - a glide, not a fresh hit.",
    plain: [
      "Normally every note re-triggers the channel, which restarts the envelope so you hear a new attack each time.",
      "A tied note skips that: the volume carries on falling from where it was and only the pitch changes. It is how you write a held note that bends, or a smooth run with no click between the steps.",
    ],
    example: "Tie a run of short notes together and it reads as one sliding tone rather than five taps.",
    hardware: "Skips the trigger bit in NRx4, so the envelope keeps running instead of restarting.",
    demo: ab(
      "Untied - four taps", () => phrase([
        { note: 72, len: 8 }, { note: 74, len: 8 }, { note: 76, len: 8 }, { note: 79, len: 24 },
      ], { decay: 0.25 }),
      "Tied - one gliding tone", () => phrase([
        { note: 72, len: 8, tie: true }, { note: 74, len: 8, tie: true }, { note: 76, len: 8, tie: true }, { note: 79, len: 24 },
      ], { decay: 0.25 }),
    ),
  },
  {
    key: "volume",
    term: "Volume",
    group: "sequence",
    short: "How loud one note of a sequence is struck, from 0 to 15.",
    plain: [
      "Each note carries its own attack volume, so a phrase can be shaped without touching the layer's envelope - accenting the first note, or fading the last few away.",
      "The layer's Punch still sets the ceiling; a note's volume scales within it.",
    ],
    example: "Step the volume down through a four-note run and the phrase sounds like it is walking away.",
    hardware: "Scales the starting volume written into NRx2 when that note triggers.",
    demo: ab(
      "Even - all 15", () => phrase([
        { note: 72, len: 10, vol: 15 }, { note: 76, len: 10, vol: 15 }, { note: 79, len: 10, vol: 15 }, { note: 84, len: 16, vol: 15 },
      ]),
      "Fading - 15 down to 4", () => phrase([
        { note: 72, len: 10, vol: 15 }, { note: 76, len: 10, vol: 11 }, { note: 79, len: 10, vol: 7 }, { note: 84, len: 16, vol: 4 },
      ]),
    ),
  },
  {
    key: "archetype",
    term: "Archetype",
    group: "sequence",
    short: "The shape a generated chime is drawn from - a set of rules, not a stored tune.",
    plain: [
      "Each archetype (victory fanfare, fail sting, item pickup and so on) describes direction, intervals and rhythm rather than a fixed melody.",
      "Pressing the button again draws another phrase obeying the same rules, so you can roll until one fits without ever leaving the mood you asked for.",
    ],
    example: "'Victory fanfare' always rises and lands on a strong note. Every draw is a different tune that does exactly that.",
    hardware: "Pure authoring: by the time it reaches the ROM it is an ordinary sequence of notes.",
  },
  {
    key: "seed",
    term: "Seed",
    group: "sequence",
    short: "The number that makes a random draw repeatable.",
    plain: [
      "Randomize and the chime generator do not invent from nothing - they run a fixed recipe starting from this number. The same seed always produces the same sound.",
      "It is saved with the file as a record of where the sound came from. Editing notes by hand afterwards leaves the seed behind as history rather than a recipe.",
    ],
    example: "Rolled something you liked and then rolled past it? Typing its seed back in brings it straight back.",
    hardware: "Never reaches the ROM; it exists only in the .gbsfx.json source.",
  },

  /* ---- under the hood ---- */
  {
    key: "frame",
    term: "Frame",
    group: "hood",
    short: "One step of the sound - a sixtieth of a second at the default tick rate.",
    plain: [
      "Everything here compiles down to a list of frames, and each frame may write new values to the channel's registers.",
      "The Game Boy draws about 60 frames a second, so 60 frames is one second of sound. Note lengths in the sequencer are counted in frames, and the size of the exported data is roughly the number of frames that actually change something.",
    ],
    example: "A 6-frame note is a tenth of a second - a tick. A 90-frame note is a second and a half - a held chime.",
    hardware: "One frame is one call to sfx_update; a frame where nothing changes costs one hold byte, not a full register write.",
  },
  {
    key: "tick-rate",
    term: "Tick rate",
    group: "hood",
    short: "How many times a second the effect steps to its next frame.",
    plain: [
      "The sound is a list of frames and this is how fast the player walks through them.",
      "60 Hz is one step per screen refresh, which is what the Game Boy runs at and what you almost always want. Lower rates stretch the sound out and make its steps audible - and make the data smaller.",
    ],
    example: "Leave it at 60 unless you actually want the chunky, stepped sound of a slower rate.",
    hardware: "The exported player advances one frame per call; the tick rate is your promise to call it that often.",
    demo: ab(
      "60 Hz - smooth", () => demoEffect({ tickHz: 60, layers: [{ macro: { bend: -0.9, bendAmount: 0.7, lengthMs: 800, decay: 0.05 } }] }),
      "15 Hz - stepped", () => demoEffect({ tickHz: 15, layers: [{ macro: { bend: -0.9, bendAmount: 0.7, lengthMs: 800, decay: 0.05 } }] }),
    ),
  },
  {
    key: "registers",
    term: "Registers",
    group: "hood",
    short: "The five hardware bytes per channel that your sound really writes.",
    plain: [
      "The sound chip has no idea what punch or decay are. Each channel is five bytes: NRx0 (the sweep, on Pulse 1 only), NRx1 (length and duty), NRx2 (the volume envelope), NRx3 (the low bits of the frequency) and NRx4 (the high bits plus the trigger that starts the note).",
      "Everything in this tool is a friendly way of choosing values for those five bytes. The table shows what a few frames of your sound come out as.",
    ],
    example: "A row of dashes is a frame that writes nothing - whatever was already playing simply carries on.",
    hardware: "The x is the channel: NR10-NR14 Pulse 1, NR21-NR24 Pulse 2, NR30-NR34 Wave, NR41-NR44 Noise.",
  },
  {
    key: "macro-manual",
    term: "Macro / manual",
    group: "hood",
    short: "Whether a layer is driven by the sliders or by frames you drew yourself.",
    plain: [
      "A macro layer is described by the sliders: change one and the whole frame list is worked out again from scratch.",
      "Freezing it to manual bakes the frames as they currently stand and lets you draw pitch and volume straight onto the visualization - at the cost of the sliders, which no longer have anything to drive. Undo, or discarding the drawing, is the way back.",
    ],
    example: "Go manual when you want a stutter or a wobble that no combination of sliders will produce.",
    hardware: "Both compile to the same frame list; the difference is only in how that list was arrived at.",
  },
];

export const GLOSSARY = ENTRIES.reduce((map, entry) => {
  map[entry.key] = entry;
  return map;
}, /** @type {Record<string, any>} */ ({}));

export const GLOSSARY_KEYS = ENTRIES.map(e => e.key);

export function glossaryEntry(key) {
  return GLOSSARY[key] || null;
}

// The label to print for a term. Callers may override it (the same entry backs
// "Bend amt" on the slider and "Bend amount" in prose), so this is the default.
export function glossaryTerm(key) {
  const e = GLOSSARY[key];
  return e ? e.term : key;
}

// Entries grouped for the browse-all modal, in the order declared above.
export function glossaryByGroup() {
  return GLOSSARY_GROUPS.map(g => ({
    ...g,
    entries: ENTRIES.filter(e => e.group === g.key),
  }));
}

// The glossary key for a channel id ("pulse1" -> "channel-pulse1").
export function channelTermKey(channel) {
  return "channel-" + channel;
}
