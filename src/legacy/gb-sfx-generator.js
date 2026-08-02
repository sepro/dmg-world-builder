// @ts-nocheck
import { el, label, spacer, inputText, selectFrom, numberInput, clampInt, toggle, openModal, closeModal, downloadBlob, downloadText, copyText } from "../lib/common.js";

"use strict";

/* ============================================================
   Constants and hardware reference tables
   ============================================================ */

const FORMAT_VERSION = 1;
const DEFAULT_TICK_HZ = 60;      // effects step once per frame by default
const MAX_FRAMES = 300;          // safety ceiling for one macro layer (~5 s at 60 Hz)
const MAX_SEQ_FRAMES = 900;      // ceiling for a whole note sequence (~15 s at 60 Hz)
const MAX_NOTE_FRAMES = 240;     // ceiling for a single note in a sequence

// The four channels. `base` is the address of the first of the five audio
// registers the C player writes for that channel (0xFF15 / 0xFF1F land on the
// unused NR20 / NR41-1 slots, so a uniform 5-register write is safe).
const CHANNELS = {
  pulse1: { label: "Pulse 1", role: "square + sweep", dot: "#b8f25a", base: 0xFF10, pitched: true },
  pulse2: { label: "Pulse 2", role: "square",         dot: "#88c070", base: 0xFF15, pitched: true },
  wave:   { label: "Wave",    role: "wavetable",      dot: "#346856", base: 0xFF1A, pitched: true },
  noise:  { label: "Noise",   role: "LFSR",           dot: "#e08a5a", base: 0xFF1F, pitched: false },
};
const CHANNEL_ORDER = ["pulse1", "pulse2", "wave", "noise"];
const CHANNEL_INDEX = { pulse1: 0, pulse2: 1, wave: 2, noise: 3 };

// Duty cycles selectable on the two pulse channels (NRx1 bits 6-7).
const DUTY_LABELS = ["12.5%", "25%", "50%", "75%"];
const DUTY_FRACTION = [0.125, 0.25, 0.5, 0.75];

// Noise divisor codes -> actual divisor (NR43 bits 0-2).
const NOISE_DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];

// Wave-channel volume codes (NR32 bits 5-6): 0=mute, 1=100%, 2=50%, 3=25%.
// Index by a "loudness" 0..3 (0 silent, 3 loudest) to get the register code.
const WAVE_VOLUME_CODE = [0, 3, 2, 1];

// Named 32-step wavetables (values 0..15) offered on the wave channel.
const WAVE_PRESETS = {
  sine:     makeWaveTable("sine"),
  triangle: makeWaveTable("triangle"),
  saw:      makeWaveTable("saw"),
  square:   makeWaveTable("square"),
  organ:    makeWaveTable("organ"),
};
const WAVE_PRESET_NAMES = Object.keys(WAVE_PRESETS);

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

