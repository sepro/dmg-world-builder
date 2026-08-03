/*
  gbsfx-core.js - the SFX model, synthesis and export, shared by both sound
  tools (the single-tone SFX generator and the SFX sequencer).

  Nothing here touches the DOM: it is the project format, the macro -> per-frame
  compile pipeline every consumer reads (visualization, Web Audio preview, WAV
  render, C export), and the exporter itself. The two tool engines in
  `src/legacy/` own their own UI and share this file, so a sound authored in
  either compiles to exactly the same bytes.

  The game repo's `tools/gbsfx2c.py` is a byte-for-byte port of the compile and
  emit path below (it is what actually builds the ROM's sound data). Changing
  `compileLayer`, `layerToRegisters` or `buildEffectProgram` here means changing
  it there in the same commit.
*/

import { clampInt } from "./common.js";

/* ============================================================
   Constants and hardware reference tables
   ============================================================ */

export const FORMAT_VERSION = 1;
export const DEFAULT_TICK_HZ = 60;      // effects step once per frame by default
export const MAX_FRAMES = 300;          // safety ceiling for one macro layer (~5 s at 60 Hz)
export const MAX_SEQ_FRAMES = 900;      // ceiling for a whole note sequence (~15 s at 60 Hz)
export const MAX_NOTE_FRAMES = 240;     // ceiling for a single note in a sequence

// The four channels. `base` is the address of the first of the five audio
// registers the C player writes for that channel (0xFF15 / 0xFF1F land on the
// unused NR20 / NR41-1 slots, so a uniform 5-register write is safe).
export const CHANNELS = {
  pulse1: { label: "Pulse 1", role: "square + sweep", dot: "#b8f25a", base: 0xFF10, pitched: true },
  pulse2: { label: "Pulse 2", role: "square",         dot: "#88c070", base: 0xFF15, pitched: true },
  wave:   { label: "Wave",    role: "wavetable",      dot: "#346856", base: 0xFF1A, pitched: true },
  noise:  { label: "Noise",   role: "LFSR",           dot: "#e08a5a", base: 0xFF1F, pitched: false },
};
export const CHANNEL_ORDER = ["pulse1", "pulse2", "wave", "noise"];
export const CHANNEL_INDEX = { pulse1: 0, pulse2: 1, wave: 2, noise: 3 };

// Duty cycles selectable on the two pulse channels (NRx1 bits 6-7).
export const DUTY_LABELS = ["12.5%", "25%", "50%", "75%"];
export const DUTY_FRACTION = [0.125, 0.25, 0.5, 0.75];

// Noise divisor codes -> actual divisor (NR43 bits 0-2).
export const NOISE_DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];

// Wave-channel volume codes (NR32 bits 5-6): 0=mute, 1=100%, 2=50%, 3=25%.
// Index by a "loudness" 0..3 (0 silent, 3 loudest) to get the register code.
export const WAVE_VOLUME_CODE = [0, 3, 2, 1];

function makeWaveTable(kind) {
  const t = new Array(32);
  for (let i = 0; i < 32; i++) {
    const p = i / 32;                       // phase 0..1
    let v;
    switch (kind) {
      case "sine":     v = 0.5 + 0.5 * Math.sin(2 * Math.PI * p); break;
      case "triangle": v = p < 0.5 ? p * 2 : 2 - p * 2; break;
      case "saw":      v = p; break;
      case "square":   v = p < 0.5 ? 1 : 0; break;
      // Two stacked sines make a hollow, organ-ish tone.
      case "organ":    v = 0.5 + 0.3 * Math.sin(2 * Math.PI * p) + 0.2 * Math.sin(4 * Math.PI * p); break;
      default:         v = 0.5;
    }
    t[i] = clampInt(Math.round(v * 15), 0, 15);
  }
  return t;
}

// Named 32-step wavetables (values 0..15) offered on the wave channel.
export const WAVE_PRESETS = {
  sine:     makeWaveTable("sine"),
  triangle: makeWaveTable("triangle"),
  saw:      makeWaveTable("saw"),
  square:   makeWaveTable("square"),
  organ:    makeWaveTable("organ"),
};
export const WAVE_PRESET_NAMES = Object.keys(WAVE_PRESETS);

// The seven classic sfxr-style categories. Each returns a base macro; the
// randomizer jitters around it. `custom` is what a hand-added layer starts from.
export const CATEGORY_LIST = [
  { key: "coin",      label: "Coin",     hint: "pickup" },
  { key: "laser",     label: "Laser",    hint: "shoot" },
  { key: "jump",      label: "Jump",     hint: "hop" },
  { key: "explosion", label: "Explode",  hint: "boom" },
  { key: "hit",       label: "Hit",      hint: "hurt" },
  { key: "powerup",   label: "Power-up", hint: "level" },
  { key: "blip",      label: "Blip",     hint: "select" },
  { key: "custom",    label: "Custom",   hint: "blank" },
];

