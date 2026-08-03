/*
  gbsfx-audio.js - the Web Audio approximation of the four Game Boy channels,
  shared by both sound tools.

  `scheduleLayer` works against any BaseAudioContext, so the live preview and
  the offline WAV render are exactly one code path. This is a close
  approximation, not a cycle-accurate emulator (duty, for instance, is treated
  as constant across an effect), and it reads the same compiled program the C
  exporter does -- so what you hear is what the ROM plays, modulo that caveat.
*/

import {
  DUTY_FRACTION, WAVE_PRESETS, clampf, compileLayer, noiseFreqHz, noiseParams,
} from "./gbsfx-core.js";

export const audio = {
  /** @type {any} */ ctx: null,
  /** @type {any} */ master: null,
  /** @type {any[]} */ voices: [],
  playing: false,

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
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
    this.voices.forEach(v => { try { v.stop(); } catch (e) { /* already stopped */ } });
    this.voices = [];
    this.playing = false;
  },
};

// Render an effect to a mono 16-bit WAV via an offline context.
export async function renderWav(effect) {
  const sampleRate = 44100;
  let maxEnd = 0;
  effect.layers.forEach(layer => {
    const prog = compileLayer(effect, layer);
    maxEnd = Math.max(maxEnd, prog.frames.length / prog.tickHz);
  });
  const durSec = maxEnd + 0.12;
  const OAC = window.OfflineAudioContext || /** @type {any} */ (window).webkitOfflineAudioContext;
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

export function encodeWav(samples, sampleRate) {
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