// The seven classic sfxr-style categories. Each returns a base macro; the
// randomizer jitters around it. `custom` is what a hand-added layer starts from.
const CATEGORY_LIST = [
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
const CATEGORY_CHANNEL = {
  coin: "pulse1", laser: "pulse1", jump: "pulse1", powerup: "pulse1",
  blip: "pulse2", explosion: "noise", hit: "noise", custom: "pulse1",
};

/* ============================================================
   Sequence presets (multi-note chimes)
   ============================================================
   A single macro layer is one tone: it can bend or jump, but it cannot say
   "C5, E5, G5, C6". These presets seed a `sequence` layer -- a list of notes
   played back through the layer's macro timbre -- for the sounds that are
   inherently a little tune: victory, death, item get. `notes` are authored as
   [semitones-above-the-root, length-in-frames] pairs plus an optional tie, and
   `root` is the MIDI note the offsets are measured from, so a preset can be
   transposed by moving one number.
*/

const SEQUENCE_PRESETS = [
  {
    key: "win", label: "Win", hint: "fanfare",
    channel: "pulse1", root: 72,
    macro: { punch: 0.75, decay: 0.16, sustain: 0.35, duty: 2 },
    // Rising major arpeggio, the last note held long and let ring.
    notes: [[0, 6], [4, 6], [7, 6], [12, 30]],
  },
  {
    key: "death", label: "Death", hint: "fail",
    channel: "pulse2", root: 69,
    macro: { punch: 0.6, decay: 0.22, sustain: 0.2, duty: 1 },
    // Descending minor figure, slowing, ending on a long low note.
    notes: [[0, 10], [-3, 10], [-5, 14], [-12, 40]],
  },
  {
    key: "itemget", label: "Item get", hint: "flourish",
    channel: "pulse1", root: 79,
    macro: { punch: 0.85, decay: 0.45, sustain: 0, duty: 2 },
    // Two quick notes into a held third -- the classic pickup jingle.
    notes: [[0, 5], [5, 5], [12, 18]],
  },
];

/* ============================================================
   Macro model
   ============================================================
   A macro is the guided, semantic description of a sound. Fields are shared
   across channels; the synthesizer reads whichever ones apply to the layer's
   channel (e.g. `noiseTone`/`width` for noise, `baseNote`/`duty` for pulse).
*/

function makeMacro(overrides) {
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
function categoryMacro(category) {
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
   ============================================================ */

function makeDefaultProject() {
  const proj = { formatVersion: FORMAT_VERSION, name: "sfx-bank", nextId: 1, effects: [] };
  proj.effects.push(makeEffect(proj, "coin"));
  return proj;
}

function makeEffect(proj, category) {
  const cat = category || "coin";
  const id = proj.nextId++;
  return {
    id,
    name: defaultEffectName(cat, id),
    seed: (Math.random() * 0xffffffff) >>> 0,
    tickHz: DEFAULT_TICK_HZ,
    layers: [makeLayer(proj, cat)],
  };
}

function makeLayer(proj, category) {
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
function makeNote(overrides) {
  return Object.assign({
    note: 72,
    noiseTone: 8,
    len: 6,
    tie: false,
    vol: 15,
    rest: false,
  }, overrides || {});
}

// Build a sequence layer from one of the SEQUENCE_PRESETS rows.
function makeSequenceLayer(proj, preset) {
  const layer = makeLayer(proj, "custom");
  layer.channel = preset.channel;
  layer.category = "custom";
  layer.mode = "sequence";
  layer.macro = makeMacro(Object.assign({ lengthMs: 240 }, preset.macro));
  layer.notes = preset.notes.map(([semi, len, tie]) => makeNote({
    note: preset.root + semi,
    noiseTone: 8,
    len,
    tie: !!tie,
  }));
  return layer;
}

// Total length of a sequence in frames (what the roll and the C export span).
function sequenceFrames(layer) {
  const notes = layer.notes || [];
  let total = 0;
  for (let i = 0; i < notes.length; i++) total += clampInt(notes[i].len, 1, MAX_NOTE_FRAMES);
  return Math.min(total, MAX_SEQ_FRAMES);
}

function defaultEffectName(category, id) {
  const c = CATEGORY_LIST.find(x => x.key === category);
  return (c ? c.label : "SFX").toLowerCase().replace(/[^a-z0-9]/g, "") + "_" + id;
}

/* ============================================================
   Editor state (kept separate from the saved project)
   ============================================================ */

const state = {
  project: makeDefaultProject(),
  selectedEffectId: null,
  advanced: false,
  paintLane: null,          // active drag lane in manual mode: "pitch" | "vol"
  selNote: null,            // { layerId, index } selected note in a sequence layer
};
state.selectedEffectId = state.project.effects[0].id;

function selectedEffect() {
  return state.project.effects.find(e => e.id === state.selectedEffectId) || null;
}

/* ============================================================
   Deterministic RNG (mulberry32), matching the music generator's approach
   ============================================================ */

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Symmetric jitter in [-amt, +amt].
function jitter(rng, amt) { return (rng() * 2 - 1) * amt; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clampf(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/* ============================================================
   Frequency <-> GB register helpers
   ============================================================ */

function freqFromNote(note) { return 440 * Math.pow(2, (note - 69) / 12); }

// Square/pulse: freq = 131072 / (2048 - period)  ->  invert and clamp.
function pulsePeriod(freqHz) {
  const p = 2048 - Math.round(131072 / Math.max(freqHz, 32));
  return clampInt(p, 0, 2047);
}
// Wave tone is half the pulse rate: freq = 65536 / (2048 - period).
function wavePeriod(freqHz) {
  const p = 2048 - Math.round(65536 / Math.max(freqHz, 16));
  return clampInt(p, 0, 2047);
}
// Map a 0..15 "tone" onto an LFSR clock shift (NR43 bits 4-7). Higher tone =>
// smaller shift => higher pitched hiss. Divisor is fixed at code 0 for a clean,
// predictable mapping the ear reads as a single pitch axis.
function noiseParams(tone) {
  const shift = clampInt(Math.round(13 - (tone / 15) * 13), 0, 13);
  return { shift, divisor: 0, width: 0 };
}
// Approximate audible frequency of a noise setting, for the Web Audio preview.
function noiseFreqHz(shift, divisorCode) {
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

function compileLayer(effect, layer) {
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
function freezeToManual(effect, layer) {
  const prog = compileLayer(effect, layer);
  layer.steps = prog.frames.map(f => (
    layer.channel === "noise" ? { vol: f.vol, noiseTone: f.noiseTone } : { vol: f.vol, note: f.note }
  ));
  layer.mode = "manual";
}

/* ============================================================
   Randomize / mutate
   ============================================================ */

function regenerateEffect(effect) {
  const rng = makeRng(effect.seed);
  effect.layers.forEach(layer => {
    const base = categoryMacro(layer.category);
    if (layer.category === "custom") {
      // Nothing to reset toward: nudge the current macro instead.
      mutateMacro(layer.macro, rng, 0.25);
    } else {
      layer.macro = jitterMacro(base, rng);
    }
    // A sequence is authored, not generated: randomizing re-rolls its timbre
    // and leaves the notes alone. Dropping back to macro mode here would
    // silently delete a chime the moment someone pressed Randomize.
    if (layer.mode === "sequence") return;
    layer.mode = "macro";
    layer.steps = null;
  });
}

function jitterMacro(base, rng) {
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

function mutateMacro(m, rng, amt) {
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
   Audio engine (Web Audio approximation of the GB channels)
   ============================================================
   scheduleLayer works against any BaseAudioContext, so the live preview and the
   offline WAV render share exactly one code path.
*/

const audio = {
  ctx: null,
  master: null,
  noiseBuffer: null,
  voices: [],
  playing: false,

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);
  },

  // A band-limited pulse wave of the given duty fraction.
  pulseWave(ctx, duty) {
    const n = 32;
    const real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
    return ctx.createPeriodicWave(real, imag);
  },

  // A periodic wave built straight from a 32-step wavetable (values 0..15).
  waveFromTable(ctx, table) {
    const n = table.length;
    const real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i++) {
        const ang = (2 * Math.PI * k * i) / n;
        const s = (table[i] / 15) - 0.5;      // center around 0
        re += s * Math.cos(ang);
        im -= s * Math.sin(ang);
      }
      real[k] = re / n; imag[k] = im / n;
    }
    return ctx.createPeriodicWave(real, imag);
  },

  makeNoiseBuffer(ctx) {
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  // Schedule one compiled layer onto `dest`, starting at absolute time t0.
  // Returns the time the layer finishes (for computing total render length).
  scheduleLayer(ctx, dest, prog, layerGain, t0) {
    const tick = 1 / prog.tickHz;
    const frames = prog.frames;
    if (!frames.length) return t0;
    const endT = t0 + frames.length * tick;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(dest);

    let src, filter;
    if (prog.channel === "noise") {
      src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx);
      src.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      // 7-bit width reads as a tonal, metallic buzz: lift resonance for it.
      filter.Q.value = frames[0].width === 0 ? 6 : 0.7;
      src.connect(filter); filter.connect(gain);
    } else {
      src = ctx.createOscillator();
      if (prog.channel === "wave") {
        src.setPeriodicWave(this.waveFromTable(ctx, WAVE_PRESETS[prog.wavePreset] || WAVE_PRESETS.triangle));
      } else {
        // Duty is treated as constant across the effect (see header note).
        src.setPeriodicWave(this.pulseWave(ctx, DUTY_FRACTION[frames[0].duty] || 0.5));
      }
      src.connect(gain);
    }

    // Step every parameter at each frame boundary; short ramps kill clicks.
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const at = t0 + i * tick;
      const target = (f.vol / 15) * layerGain;
      gain.gain.setTargetAtTime(target, at, 0.004);
      if (prog.channel === "noise") {
        const np = noiseParams(f.noiseTone);
        const hz = noiseFreqHz(np.shift, np.divisor);
        filter.frequency.setValueAtTime(clampf(hz, 120, 12000), at);
      } else {
        src.frequency.setValueAtTime(clampf(f.freqHz, 20, 15000), at);
      }
    }
    gain.gain.setTargetAtTime(0, endT, 0.01);
    src.start(t0);
    src.stop(endT + 0.08);
    this.voices.push(src);
    return endT;
  },

  play(effect) {
    this.ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.stop();
    this.playing = true;
    const t0 = this.ctx.currentTime + 0.05;
    effect.layers.forEach(layer => {
      const prog = compileLayer(effect, layer);
      this.scheduleLayer(this.ctx, this.master, prog, layer.gain, t0);
    });
  },

  stop() {
    this.voices.forEach(v => { try { v.stop(); } catch (e) {} });
    this.voices = [];
    this.playing = false;
  },
};

// Render an effect to a mono 16-bit WAV via an offline context.
async function renderWav(effect) {
  const sampleRate = 44100;
  let maxEnd = 0;
  effect.layers.forEach(layer => {
    const prog = compileLayer(effect, layer);
    maxEnd = Math.max(maxEnd, prog.frames.length / prog.tickHz);
  });
  const durSec = maxEnd + 0.12;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(1, Math.ceil(sampleRate * durSec), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.25;
  master.connect(ctx.destination);
  effect.layers.forEach(layer => {
    const prog = compileLayer(effect, layer);
    audio.scheduleLayer(ctx, master, prog, layer.gain, 0);
  });
  const buffer = await ctx.startRendering();
  return encodeWav(buffer.getChannelData(0), sampleRate);
}

function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
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

function buildEffectProgram(effect) {
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

function layerToRegisters(effect, layer) {
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

function exportC(project) {
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
function cId(name) {
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

function exportJson(project) {
  return JSON.stringify(project, null, 2);
}

/* Wrap one effect as a whole project, so exports carry a single sound
   rather than the entire working set. Keeping one sound per file is what
   lets a game's build glob the directory and name each effect after its
   file; a bank file bundling everything you happened to have open makes
   both of those ambiguous. Ids are renumbered from 1 so the file is
   identical no matter which slot the effect occupied while editing. */
function singleEffectProject(effect) {
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

function importJson(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.effects)) throw new Error("Not a .gbsfx.json file (no effects array).");
  // Backfill anything an older/partial file might miss.
  data.formatVersion = data.formatVersion || FORMAT_VERSION;
  data.nextId = data.nextId || 1;
  data.effects.forEach(e => {
    e.tickHz = e.tickHz || DEFAULT_TICK_HZ;
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
  return data;
}

function currentBaseName() {
  const e = selectedEffect();
  return cId((e && e.name) || state.project.name || "sfx");
}

function doExport() {
  openModal("Export", (modal) => {
    const info = el("p", "hint", "Every export covers the selected effect only, one sound per file. The .gbsfx.json is the editable source of truth. WAV renders the preview. C emits gbsfx.h / gbsfx.c for GBDK-2020.");
    modal.appendChild(info);

    const row = el("div", "row");
    const jsonBtn = el("button", "primary", "Download .gbsfx.json (selected)");
    jsonBtn.addEventListener("click", () => {
      const e = selectedEffect(); if (!e) return;
      downloadText(currentBaseName() + ".gbsfx.json",
                   exportJson(singleEffectProject(e)), "application/json");
    });

    const wavBtn = el("button", null, "Download .wav (selected)");
    wavBtn.addEventListener("click", async () => {
      const e = selectedEffect(); if (!e) return;
      wavBtn.textContent = "Rendering...";
      try {
        const blob = await renderWav(e);
        downloadBlob(currentBaseName() + ".wav", blob);
      } catch (err) { alert("WAV render failed: " + err.message); }
      wavBtn.textContent = "Download .wav (selected)";
    });

    const cBtn = el("button", null, "Show gbsfx.c / .h (selected)");
    cBtn.addEventListener("click", () => showCExport());
    row.append(jsonBtn, wavBtn, cBtn);
    modal.appendChild(row);
  });
}

function showCExport() {
  const e = selectedEffect();
  if (!e) return;
  const { h, c } = exportC(singleEffectProject(e));
  openModal("GBDK C export", (modal) => {
    modal.appendChild(el("p", "hint", "Two files for your GBDK-2020 project, covering the selected effect only. Bytes are one frame program, stepped by the included player."));
    [["gbsfx.h", h], ["gbsfx.c", c]].forEach(([fname, text]) => {
      modal.appendChild(el("h2", null, fname));
      const ta = document.createElement("textarea");
      ta.value = text; ta.readOnly = true;
      modal.appendChild(ta);
      const row = el("div", "row");
      const dl = el("button", null, "Download " + fname);
      dl.addEventListener("click", () => downloadText(fname, text, "text/plain"));
      const cp = el("button", "tiny", "Copy");
      cp.addEventListener("click", async () => { cp.textContent = (await copyText(text)) ? "Copied" : "Copy failed"; });
      row.append(dl, cp);
      modal.appendChild(row);
      modal.appendChild(spacer(8));
    });
  });
}

function doImport() {
  openModal("Import .gbsfx.json", (modal) => {
    modal.appendChild(el("p", "hint", "Paste a .gbsfx.json below, or choose a file."));
    const file = document.createElement("input");
    file.type = "file"; file.accept = ".json,application/json";
    file.addEventListener("change", () => {
      const f = file.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { ta.value = r.result; };
      r.readAsText(f);
    });
    modal.appendChild(file);
    const ta = document.createElement("textarea");
    modal.appendChild(ta);
    const go = el("button", "primary", "Import");
    go.addEventListener("click", () => {
      try {
        state.project = importJson(ta.value);
        state.selectedEffectId = state.project.effects[0] ? state.project.effects[0].id : null;
        closeModal(); render();
      } catch (err) { alert("Import failed: " + err.message); }
    });
    modal.appendChild(el("div", "row")).appendChild(go);
  });
}

/* ============================================================
   Rendering
   ============================================================ */

const leftCol = document.getElementById("left-col");
const rightCol = document.getElementById("right-col");

function render() {
  renderLeft();
  renderRight();
}

function renderLeft() {
  leftCol.innerHTML = "";
  leftCol.appendChild(presetsCard());
  leftCol.appendChild(transportCard());
  leftCol.appendChild(libraryCard());
}

function presetsCard() {
  const card = el("div", "card");
  card.appendChild(el("h2", null, "New from preset"));
  card.appendChild(el("p", "hint", "Creates an effect and drops you into the sliders."));
  const grid = el("div", "preset-grid");
  CATEGORY_LIST.forEach(cat => {
    const b = el("button", "preset-btn");
    b.appendChild(document.createTextNode(cat.label));
    b.appendChild(el("small", null, cat.hint));
    b.addEventListener("click", () => {
      const e = makeEffect(state.project, cat.key);
      regenerateEffect(e);
      state.project.effects.push(e);
      state.selectedEffectId = e.id;
      render();
      audio.play(e);
    });
    grid.appendChild(b);
  });
  card.appendChild(grid);

  card.appendChild(spacer(12));
  card.appendChild(el("h2", null, "New chime"));
  card.appendChild(el("p", "hint", "A short sequence of notes rather than one tone — win, death, item get."));
  const seqGrid = el("div", "preset-grid");
  SEQUENCE_PRESETS.forEach(p => {
    const b = el("button", "preset-btn");
    b.appendChild(document.createTextNode(p.label));
    b.appendChild(el("small", null, p.hint));
    b.addEventListener("click", () => {
      const e = makeEffect(state.project, "custom");
      e.name = p.key + "_" + e.id;
      e.layers = [makeSequenceLayer(state.project, p)];
      state.project.effects.push(e);
      state.selectedEffectId = e.id;
      render();
      audio.play(e);
    });
    seqGrid.appendChild(b);
  });
  card.appendChild(seqGrid);
  return card;
}

function transportCard() {
  const e = selectedEffect();
  const card = el("div", "card");
  card.appendChild(el("h2", null, "Transport"));
  const t = el("div", "transport");
  const play = el("button", "primary btn-play", "Play");
  play.disabled = !e;
  play.addEventListener("click", () => e && audio.play(e));
  const stop = el("button", null, "Stop");
  stop.addEventListener("click", () => audio.stop());

  const rnd = el("button", null, "Randomize");
  rnd.disabled = !e;
  rnd.addEventListener("click", () => {
    e.seed = (Math.random() * 0xffffffff) >>> 0;
    regenerateEffect(e); render(); audio.play(e);
  });
  const mut = el("button", null, "Mutate");
  mut.disabled = !e;
  mut.addEventListener("click", () => {
    const rng = makeRng((e.seed = (e.seed + 0x9e3779b9) >>> 0));
    e.layers.forEach(l => { if (l.mode === "macro") mutateMacro(l.macro, rng, 0.2); });
    render(); audio.play(e);
  });
  t.append(play, stop, rnd, mut);
  card.appendChild(t);

  if (e) {
    const seedRow = el("div", "seed-row");
    seedRow.style.marginTop = "10px";
    seedRow.appendChild(el("span", "hint", "Seed"));
    const seedIn = numberInput(e.seed, 0, 0xffffffff);
    seedIn.addEventListener("change", () => {
      e.seed = clampInt(seedIn.value, 0, 0xffffffff);
      regenerateEffect(e); render(); audio.play(e);
    });
    seedRow.appendChild(seedIn);
    card.appendChild(seedRow);
  }
  return card;
}

function libraryCard() {
  const card = el("div", "card");
  card.appendChild(el("h2", null, "Library"));
  const list = el("div", "lib-list");
  state.project.effects.forEach(e => {
    const item = el("div", "lib-item" + (e.id === state.selectedEffectId ? " active" : ""));
    item.appendChild(el("span", "lib-name", e.name));
    const chans = e.layers.map(l => CHANNELS[l.channel].label.replace("Pulse ", "P")).join("+");
    item.appendChild(el("span", "lib-chan", chans));
    item.addEventListener("click", () => { state.selectedEffectId = e.id; render(); });
    list.appendChild(item);
  });
  card.appendChild(list);

  const row = el("div", "row");
  row.style.marginTop = "10px";
  const dup = el("button", "tiny", "Duplicate");
  dup.disabled = !selectedEffect();
  dup.addEventListener("click", () => {
    const e = selectedEffect(); if (!e) return;
    const copy = JSON.parse(JSON.stringify(e));
    copy.id = state.project.nextId++;
    copy.name = e.name + "_copy";
    copy.layers.forEach(l => l.id = state.project.nextId++);
    state.project.effects.push(copy);
    state.selectedEffectId = copy.id; render();
  });
  const del = el("button", "tiny danger", "Delete");
  del.disabled = state.project.effects.length <= 1;
  del.addEventListener("click", () => {
    const idx = state.project.effects.findIndex(x => x.id === state.selectedEffectId);
    if (idx < 0) return;
    state.project.effects.splice(idx, 1);
    state.selectedEffectId = state.project.effects[Math.max(0, idx - 1)].id;
    render();
  });
  row.append(dup, del);
  card.appendChild(row);
  return card;
}

function renderRight() {
  rightCol.innerHTML = "";
  const e = selectedEffect();
  if (!e) { rightCol.appendChild(el("div", "note-empty", "No effect selected. Pick a preset to start.")); return; }

  const card = el("div", "card");

  // Name + advanced toggle.
  const head = el("div", "row");
  const nameField = el("div", "field");
  nameField.style.flex = "1";
  nameField.appendChild(label("Effect name"));
  const nameIn = inputText(e.name);
  nameIn.style.width = "100%";
  nameIn.addEventListener("change", () => { e.name = nameIn.value.trim() || e.name; render(); });
  nameField.appendChild(nameIn);
  head.appendChild(nameField);
  head.appendChild(toggle("Advanced", state.advanced, v => { state.advanced = v; renderRight(); }));
  card.appendChild(head);
  card.appendChild(spacer(12));

  e.layers.forEach(layer => card.appendChild(layerCard(e, layer)));

  // Add-layer control (multi-channel effects).
  const addRow = el("div", "row");
  const addSel = selectFrom(CHANNEL_ORDER.map(c => ({ value: c, label: CHANNELS[c].label })), "noise", () => {});
  const addBtn = el("button", "tiny", "Add layer");
  addBtn.addEventListener("click", () => {
    const l = makeLayer(state.project, "custom");
    l.channel = addSel.value;
    l.macro = categoryMacro(l.channel === "noise" ? "hit" : "blip");
    e.layers.push(l); renderRight();
  });
  const seqBtn = el("button", "tiny", "Add sequence layer");
  seqBtn.title = "A layer of notes rather than one tone";
  seqBtn.addEventListener("click", () => {
    const l = makeLayer(state.project, "custom");
    l.channel = addSel.value;
    l.mode = "sequence";
    l.macro = makeMacro({ punch: 0.75, decay: 0.3, duty: 2 });
    // Start on a note the roll can draw rather than an empty grid.
    l.notes = [makeNote({ note: 72, noiseTone: 8, len: 8 })];
    e.layers.push(l); renderRight();
  });
  addRow.append(el("span", "hint", "Layer a channel:"), addSel, addBtn, seqBtn);
  card.appendChild(addRow);

  rightCol.appendChild(card);
}

/* ---- one layer's card: visualization + macro sliders + advanced ---- */

function layerCard(effect, layer) {
  const ch = CHANNELS[layer.channel];
  const card = el("div", "layer-card");

  const head = el("div", "layer-head");
  const dot = el("span", "dot"); dot.style.background = ch.dot;
  head.appendChild(dot);
  head.appendChild(el("span", "layer-title", ch.label + "  (" + ch.role + ")"));
  if (effect.layers.length > 1) {
    const rm = el("button", "tiny danger", "remove");
    rm.addEventListener("click", () => {
      effect.layers = effect.layers.filter(l => l.id !== layer.id);
      renderRight();
    });
    head.appendChild(rm);
  }
  card.appendChild(head);

  // Visualization of the compiled program.
  const prog = compileLayer(effect, layer);
  const vizWrap = el("div", "viz-wrap");
  const canvas = document.createElement("canvas");
  canvas.width = 520; canvas.height = 160;
  vizWrap.appendChild(canvas);
  card.appendChild(vizWrap);
  drawViz(canvas, prog, layer);
  if (layer.mode === "manual") attachPaint(canvas, effect, layer);

  const legend = el("div", "viz-legend");
  legend.innerHTML = '<span><span class="sw" style="background:var(--gb-1)"></span>Pitch</span>' +
                     '<span><span class="sw" style="background:var(--accent)"></span>Volume</span>' +
                     (layer.mode === "manual" ? '<span style="color:var(--accent)">drag to edit frames</span>' : '');
  card.appendChild(legend);

  // Sequence mode: the roll and the note table, above the timbre sliders.
  if (layer.mode === "sequence") card.appendChild(sequencePanel(effect, layer));

  // Core macro sliders (guided view).
  const m = layer.macro;
  const disabled = layer.mode === "manual";
  const box = el("div");
  if (layer.mode === "sequence") {
    // Pitch and length come from the notes; bend/jump/vibrato are single-tone
    // shaping and are ignored by compileSequence. What is left is timbre and
    // the envelope every note is struck with.
    box.appendChild(el("p", "hint", "Timbre and envelope for every note in the sequence. Pitch and length are the notes' own."));
    box.appendChild(sliderRow("Punch", m.punch, 0, 1, 0.02, v => m.punch = v, effect, v => v.toFixed(2)));
    box.appendChild(sliderRow("Decay", m.decay, 0, 1, 0.02, v => m.decay = v, effect, v => v.toFixed(2)));
    box.appendChild(sliderRow("Sustain", m.sustain, 0, 1, 0.02, v => m.sustain = v, effect, v => v.toFixed(2)));
    if (layer.channel === "wave") {
      box.appendChild(fieldRow("Tone", selectFrom(WAVE_PRESET_NAMES, layer.wavePreset, v => { layer.wavePreset = v; renderRight(); })));
    } else if (layer.channel === "noise") {
      box.appendChild(fieldRow("Tone", selectFrom([{ value: 1, label: "15-bit hiss" }, { value: 0, label: "7-bit metallic" }], m.width, v => { m.width = Number(v); renderRight(); })));
    } else {
      box.appendChild(sliderRow("Tone", m.duty, 0, 3, 1, v => m.duty = Math.round(v), effect, v => DUTY_LABELS[Math.round(v)]));
    }
    card.appendChild(box);
    if (state.advanced) card.appendChild(advancedPanel(effect, layer, prog));
    return card;
  }
  if (disabled) {
    const note = el("p", "hint", "This layer is in manual (hand-edited) mode. Sliders are paused.");
    box.appendChild(note);
    const back = el("button", "tiny", "Back to macro");
    back.addEventListener("click", () => { if (confirm("Discard hand-edited frames and return to sliders?")) { layer.mode = "macro"; layer.steps = null; renderRight(); } });
    box.appendChild(back);
  } else {
    box.appendChild(sliderRow("Length", m.lengthMs, 40, 2000, 10, v => m.lengthMs = v, effect, v => Math.round(v) + " ms"));
    if (layer.channel === "noise") {
      box.appendChild(sliderRow("Pitch", m.noiseTone, 0, 15, 0.1, v => m.noiseTone = v, effect, v => v.toFixed(1)));
    } else {
      box.appendChild(sliderRow("Pitch", m.baseNote, 36, 108, 1, v => m.baseNote = v, effect, v => noteName(v)));
    }
    box.appendChild(sliderRow("Bend", m.bend, -1, 1, 0.02, v => m.bend = v, effect, v => (v > 0 ? "up " : v < 0 ? "down " : "") + Math.abs(v).toFixed(2)));
    box.appendChild(sliderRow("Punch", m.punch, 0, 1, 0.02, v => m.punch = v, effect, v => v.toFixed(2)));
    box.appendChild(sliderRow("Decay", m.decay, 0, 1, 0.02, v => m.decay = v, effect, v => v.toFixed(2)));
    if (layer.channel === "wave") {
      box.appendChild(fieldRow("Tone", selectFrom(WAVE_PRESET_NAMES, layer.wavePreset, v => { layer.wavePreset = v; renderRight(); })));
    } else if (layer.channel === "noise") {
      box.appendChild(fieldRow("Tone", selectFrom([{ value: 1, label: "15-bit hiss" }, { value: 0, label: "7-bit metallic" }], m.width, v => { m.width = Number(v); renderRight(); })));
    } else {
      box.appendChild(sliderRow("Tone", m.duty, 0, 3, 1, v => m.duty = Math.round(v), effect, v => DUTY_LABELS[Math.round(v)]));
    }
  }
  card.appendChild(box);

  if (state.advanced) card.appendChild(advancedPanel(effect, layer, prog));
  return card;
}

// A labeled slider that re-synths + redraws on input. `fmt` renders the readout.
function sliderRow(name, value, min, max, step, setter, effect, fmt) {
  const row = el("div", "slider-row");
  row.appendChild(label(name));
  const input = document.createElement("input");
  input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value;
  const val = el("span", "val", fmt ? fmt(value) : String(value));
  input.addEventListener("input", () => {
    const v = Number(input.value);
    setter(v);
    val.textContent = fmt ? fmt(v) : String(v);
    // Redraw just this layer's canvas without a full rebuild (keeps drag smooth).
    redrawLayerCanvas(effect, row.closest(".layer-card"));
  });
  input.addEventListener("change", () => { const e = effect; audio.play(e); });
  row.append(input, val);
  return row;
}

function fieldRow(name, control) {
  const row = el("div", "slider-row");
  row.appendChild(label(name));
  const wrap = el("div"); wrap.style.gridColumn = "2 / 4";
  control.style.width = "100%";
  wrap.appendChild(control);
  row.appendChild(wrap);
  return row;
}

// Find the layer that owns a card element and redraw its canvas from scratch.
function redrawLayerCanvas(effect, cardEl) {
  const canvas = cardEl.querySelector("canvas");
  if (!canvas) return;
  // Recover the layer by matching the canvas position among cards.
  const cards = Array.from(rightCol.querySelectorAll(".layer-card"));
  const idx = cards.indexOf(cardEl);
  const layer = effect.layers[idx];
  if (!layer) return;
  drawViz(canvas, compileLayer(effect, layer), layer);
}

/* ---- advanced drawer: extra macros, register inspector, manual editing ---- */

function advancedPanel(effect, layer, prog) {
  const m = layer.macro;
  const adv = el("div", "adv");
  adv.appendChild(el("h2", null, "Advanced"));

  if (layer.mode === "sequence") {
    // Bend, jump and vibrato shape a single tone; compileSequence ignores
    // them, so offering the sliders here would only mislead.
    adv.appendChild(el("p", "hint", "Bend, jump and vibrato apply to single-tone layers only — a sequence's pitch comes from its notes."));
    const tickRow = el("div", "row");
    tickRow.appendChild(el("span", "hint", "Tick rate (Hz)"));
    const tickIn = numberInput(effect.tickHz, 15, 120);
    tickIn.addEventListener("change", () => { effect.tickHz = clampInt(tickIn.value, 15, 120); renderRight(); });
    tickRow.append(tickIn, el("span", "hint", "frames per second the effect steps at"));
    adv.appendChild(tickRow);
  } else if (layer.mode !== "manual") {
    const grid = el("div", "adv-grid");
    grid.appendChild(sliderRow("Sustain", m.sustain, 0, 1, 0.02, v => m.sustain = v, effect, v => v.toFixed(2)));
    grid.appendChild(sliderRow("Bend amt", m.bendAmount, 0, 1, 0.02, v => m.bendAmount = v, effect, v => v.toFixed(2)));
    grid.appendChild(sliderRow("Jump", m.jump, -24, 24, 1, v => m.jump = Math.round(v), effect, v => (v > 0 ? "+" : "") + Math.round(v) + " st"));
    grid.appendChild(sliderRow("Jump at", m.jumpAt, 0, 1, 0.02, v => m.jumpAt = v, effect, v => v.toFixed(2)));
    grid.appendChild(sliderRow("Vib rate", m.vibratoRate, 0, 1, 0.02, v => m.vibratoRate = v, effect, v => v.toFixed(2)));
    grid.appendChild(sliderRow("Vib depth", m.vibratoDepth, 0, 1, 0.02, v => m.vibratoDepth = v, effect, v => v.toFixed(2)));
    adv.appendChild(grid);

    const tickRow = el("div", "row");
    tickRow.appendChild(el("span", "hint", "Tick rate (Hz)"));
    const tickIn = numberInput(effect.tickHz, 15, 120);
    tickIn.addEventListener("change", () => { effect.tickHz = clampInt(tickIn.value, 15, 120); renderRight(); });
    tickRow.append(tickIn, el("span", "hint", "frames per second the effect steps at"));
    adv.appendChild(tickRow);
    adv.appendChild(spacer(8));

    const edit = el("button", "tiny", "Edit frames by hand");
    edit.addEventListener("click", () => { freezeToManual(effect, layer); renderRight(); });
    adv.appendChild(edit);
  }

  // Sweep-channel caveat: falling/rising pitch is only truly hardware-swept on
  // Pulse 1. Everything here drives pitch in software per frame, so it works on
  // any channel, but flag when a strong bend sits off Pulse 1.
  if (layer.channel !== "pulse1" && layer.channel !== "noise" && Math.abs(m.bend) > 0.4) {
    adv.appendChild(el("p", "warn", "Note: strong pitch bends are cheapest on Pulse 1 (the only channel with a hardware sweep). This tool drives the bend in software, which is fine but uses a register write each frame."));
  }

  // Register inspector: first + middle + last frame.
  adv.appendChild(el("h2", null, "Registers (NRx0-NRx4)"));
  const regs = layerToRegisters(effect, layer);
  const scroll = el("div", "reg-scroll");
  const table = el("table", "reg-table");
  const thead = el("tr");
  ["frame", "NRx0", "NRx1", "NRx2", "NRx3", "NRx4"].forEach(h => thead.appendChild(el("th", null, h)));
  table.appendChild(thead);
  const show = pickFrameIndices(regs.frames.length);
  show.forEach(i => {
    const tr = el("tr");
    tr.appendChild(el("td", null, String(i)));
    const row = regs.frames[i];
    // A rest writes nothing at all, so there is no register row to show.
    if (!row) for (let k = 0; k < 5; k++) tr.appendChild(el("td", null, "—"));
    else row.forEach(b => tr.appendChild(el("td", null, "$" + b.toString(16).padStart(2, "0").toUpperCase())));
    table.appendChild(tr);
  });
  scroll.appendChild(table);
  adv.appendChild(scroll);
  return adv;
}

function pickFrameIndices(n) {
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  const set = new Set([0, 1, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 2, n - 1]);
  return Array.from(set).sort((a, b) => a - b);
}

/* ---- visualization ---- */

function drawViz(canvas, prog, layer) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#081820"; ctx.fillRect(0, 0, W, H);

  const frames = prog.frames;
  if (!frames.length) return;
  const pitchLane = { y: 6, h: H * 0.5 - 10 };
  const volLane = { y: H * 0.5 + 6, h: H * 0.5 - 12 };
  const bw = W / frames.length;

  // Midline separator.
  ctx.strokeStyle = "#18301f"; ctx.beginPath();
  ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5); ctx.stroke();

  // Pitch range for scaling.
  let pmin = Infinity, pmax = -Infinity;
  frames.forEach(f => {
    const p = prog.channel === "noise" ? f.noiseTone : noteFromFreq(f.freqHz);
    if (p < pmin) pmin = p; if (p > pmax) pmax = p;
  });
  if (pmax - pmin < 1) { pmax += 1; pmin -= 1; }

  // Pitch bars (green).
  ctx.fillStyle = "#88c070";
  frames.forEach((f, i) => {
    const p = prog.channel === "noise" ? f.noiseTone : noteFromFreq(f.freqHz);
    const norm = (p - pmin) / (pmax - pmin);
    const y = pitchLane.y + (1 - norm) * pitchLane.h;
    ctx.fillRect(i * bw, y, Math.max(1, bw - 0.5), 3);
  });

  // Volume bars (accent).
  ctx.fillStyle = "#b8f25a";
  frames.forEach((f, i) => {
    const norm = f.vol / 15;
    const h = norm * volLane.h;
    ctx.fillRect(i * bw, volLane.y + volLane.h - h, Math.max(1, bw - 0.5), h);
  });
}

/* ---- sequence editing: piano roll + note table, kept in sync ---- */

// Pitch window the roll draws: the notes' own range, padded, and never
// narrower than an octave so a one-note sequence still looks like music.
function rollRange(layer) {
  if (layer.channel === "noise") return { lo: 0, hi: 15 };
  const pitched = (layer.notes || []).filter(n => !n.rest).map(n => n.note);
  let lo = Math.min.apply(null, pitched.length ? pitched : [72]);
  let hi = Math.max.apply(null, pitched.length ? pitched : [72]);
  lo -= 2; hi += 2;
  while (hi - lo < 12) { hi += 1; lo -= 1; }
  return { lo: Math.max(24, lo), hi: Math.min(108, hi) };
}

function drawRoll(canvas, layer) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#081820"; ctx.fillRect(0, 0, W, H);

  const notes = layer.notes || [];
  const total = Math.max(1, sequenceFrames(layer));
  const { lo, hi } = rollRange(layer);
  const rows = hi - lo + 1;
  const rh = H / rows;
  const noise = layer.channel === "noise";

  // Lane stripes: the black keys on a pitched channel, every fourth step on
  // noise -- enough to read intervals off without a full grid.
  for (let p = lo; p <= hi; p++) {
    const black = noise ? (p % 4 === 0) : [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
    if (!black) continue;
    ctx.fillStyle = "#0d2028";
    ctx.fillRect(0, (hi - p) * rh, W, rh);
  }

  let x = 0;
  notes.forEach((n, i) => {
    const len = clampInt(n.len, 1, MAX_NOTE_FRAMES);
    const w = Math.max(2, (len / total) * W);
    if (!n.rest) {
      const p = noise ? Math.round(n.noiseTone) : n.note;
      const y = (hi - clampf(p, lo, hi)) * rh;
      const sel = state.selNote && state.selNote.layerId === layer.id && state.selNote.index === i;
      ctx.fillStyle = sel ? "#b8f25a" : "#88c070";
      ctx.fillRect(x + 0.5, y + 1, w - 1, Math.max(3, rh - 2));
      if (n.tie) {
        // A tie is drawn as a bridge into the next note: no re-attack there.
        ctx.fillStyle = "#e08a5a";
        ctx.fillRect(x + w - 3, y + 1, 3, Math.max(3, rh - 2));
      }
    }
    ctx.strokeStyle = "#18301f";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    x += w;
  });
}

// Hit-test: which note is under a fraction-of-width x, and is the pointer on
// its trailing edge (where a drag stretches it rather than transposing it)?
function rollHit(layer, fx) {
  const notes = layer.notes || [];
  const total = Math.max(1, sequenceFrames(layer));
  let acc = 0;
  for (let i = 0; i < notes.length; i++) {
    const len = clampInt(notes[i].len, 1, MAX_NOTE_FRAMES);
    const start = acc / total, end = (acc + len) / total;
    if (fx >= start && fx < end) return { index: i, edge: (end - fx) < Math.min(0.02, (end - start) * 0.35) };
    acc += len;
  }
  return null;
}

function attachRoll(canvas, effect, layer, sync) {
  let drag = null;
  const redraw = () => { drawRoll(canvas, layer); sync(); };

  const pos = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return { fx: clamp01((ev.clientX - rect.left) / rect.width), fy: clamp01((ev.clientY - rect.top) / rect.height) };
  };

  canvas.addEventListener("pointerdown", (ev) => {
    const { fx, fy } = pos(ev);
    const hit = rollHit(layer, fx);
    if (!hit) return;
    canvas.setPointerCapture(ev.pointerId);
    state.selNote = { layerId: layer.id, index: hit.index };
    drag = { index: hit.index, mode: hit.edge ? "len" : "pitch", startFx: fx, startLen: layer.notes[hit.index].len };
    if (drag.mode === "pitch") applyRollPitch(layer, hit.index, fy);
    redraw();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const { fx, fy } = pos(ev);
    if (drag.mode === "pitch") applyRollPitch(layer, drag.index, fy);
    else {
      // Stretch: the drag distance is read against the sequence's own length,
      // so dragging feels the same in a short chime and a long one.
      const total = Math.max(1, sequenceFrames(layer));
      const delta = Math.round((fx - drag.startFx) * total);
      layer.notes[drag.index].len = clampInt(drag.startLen + delta, 1, MAX_NOTE_FRAMES);
    }
    redraw();
  });
  const end = () => { if (!drag) return; drag = null; audio.play(effect); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.style.cursor = "pointer";
}

function applyRollPitch(layer, index, fy) {
  const { lo, hi } = rollRange(layer);
  const p = Math.round(hi - fy * (hi - lo + 1) + 0.5);
  const note = layer.notes[index];
  if (layer.channel === "noise") note.noiseTone = clampf(p, 0, 15);
  else note.note = clampInt(p, 24, 108);
  note.rest = false;
}

// Roll on the left, exact values on the right. Both edit the same notes: the
// table writes straight into the model and redraws the roll, and a roll drag
// pushes its new values back into the inputs (rather than rebuilding the
// table, which would drop focus mid-typing).
function sequencePanel(effect, layer) {
  const wrap = el("div", "seq-wrap");

  const rollWrap = el("div", "seq-roll");
  const canvas = document.createElement("canvas");
  canvas.width = 420; canvas.height = 200;
  rollWrap.appendChild(canvas);
  const rollHint = el("p", "hint", "Drag a note up/down to transpose, drag its right edge to stretch.");

  const tableWrap = el("div", "seq-table-wrap");
  // A structural edit (add/delete/move/rest) rebuilds the table; a value edit
  // only redraws the roll. Push model values back into the table's inputs
  // after a roll drag rather than rebuilding, which would drop focus.
  const structural = () => { rebuild(); drawRoll(canvas, layer); };
  const rebuild = () => {
    tableWrap.innerHTML = "";
    tableWrap.appendChild(seqTable(effect, layer, canvas, sync, structural));
  };
  const sync = () => {
    const inputs = tableWrap.querySelectorAll("[data-note-field]");
    inputs.forEach(inp => {
      const i = Number(inp.dataset.noteIndex);
      const n = layer.notes[i];
      if (!n) return;
      const f = inp.dataset.noteField;
      if (f === "pitch") inp.value = layer.channel === "noise" ? String(Math.round(n.noiseTone)) : noteName(n.note);
      else if (f === "len") inp.value = String(n.len);
    });
    tableWrap.querySelectorAll("tr[data-note-row]").forEach(tr => {
      const sel = state.selNote && state.selNote.layerId === layer.id && Number(tr.dataset.noteRow) === state.selNote.index;
      tr.classList.toggle("sel", !!sel);
    });
  };

  rebuild();
  drawRoll(canvas, layer);
  attachRoll(canvas, effect, layer, sync);

  const left = el("div");
  left.append(rollWrap, rollHint);
  wrap.append(left, tableWrap);
  return wrap;
}

function seqTable(effect, layer, canvas, sync, structural) {
  const box = el("div");
  const noise = layer.channel === "noise";
  const table = el("table", "seq-table");
  const head = el("tr");
  ["#", noise ? "tone" : "note", "len", "tie", "vol", ""].forEach(h => head.appendChild(el("th", null, h)));
  table.appendChild(head);

  const redraw = () => drawRoll(canvas, layer);

  layer.notes.forEach((n, i) => {
    const tr = el("tr");
    tr.dataset.noteRow = String(i);
    tr.addEventListener("click", () => { state.selNote = { layerId: layer.id, index: i }; redraw(); sync(); });
    tr.appendChild(el("td", null, String(i + 1)));

    // Pitch: note names for the pitched channels ("C5", "f#4"), a 0..15
    // number for noise. Anything unparseable leaves the note as it was.
    const pitchTd = el("td");
    const pitchIn = inputText(noise ? String(Math.round(n.noiseTone)) : noteName(n.note));
    pitchIn.className = "seq-in";
    pitchIn.style.width = "54px";
    pitchIn.dataset.noteField = "pitch";
    pitchIn.dataset.noteIndex = String(i);
    pitchIn.disabled = !!n.rest;
    pitchIn.addEventListener("change", () => {
      if (noise) n.noiseTone = clampf(Number(pitchIn.value) || 0, 0, 15);
      else {
        const midi = parseNoteName(pitchIn.value);
        if (midi != null) n.note = midi;
        pitchIn.value = noteName(n.note);
      }
      redraw(); audio.play(effect);
    });
    pitchTd.appendChild(pitchIn);
    tr.appendChild(pitchTd);

    const lenTd = el("td");
    const lenIn = numberInput(n.len, 1, MAX_NOTE_FRAMES);
    lenIn.className = "seq-in";
    lenIn.style.width = "54px";
    lenIn.dataset.noteField = "len";
    lenIn.dataset.noteIndex = String(i);
    lenIn.addEventListener("change", () => {
      n.len = clampInt(lenIn.value, 1, MAX_NOTE_FRAMES);
      lenIn.value = String(n.len);
      redraw(); audio.play(effect);
    });
    lenTd.appendChild(lenIn);
    tr.appendChild(lenTd);

    const tieTd = el("td");
    const tie = document.createElement("input");
    tie.type = "checkbox"; tie.checked = !!n.tie;
    tie.title = "Hold into the next note: no re-attack, the envelope carries on";
    tie.addEventListener("change", () => { n.tie = tie.checked; redraw(); audio.play(effect); });
    tieTd.appendChild(tie);
    tr.appendChild(tieTd);

    const volTd = el("td");
    const vol = numberInput(n.vol, 0, 15);
    vol.className = "seq-in";
    vol.style.width = "48px";
    vol.addEventListener("change", () => { n.vol = clampInt(vol.value, 0, 15); redraw(); audio.play(effect); });
    volTd.appendChild(vol);
    tr.appendChild(volTd);

    const actTd = el("td", "seq-act");
    const rest = el("button", "tiny" + (n.rest ? " active" : ""), "R");
    rest.title = "Rest: silence for this note's length";
    rest.addEventListener("click", () => { n.rest = !n.rest; structural(); audio.play(effect); });
    const dup = el("button", "tiny", "+");
    dup.title = "Duplicate this note below";
    dup.addEventListener("click", () => { layer.notes.splice(i + 1, 0, makeNote(JSON.parse(JSON.stringify(n)))); structural(); });
    const del = el("button", "tiny danger", "×");
    del.title = "Delete this note";
    del.disabled = layer.notes.length <= 1;
    del.addEventListener("click", () => { layer.notes.splice(i, 1); state.selNote = null; structural(); });
    actTd.append(rest, dup, del);
    tr.appendChild(actTd);

    table.appendChild(tr);
  });
  box.appendChild(table);

  const row = el("div", "row");
  row.style.marginTop = "8px";
  const add = el("button", "tiny", "Add note");
  add.addEventListener("click", () => {
    const last = layer.notes[layer.notes.length - 1] || makeNote();
    layer.notes.push(makeNote({ note: last.note, noiseTone: last.noiseTone, len: last.len, vol: last.vol }));
    structural();
  });
  const up = el("button", "tiny", "↑");
  up.title = "Move the selected note earlier";
  up.addEventListener("click", () => moveSelected(layer, -1, structural));
  const down = el("button", "tiny", "↓");
  down.title = "Move the selected note later";
  down.addEventListener("click", () => moveSelected(layer, 1, structural));
  row.append(add, up, down);
  box.appendChild(row);
  box.appendChild(el("p", "hint", "Length is in frames — 60 to the second at the default tick rate."));
  return box;
}

function moveSelected(layer, dir, structural) {
  const sel = state.selNote;
  if (!sel || sel.layerId !== layer.id) return;
  const j = sel.index + dir;
  if (j < 0 || j >= layer.notes.length) return;
  const [n] = layer.notes.splice(sel.index, 1);
  layer.notes.splice(j, 0, n);
  state.selNote = { layerId: layer.id, index: j };
  structural();
}

/* ---- manual frame painting (Option C / draw-the-shape) ---- */

function attachPaint(canvas, effect, layer) {
  const paint = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    const n = layer.steps.length;
    const i = clampInt(Math.floor(x * n), 0, n - 1);
    const step = layer.steps[i];
    if (y < 0.5) {
      // Top lane sets pitch.
      const norm = 1 - clamp01(y / 0.5);
      if (layer.channel === "noise") step.noiseTone = clampf(norm * 15, 0, 15);
      else step.note = Math.round(clampf(36 + norm * 60, 24, 108));
    } else {
      // Bottom lane sets volume.
      const norm = 1 - clamp01((y - 0.5) / 0.5);
      step.vol = clampInt(Math.round(norm * 15), 0, 15);
    }
    drawViz(canvas, compileLayer(effect, layer), layer);
  };
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointerdown", (ev) => { canvas.setPointerCapture(ev.pointerId); state.paintLane = true; paint(ev); });
  canvas.addEventListener("pointermove", (ev) => { if (state.paintLane) paint(ev); });
  canvas.addEventListener("pointerup", () => { state.paintLane = null; audio.play(effect); });
}

/* ---- small music helpers for readouts ---- */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteName(midi) {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
function noteFromFreq(hz) { return 69 + 12 * Math.log2(hz / 440); }

// "C5", "f#4", "Bb3" or a bare MIDI number -> MIDI note. Returns null when the
// text is not a note, so the table can leave the value it had alone.
function parseNoteName(text) {
  const s = String(text).trim();
  if (/^\d+$/.test(s)) return clampInt(s, 24, 108);
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s);
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return clampInt((Number(m[3]) + 1) * 12 + base + accidental, 24, 108);
}

/* ============================================================
   Wire up top bar + boot
   ============================================================ */

document.getElementById("btn-new").addEventListener("click", () => {
  if (!confirm("Start a new, empty SFX bank? Unsaved effects will be lost.")) return;
  state.project = makeDefaultProject();
  state.selectedEffectId = state.project.effects[0].id;
  render();
});
document.getElementById("btn-import").addEventListener("click", doImport);
document.getElementById("btn-export").addEventListener("click", doExport);

render();