// Which channel each category prefers. Falling/rising pitch effects want the
// sweep-capable Pulse 1; explosions and hits want Noise.
export const CATEGORY_CHANNEL = {
  coin: "pulse1", laser: "pulse1", jump: "pulse1", powerup: "pulse1",
  blip: "pulse2", explosion: "noise", hit: "noise", custom: "pulse1",
};

/* ============================================================
   Deterministic RNG (mulberry32), matching the music generator's approach
   ============================================================ */

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Symmetric jitter in [-amt, +amt].
export function jitter(rng, amt) { return (rng() * 2 - 1) * amt; }
export function clamp01(x) { return Math.max(0, Math.min(1, x)); }
export function clampf(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
export function randomSeed() { return (Math.random() * 0xffffffff) >>> 0; }

/* ============================================================
   Macro model
   ============================================================
   A macro is the guided, semantic description of a sound. Fields are shared
   across channels; the synthesizer reads whichever ones apply to the layer's
   channel (e.g. `noiseTone`/`width` for noise, `baseNote`/`duty` for pulse).
*/

export function makeMacro(overrides) {
  return Object.assign({
    lengthMs: 240,     // total duration
    baseNote: 81,      // MIDI note for pitched channels (A5 = 880 Hz)
    noiseTone: 8,      // 0..15 rumble..hiss for the noise channel
    bend: 0,           // -1 down .. +1 up: direction+amount of the pitch glide
    bendAmount: 0.4,   // 0..1 -> up to ~36 semitones (or noise steps) of glide
    jump: 0,           // extra semitones added part-way through (coins/power-ups)
    jumpAt: 0.3,       // 0..1 point in the sound where `jump` kicks in
    punch: 0.7,        // 0..1 attack sharpness + peak volume
    decay: 0.4,        // 0..1 how fast the volume falls (0 = sustain)
    sustain: 0.0,      // 0..1 volume floor the decay settles toward
    duty: 2,           // pulse duty index 0..3
    width: 1,          // noise LFSR width: 1 = 15-bit hiss, 0 = 7-bit metallic
    vibratoRate: 0,    // 0..1 -> 0..24 Hz warble
    vibratoDepth: 0,   // 0..1 -> up to 2 semitones
  }, overrides || {});
}

// Per-category starting macros. Kept deliberately punchy and short.
export function categoryMacro(category) {
  switch (category) {
    case "coin":      return makeMacro({ lengthMs: 260, baseNote: 84, bend: 0.25, bendAmount: 0.2, jump: 7, jumpAt: 0.25, punch: 0.7, decay: 0.35, duty: 2 });
    case "laser":     return makeMacro({ lengthMs: 260, baseNote: 93, bend: -0.85, bendAmount: 0.55, punch: 0.9, decay: 0.45, duty: 2 });
    case "jump":      return makeMacro({ lengthMs: 300, baseNote: 72, bend: 0.7, bendAmount: 0.35, punch: 0.6, decay: 0.15, duty: 2 });
    case "explosion": return makeMacro({ lengthMs: 700, noiseTone: 5, bend: -0.6, bendAmount: 0.45, punch: 0.95, decay: 0.22, width: 1 });
    case "hit":       return makeMacro({ lengthMs: 160, noiseTone: 10, bend: -0.2, bendAmount: 0.2, punch: 0.9, decay: 0.6, width: 0 });
    case "powerup":   return makeMacro({ lengthMs: 520, baseNote: 72, bend: 0.55, bendAmount: 0.6, jump: 12, jumpAt: 0.5, punch: 0.6, decay: 0.1, duty: 2, vibratoRate: 0.3, vibratoDepth: 0.15 });
    case "blip":      return makeMacro({ lengthMs: 90, baseNote: 81, bend: 0, bendAmount: 0, punch: 0.85, decay: 0.7, duty: 1 });
    default:          return makeMacro({});
  }
}

/* ============================================================
   Project / effect / layer construction
   ============================================================
   Both tools hold exactly one effect at a time -- exports are one sound per
   file, so a session-long library only ever made "which sound is this?"
   ambiguous. `nextId` still runs so layer ids stay unique within the file.
*/

export function makeProject(effectFactory) {
  const proj = { formatVersion: FORMAT_VERSION, name: "sfx", nextId: 1, effects: [] };
  proj.effects.push(effectFactory(proj));
  proj.name = proj.effects[0].name;
  return proj;
}

export function makeEffect(proj, category) {
  const cat = category || "coin";
  const id = proj.nextId++;
  return {
    id,
    name: defaultEffectName(cat, id),
    seed: randomSeed(),
    tickHz: DEFAULT_TICK_HZ,
    layers: [makeLayer(proj, cat)],
  };
}

export function makeLayer(proj, category) {
  const cat = category || "custom";
  const channel = CATEGORY_CHANNEL[cat] || "pulse1";
  return {
    id: proj.nextId++,
    channel,
    category: cat,
    // "macro" (generated from sliders), "manual" (hand-edited frames), or
    // "sequence" (a list of notes played through the macro's timbre).
    mode: "macro",
    macro: categoryMacro(cat),
    wavePreset: "triangle", // used only when channel === "wave"
    gain: 1,                // playback mix level, not exported to hardware
    steps: null,            // populated when mode === "manual"
    notes: null,            // populated when mode === "sequence"
  };
}

/* A note in a sequence layer. Pitched channels use `note` (MIDI); the noise
   channel uses `noiseTone` (0..15). `len` is the note's length in frames.
   `tie` means "don't re-trigger the note after me": the hardware envelope
   carries on and only the pitch changes, which is how a held or gliding
   phrase is written. `vol` scales the attack volume of this note's trigger
   (0..15), so a phrase can be shaped without touching the layer's macro. */
export function makeNote(overrides) {
  return Object.assign({
    note: 72,
    noiseTone: 8,
    len: 6,
    tie: false,
    vol: 15,
    rest: false,
  }, overrides || {});
}

// Total length of a sequence in frames (what the roll and the C export span).
export function sequenceFrames(layer) {
  const notes = layer.notes || [];
  let total = 0;
  for (let i = 0; i < notes.length; i++) total += clampInt(notes[i].len, 1, MAX_NOTE_FRAMES);
  return Math.min(total, MAX_SEQ_FRAMES);
}

export function defaultEffectName(category, id) {
  const c = CATEGORY_LIST.find(x => x.key === category);
  return (c ? c.label : "SFX").toLowerCase().replace(/[^a-z0-9]/g, "") + "_" + id;
}

// Which kinds of layer an effect holds. The two tools edit one kind each and
// only report the other's presence (with a link across), so nothing a file
// carries is ever silently dropped by opening it in the wrong tool.
export function hasSequenceLayer(effect) {
  return !!effect && effect.layers.some(l => l.mode === "sequence");
}
export function hasSingleToneLayer(effect) {
  return !!effect && effect.layers.some(l => l.mode !== "sequence");
}

/* ============================================================
   Frequency <-> GB register helpers
   ============================================================ */

export function freqFromNote(note) { return 440 * Math.pow(2, (note - 69) / 12); }

// Square/pulse: freq = 131072 / (2048 - period)  ->  invert and clamp.
export function pulsePeriod(freqHz) {
  const p = 2048 - Math.round(131072 / Math.max(freqHz, 32));
  return clampInt(p, 0, 2047);
}
// Wave tone is half the pulse rate: freq = 65536 / (2048 - period).
export function wavePeriod(freqHz) {
  const p = 2048 - Math.round(65536 / Math.max(freqHz, 16));
  return clampInt(p, 0, 2047);
}
// Map a 0..15 "tone" onto an LFSR clock shift (NR43 bits 4-7). Higher tone =>
// smaller shift => higher pitched hiss. Divisor is fixed at code 0 for a clean,
// predictable mapping the ear reads as a single pitch axis.
export function noiseParams(tone) {
  const shift = clampInt(Math.round(13 - (tone / 15) * 13), 0, 13);
  return { shift, divisor: 0, width: 0 };
}
// Approximate audible frequency of a noise setting, for the Web Audio preview.
export function noiseFreqHz(shift, divisorCode) {
  const div = NOISE_DIVISORS[divisorCode] || 8;
  return 524288 / div / Math.pow(2, shift + 1);
}

/* ============================================================
   Synthesis: macro -> per-frame program
   ============================================================
   The compiled program is what everything downstream consumes (visualization,
   Web Audio preview, WAV render and C export). A frame carries the resolved
   per-tick values; channel-specific fields are filled as relevant.

     frame = { vol: 0..15, freqHz, note, noiseTone, duty, width }

   The layer also reports steady values used to drive the hardware envelope on
   export (peakVol, decayPace) so the generated C sounds like the preview.
*/

export function compileLayer(effect, layer) {
  const tickHz = effect.tickHz || DEFAULT_TICK_HZ;
  const ch = layer.channel;

  if (layer.mode === "manual" && Array.isArray(layer.steps)) {
    return compileManual(layer, tickHz);
  }
  if (layer.mode === "sequence" && Array.isArray(layer.notes)) {
    return compileSequence(layer, tickHz);
  }

  const m = layer.macro;
  const nFrames = clampInt(Math.round((m.lengthMs / 1000) * tickHz), 1, MAX_FRAMES);
  const frames = [];

  // Peak volume and a hardware-envelope decay pace derived from the macro, so
  // the C export can lean on the real envelope unit instead of rewriting volume
  // every frame (which would buzz on hardware).
  const peakVol = clampInt(Math.round(15 * (0.45 + 0.55 * m.punch)), 1, 15);
  const decayPace = m.decay <= 0.02 ? 0 : clampInt(Math.round(7 - m.decay * 6), 1, 7);
  const decayRate = m.decay <= 0.02 ? 0 : (0.03 + m.decay * 0.5);   // per-frame, for preview
  const attackFrames = Math.round((1 - m.punch) * 0.18 * nFrames);
  const floorVol = m.sustain * peakVol;

  for (let i = 0; i < nFrames; i++) {
    const t = nFrames > 1 ? i / (nFrames - 1) : 0;

    // Volume: quick attack ramp, then exponential decay toward the floor.
    let v = peakVol * Math.exp(-decayRate * i);
    v = Math.max(v, floorVol);
    if (attackFrames > 0 && i < attackFrames) v *= (i + 1) / (attackFrames + 1);
    const vol = clampInt(Math.round(v), 0, 15);

    // trigger/remain/env are what the export needs: where the channel is
    // keyed, how much of the sound is still to come (the length counter is
    // loaded with the remainder on every write), and the envelope's starting
    // volume. A macro layer is one note, so it keys once on frame 0.
    const frame = { vol, duty: m.duty, width: m.width, trigger: i === 0, remain: nFrames - i, env: peakVol };

    if (ch === "noise") {
      // Glide the noise tone, plus any mid-sound jump.
      let tone = m.noiseTone + m.bend * m.bendAmount * 15 * t;
      if (m.jump && t >= m.jumpAt) tone += m.jump * 0.5;
      frame.noiseTone = clampf(tone, 0, 15);
    } else {
      // Pitched channels: semitone glide + optional jump + vibrato.
      let note = m.baseNote + m.bend * m.bendAmount * 36 * t;
      if (m.jump && t >= m.jumpAt) note += m.jump;
      if (m.vibratoDepth > 0 && m.vibratoRate > 0) {
        const rateHz = m.vibratoRate * 24;
        note += Math.sin(2 * Math.PI * rateHz * (i / tickHz)) * m.vibratoDepth * 2;
      }
      frame.note = note;
      frame.freqHz = freqFromNote(note);
    }
    frames.push(frame);
  }

  return { channel: ch, tickHz, frames, peakVol, decayPace, wavePreset: layer.wavePreset };
}

// Manual mode: frames are stored directly as { vol, note } (pitched) or
// { vol, noiseTone } (noise). Timbre stays constant from the macro.
function compileManual(layer, tickHz) {
  const m = layer.macro;
  const ch = layer.channel;
  const n = layer.steps.length;
  const frames = layer.steps.map((s, i) => {
    const frame = { vol: clampInt(s.vol, 0, 15), duty: m.duty, width: m.width, trigger: i === 0, remain: n - i };
    if (ch === "noise") {
      frame.noiseTone = clampf(s.noiseTone != null ? s.noiseTone : m.noiseTone, 0, 15);
    } else {
      const note = s.note != null ? s.note : m.baseNote;
      frame.note = note;
      frame.freqHz = freqFromNote(note);
    }
    return frame;
  });
  const peakVol = frames.reduce((a, f) => Math.max(a, f.vol), 1);
  return { channel: ch, tickHz, frames, peakVol, decayPace: 0, wavePreset: layer.wavePreset };
}

/* Sequence mode: a list of notes, each played with the layer's macro timbre
   and envelope. Every note re-triggers the channel -- crisp arpeggios -- with
   two exceptions authored per note: `tie` carries the previous envelope
   through, so a run of tied notes is one swell whose pitch steps, and `rest`
   emits silence (no writes at all; the previous note's length counter has
   already been loaded to expire exactly where the rest begins).

   Notes hold a steady pitch: bend, jump and vibrato belong to the single-tone
   macro and are ignored here, which is what keeps a chime's intervals clean. */
function compileSequence(layer, tickHz) {
  const m = layer.macro;
  const ch = layer.channel;
  const notes = layer.notes || [];

  const peakVol = clampInt(Math.round(15 * (0.45 + 0.55 * m.punch)), 1, 15);
  const decayPace = m.decay <= 0.02 ? 0 : clampInt(Math.round(7 - m.decay * 6), 1, 7);
  const decayRate = m.decay <= 0.02 ? 0 : (0.03 + m.decay * 0.5);

  // Group notes into tied runs first: a run shares one trigger, so it also
  // shares one length-counter deadline (the end of the whole run).
  const groups = [];
  notes.forEach((noteDef, i) => {
    const prev = notes[i - 1];
    const tied = i > 0 && !!prev.tie && !prev.rest && !noteDef.rest;
    if (tied) groups[groups.length - 1].push(noteDef);
    else groups.push([noteDef]);
  });

  const frames = [];
  for (const group of groups) {
    const lens = group.map(nd => clampInt(nd.len, 1, MAX_NOTE_FRAMES));
    const groupLen = lens.reduce((a, b) => a + b, 0);
    const head = group[0];
    const env = clampInt(Math.round(peakVol * (clampInt(head.vol, 0, 15) / 15)), head.rest ? 0 : 1, 15);
    const floorVol = m.sustain * env;
    let g = 0;                                  // frames since this group's trigger

    group.forEach((noteDef, gi) => {
      for (let k = 0; k < lens[gi]; k++, g++) {
        if (frames.length >= MAX_SEQ_FRAMES) return;
        let v = head.rest ? 0 : Math.max(env * Math.exp(-decayRate * g), floorVol);
        const frame = {
          vol: clampInt(Math.round(v), 0, 15),
          duty: m.duty,
          width: m.width,
          // A trigger on the group's first frame; a tied note still writes on
          // its first frame (the pitch changes) but does not key the channel.
          trigger: g === 0 && !head.rest,
          write: (k === 0 && !noteDef.rest) || (g === 0 && !head.rest),
          silent: !!noteDef.rest || !!head.rest,
          remain: groupLen - g,
          env,
        };
        if (ch === "noise") {
          frame.noiseTone = clampf(noteDef.noiseTone != null ? noteDef.noiseTone : m.noiseTone, 0, 15);
        } else {
          const note = noteDef.note != null ? noteDef.note : m.baseNote;
          frame.note = note;
          frame.freqHz = freqFromNote(note);
        }
        frames.push(frame);
      }
    });
  }

  return { channel: ch, tickHz, frames, peakVol, decayPace, wavePreset: layer.wavePreset };
}

// Freeze the current macro program into editable manual steps.
export function freezeToManual(effect, layer) {
  const prog = compileLayer(effect, layer);
  layer.steps = prog.frames.map(f => (
    layer.channel === "noise" ? { vol: f.vol, noiseTone: f.noiseTone } : { vol: f.vol, note: f.note }
  ));
  layer.mode = "manual";
}

/* ============================================================
   Randomize / mutate (single-tone layers)
   ============================================================ */

export function regenerateEffect(effect) {
  const rng = makeRng(effect.seed);
  effect.layers.forEach(layer => {
    const base = categoryMacro(layer.category);
    if (layer.category === "custom") {
      // Nothing to reset toward: nudge the current macro instead.
      mutateMacro(layer.macro, rng, 0.25);
    } else {
      layer.macro = jitterMacro(base, rng);
    }
    // A sequence is authored (or generated by the sequencer's chime
    // archetypes), not jittered: randomizing here re-rolls its timbre and
    // leaves the notes alone. Dropping back to macro mode would silently
    // delete a chime the moment someone pressed Randomize.
    if (layer.mode === "sequence") return;
    layer.mode = "macro";
    layer.steps = null;
  });
}

export function jitterMacro(base, rng) {
  const m = makeMacro(base);
  m.lengthMs = clampf(m.lengthMs * (1 + jitter(rng, 0.3)), 40, 4000);
  m.baseNote = clampf(m.baseNote + jitter(rng, 6), 24, 108);
  m.noiseTone = clampf(m.noiseTone + jitter(rng, 3), 0, 15);
  m.bendAmount = clamp01(m.bendAmount + jitter(rng, 0.2));
  m.punch = clamp01(m.punch + jitter(rng, 0.15));
  m.decay = clamp01(m.decay + jitter(rng, 0.15));
  if (Math.abs(m.bend) > 0.01) m.bend = clampf(m.bend + jitter(rng, 0.15), -1, 1);
  return m;
}

export function mutateMacro(m, rng, amt) {
  m.lengthMs = clampf(m.lengthMs * (1 + jitter(rng, amt * 0.5)), 40, 4000);
  m.baseNote = clampf(m.baseNote + jitter(rng, amt * 8), 24, 108);
  m.noiseTone = clampf(m.noiseTone + jitter(rng, amt * 5), 0, 15);
  m.bend = clampf(m.bend + jitter(rng, amt * 0.4), -1, 1);
  m.bendAmount = clamp01(m.bendAmount + jitter(rng, amt * 0.3));
  m.punch = clamp01(m.punch + jitter(rng, amt * 0.3));
  m.decay = clamp01(m.decay + jitter(rng, amt * 0.3));
  m.jump = Math.round(clampf(m.jump + jitter(rng, amt * 6), -24, 24));
}

/* ============================================================
   GBDK C export
   ============================================================
   Each effect compiles to a byte program consumed by a tiny frame-stepped VM:

     0x01 ch r0 r1 r2 r3 r4   write channel ch's five registers (NRx0..NRx4)
     0x02 <16 bytes>          load wave RAM (emitted once if a wave layer exists)
     0x03 n                   end of frame, then idle n further frames
     0xFF                     end of frame  (advance one tick)
     0x00                     end of effect

   A channel is keyed with the hardware volume envelope + length counter set
   from the macro, so decays run on real hardware; frames in the middle of a
   note rewrite only pitch (no re-trigger), which avoids the 60 Hz buzz that
   per-frame volume writes would cause on a DMG.

   Two things keep a multi-second sequence small. Register writes are emitted
   only when something audible changed -- the length-counter bits are masked
   out of that comparison, since they count down on their own and a note that
   is not written again still expires exactly where its last write said it
   would -- and the resulting runs of empty frames collapse into `0x03 n`. A
   held note therefore costs seven bytes and a hold, not seven bytes a frame.
*/

// Bits of each register row that are the length counter, and so must not
// count as "something changed" (see the note above).
function significantRow(channel, row) {
  const r = row.slice();
  if (channel === 2) r[1] = 0;              // wave: NR31 is length only
  else r[1] &= 0xC0;                        // pulse/noise: low 6 bits are length
  return r.join(",");
}

export function buildEffectProgram(effect) {
  // Resolve every layer to its register bytes per frame, then interleave.
  const layerRegs = effect.layers.map(layer => layerToRegisters(effect, layer));
  const nFrames = layerRegs.reduce((a, lr) => Math.max(a, lr.frames.length), 0);
  const bytes = [];

  // Load wave RAM up front if any layer uses the wave channel.
  const waveLayer = effect.layers.find(l => l.channel === "wave");
  if (waveLayer) {
    bytes.push(0x02);
    const table = WAVE_PRESETS[waveLayer.wavePreset] || WAVE_PRESETS.triangle;
    for (let i = 0; i < 16; i++) bytes.push((table[i * 2] << 4) | (table[i * 2 + 1] & 0x0f));
  }

  // Pass 1: what each frame has to write, after change detection.
  const perFrame = [];
  const last = {};
  for (let i = 0; i < nFrames; i++) {
    const writes = [];
    layerRegs.forEach(lr => {
      const r = i < lr.frames.length ? lr.frames[i] : null;
      if (!r) return;
      const sig = significantRow(lr.channelIndex, r);
      if (!lr.forced[i] && last[lr.channelIndex] === sig) return;
      last[lr.channelIndex] = sig;
      writes.push(0x01, lr.channelIndex, r[0], r[1], r[2], r[3], r[4]);
    });
    perFrame.push(writes);
  }

  // Pass 2: emit, collapsing runs of silent frames into a hold.
  for (let i = 0; i < nFrames; ) {
    for (const b of perFrame[i]) bytes.push(b);
    let hold = 0;
    while (hold < 255 && i + 1 + hold < nFrames && perFrame[i + 1 + hold].length === 0) hold++;
    if (hold > 0) { bytes.push(0x03, hold); i += hold + 1; }
    else { bytes.push(0xFF); i += 1; }
  }
  bytes.push(0x00);
  return bytes;
}

export function layerToRegisters(effect, layer) {
  const prog = compileLayer(effect, layer);
  const ch = prog.channel;
  const chIndex = CHANNEL_INDEX[ch];
  const n = prog.frames.length;
  const tickHz = prog.tickHz;

  const rows = [];
  for (let i = 0; i < n; i++) {
    const f = prog.frames[i];
    if (f.silent) { rows.push(null); continue; }   // a rest writes nothing at all
    const trigger = f.trigger ? 0x80 : 0x00;
    const lenEnable = 0x40;                 // stop at the length counter
    const env = ((f.env != null ? f.env : prog.peakVol) << 4) | prog.decayPace;

    // Length counter, so the channel silences itself when the sound ends
    // rather than ringing on. Pulse/noise count 64 steps at 256 Hz, wave
    // counts 256. Every write loads the time *remaining* (a write to NRx1
    // loads the counter directly, no trigger needed), so all the writes in
    // one note agree on the same end point -- and a note that isn't written
    // again keeps counting down to exactly that point on its own.
    const remainSec = (f.remain != null ? f.remain : n - i) / tickHz;
    const remainSteps = Math.round(remainSec * 256);
    const lenPulse = clampInt(64 - remainSteps, 0, 63);
    const lenWave = clampInt(256 - remainSteps, 0, 255);

    if (ch === "pulse1" || ch === "pulse2") {
      const period = pulsePeriod(f.freqHz);
      const r0 = 0x00;                                            // NR10 sweep off (software-driven pitch)
      const r1 = (f.duty << 6) | lenPulse;                       // NRx1 duty + length load
      const r2 = env;                                            // NRx2 envelope
      const r3 = period & 0xFF;                                  // NRx3 period low
      const r4 = trigger | lenEnable | ((period >> 8) & 0x07);   // NRx4 trigger + period high
      rows.push([r0, r1, r2, r3, r4]);
    } else if (ch === "wave") {
      const period = wavePeriod(f.freqHz);
      const loud = clampInt(Math.round(f.vol / 15 * 3), 0, 3);   // 0..3 loudness -> NR32 code
      const r0 = 0x80;                                           // NR30 DAC on
      const r1 = lenWave;                                        // NR31 length load
      const r2 = WAVE_VOLUME_CODE[loud] << 5;                    // NR32 volume code
      const r3 = period & 0xFF;                                  // NR33 period low
      const r4 = trigger | lenEnable | ((period >> 8) & 0x07);   // NR34 trigger + period high
      rows.push([r0, r1, r2, r3, r4]);
    } else { // noise
      const np = noiseParams(f.noiseTone);
      const r0 = 0x00;                                           // unused slot (base 0xFF1F)
      const r1 = lenPulse;                                       // NR41 length load
      const r2 = env;                                            // NR42 envelope
      const r3 = (np.shift << 4) | (f.width << 3) | np.divisor;  // NR43 poly counter
      const r4 = trigger | lenEnable;                            // NR44 trigger
      rows.push([r0, r1, r2, r3, r4]);
    }
  }
  return { channelIndex: chIndex, frames: rows, forced: prog.frames.map(f => !!(f.trigger || f.write)) };
}

export function exportC(project) {
  const H = [];
  H.push("/* gbsfx.h - generated by GB SFX Generator. Do not hand-edit. */");
  H.push("#ifndef GBSFX_H");
  H.push("#define GBSFX_H");
  H.push("#include <stdint.h>");
  H.push("");
  H.push("/* Call gbsfx_init() once (enables the APU), gbsfx_play(id) to start an");
  H.push("   effect, and gbsfx_update() exactly once per frame (e.g. after wait_vbl). */");
  H.push("void gbsfx_init(void);");
  H.push("void gbsfx_play(uint8_t id);");
  H.push("void gbsfx_update(void);");
  H.push("");
  project.effects.forEach((e, i) => H.push("#define SFX_" + cId(e.name).toUpperCase() + " " + i));
  H.push("#define SFX_COUNT " + project.effects.length);
  H.push("");
  H.push("#endif");

  const C = [];
  C.push("/* gbsfx.c - generated by GB SFX Generator. Do not hand-edit. */");
  C.push('#include "gbsfx.h"');
  C.push("");
  C.push("/* One byte program per effect (see the header of gb-sfx-generator.html");
  C.push("   for the opcode format). */");
  project.effects.forEach((e, i) => {
    const bytes = buildEffectProgram(e);
    C.push("static const uint8_t sfx_data_" + i + "[] = {");
    C.push("  " + wrapBytes(bytes, 12));
    C.push("};");
  });
  C.push("");
  C.push("static const uint8_t *const sfx_table[SFX_COUNT] = {");
  C.push("  " + project.effects.map((e, i) => "sfx_data_" + i).join(", "));
  C.push("};");
  C.push("");
  C.push("/* First of the five audio registers written per channel. 0xFF15 and");
  C.push("   0xFF1F are unused NR slots, so a uniform 5-byte write is harmless. */");
  C.push("static uint8_t *const sfx_base[4] = {");
  C.push("  (uint8_t *)0xFF10, (uint8_t *)0xFF15, (uint8_t *)0xFF1A, (uint8_t *)0xFF1F");
  C.push("};");
  C.push("");
  C.push("static const uint8_t *sfx_ptr;");
  C.push("static uint8_t sfx_active = 0;");
  C.push("static uint8_t sfx_hold = 0;   /* frames still to idle (opcode 0x03) */");
  C.push("");
  C.push("void gbsfx_init(void) {");
  C.push("  *(uint8_t *)0xFF26 = 0x80; /* NR52: sound on            */");
  C.push("  *(uint8_t *)0xFF24 = 0x77; /* NR50: full volume L/R     */");
  C.push("  *(uint8_t *)0xFF25 = 0xFF; /* NR51: all channels L+R    */");
  C.push("}");
  C.push("");
  C.push("void gbsfx_play(uint8_t id) {");
  C.push("  if (id >= SFX_COUNT) return;");
  C.push("  sfx_ptr = sfx_table[id];");
  C.push("  sfx_active = 1;");
  C.push("  sfx_hold = 0;");
  C.push("}");
  C.push("");
  C.push("void gbsfx_update(void) {");
  C.push("  uint8_t cmd, ch, k;");
  C.push("  uint8_t *addr;");
  C.push("  if (!sfx_active) return;");
  C.push("  if (sfx_hold) { sfx_hold--; return; }         /* idling */");
  C.push("  for (;;) {");
  C.push("    cmd = *sfx_ptr++;");
  C.push("    if (cmd == 0x00) { sfx_active = 0; return; } /* end of effect */");
  C.push("    if (cmd == 0xFF) { return; }                 /* end of frame  */");
  C.push("    if (cmd == 0x03) { sfx_hold = *sfx_ptr++; return; } /* frame + idle n */");
  C.push("    if (cmd == 0x01) {");
  C.push("      ch = *sfx_ptr++;");
  C.push("      addr = sfx_base[ch];");
  C.push("      for (k = 0; k < 5; k++) addr[k] = *sfx_ptr++;");
  C.push("    } else if (cmd == 0x02) {");
  C.push("      addr = (uint8_t *)0xFF30;                   /* wave RAM */");
  C.push("      for (k = 0; k < 16; k++) addr[k] = *sfx_ptr++;");
  C.push("    }");
  C.push("  }");
  C.push("}");

  return { h: H.join("\n") + "\n", c: C.join("\n") + "\n" };
}

// Sanitize an effect name into a valid C identifier.
export function cId(name) {
  let s = String(name).replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(s)) s = "_" + s;
  return s || "sfx";
}
function wrapBytes(bytes, perLine) {
  const out = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    out.push(bytes.slice(i, i + perLine).map(b => "0x" + b.toString(16).padStart(2, "0").toUpperCase()).join(", "));
  }
  return out.join(",\n  ");
}

/* ============================================================
   Import / export plumbing
   ============================================================ */

export function exportJson(project) {
  return JSON.stringify(project, null, 2);
}

/* Wrap one effect as a whole project, so exports carry a single sound
   rather than the entire working set. Keeping one sound per file is what
   lets a game's build glob the directory and name each effect after its
   file; a bank file bundling everything you happened to have open makes
   both of those ambiguous. Ids are renumbered from 1 so the file is
   identical no matter which slot the effect occupied while editing. */
export function singleEffectProject(effect) {
  const copy = JSON.parse(JSON.stringify(effect));
  copy.id = 1;
  copy.layers.forEach((l, i) => { l.id = 2 + i; });
  return {
    formatVersion: FORMAT_VERSION,
    name: copy.name,
    nextId: 2 + copy.layers.length,
    effects: [copy],
  };
}

/* Read a .gbsfx.json. Both tools hold one sound, so an older bank file with
   several effects loads its first one and reports the rest rather than
   quietly dropping them. */
export function importJson(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.effects) || !data.effects.length) {
    throw new Error("Not a .gbsfx.json file (no effects array).");
  }
  // Backfill anything an older/partial file might miss.
  data.formatVersion = data.formatVersion || FORMAT_VERSION;
  data.nextId = data.nextId || 1;
  data.effects.forEach(e => {
    e.tickHz = e.tickHz || DEFAULT_TICK_HZ;
    e.seed = e.seed != null ? e.seed : 0;
    (e.layers || []).forEach(l => {
      l.macro = makeMacro(l.macro);
      if (l.mode == null) l.mode = "macro";
      if (l.gain == null) l.gain = 1;
      // A sequence layer without notes would compile to nothing; fall back to
      // the sliders rather than showing an empty roll.
      if (l.mode === "sequence") {
        if (Array.isArray(l.notes) && l.notes.length) l.notes = l.notes.map(n => makeNote(n));
        else { l.mode = "macro"; l.notes = null; }
      }
    });
  });
  const extra = data.effects.length - 1;
  const project = singleEffectProject(data.effects[0]);
  return { project, dropped: extra > 0 ? extra : 0 };
}

/* ============================================================
   Small music helpers for readouts
   ============================================================ */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function noteName(midi) {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
export function noteFromFreq(hz) { return 69 + 12 * Math.log2(hz / 440); }

// "C5", "f#4", "Bb3" or a bare MIDI number -> MIDI note. Returns null when the
// text is not a note, so the table can leave the value it had alone.
export function parseNoteName(text) {
  const s = String(text).trim();
  if (/^\d+$/.test(s)) return clampInt(s, 24, 108);
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s);
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return clampInt((Number(m[3]) + 1) * 12 + base + accidental, 24, 108);
}
