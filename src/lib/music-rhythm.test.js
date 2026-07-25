import { describe, expect, test } from "vitest";
import {
  barShouldPlay,
  cleanupPitchedTrack,
  densityProfile,
  enforceMonophony,
  gridRhythm,
  noteTiming,
  notationForValue,
  NOTE_GATE,
  onsetTime,
  restrainedSyncProbability,
} from "./music-rhythm.js";

function sequenceRng(values) {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("music rhythm", () => {
  test("rejected density slots become real rests instead of longer notes", () => {
    const rhythm = gridRhythm(16, 4, 0.5, NOTE_GATE, sequenceRng([0.9, 0.1, 0.9]), 0);
    expect(rhythm).toEqual([
      { step: 0, dur: 4, gate: NOTE_GATE },
      { step: 8, dur: 4, gate: NOTE_GATE },
    ]);
    expect(noteTiming(0, rhythm[0].dur, rhythm[0].gate, 0, 4).dur).toBeCloseTo(4);
  });

  test("quarter notes occupy a complete quarter-note duration", () => {
    expect(NOTE_GATE).toBe(1);
    expect(noteTiming(0, 4, NOTE_GATE, 0, 4)).toEqual({ t: 0, dur: 4 });
  });

  test("staff notation distinguishes quarter, eighth, sixteenth, and dotted values", () => {
    expect(notationForValue(4)).toMatchObject({ flags: 0, open: false, dotted: false });
    expect(notationForValue(2)).toMatchObject({ flags: 1, open: false, dotted: false });
    expect(notationForValue(1)).toMatchObject({ flags: 2, open: false, dotted: false });
    expect(notationForValue(3)).toMatchObject({ flags: 1, dotted: true });
    expect(notationForValue(8)).toMatchObject({ flags: 0, open: true, dotted: false });
  });

  test("ordinary syncopation is rare and explicit syncopation remains restrained", () => {
    expect(restrainedSyncProbability(0.35, "march")).toBeCloseTo(0.035);
    expect(restrainedSyncProbability(0.35, "syncopated")).toBeCloseTo(0.105);
  });

  test("syncopation cannot collide with the following slot on a one-step grid", () => {
    const rhythm = gridRhythm(4, 1, 1, 0.8, () => 0, 1);
    expect(rhythm.map((note) => note.step)).toEqual([0, 1, 2, 3]);
    expect(rhythm.every((note) => note.dur > 0)).toBe(true);
  });

  test("swing uses one timeline for pitched notes and drums", () => {
    expect(onsetTime(2, 50, 4)).toBeCloseTo(2.3);
    const timing = noteTiming(2, 2, 0.75, 50, 4);
    expect(timing.t).toBeCloseTo(2.3);
    expect(timing.dur).toBeCloseTo(1.275);
  });

  test("lower density means fewer attacks and more phrase space", () => {
    const sparse = densityProfile("sparse");
    const busy = densityProfile("busy");
    expect(sparse.hit).toBeLessThan(busy.hit);
    expect(sparse).not.toHaveProperty("gate");
    expect(busy).not.toHaveProperty("gate");
    expect(sparse.barRest.harmony).toBeGreaterThan(busy.barRest.harmony);
    expect(barShouldPlay("sparse", "harmony", 1, () => 0)).toBe(false);
    expect(barShouldPlay("sparse", "harmony", 0, () => 0)).toBe(true);
  });

  test("density produces a monotonic amount of air across many bars", () => {
    const rngFor = (seed) => {
      let value = seed >>> 0;
      return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 4294967296;
      };
    };
    const occupancy = (name) => {
      const profile = densityProfile(name);
      const rng = rngFor(12345);
      let sounding = 0;
      for (let bar = 0; bar < 200; bar++) {
        const notes = gridRhythm(16, 2, profile.hit, NOTE_GATE, rng, 0.2);
        sounding += notes.reduce((sum, note) =>
          sum + noteTiming(note.step, note.dur, note.gate, 0, 4).dur, 0);
      }
      return sounding / (200 * 16);
    };
    const sparse = occupancy("sparse");
    const medium = occupancy("medium");
    const busy = occupancy("busy");
    expect(sparse).toBeLessThan(medium);
    expect(medium).toBeLessThan(busy);
    expect(sparse).toBeLessThan(0.5);
    expect(busy).toBeGreaterThan(0.65);
  });

  test("cleanup merges repeated pitches only into paired double-length values", () => {
    const track = [0, 2, 4, 6].map((step) => {
      const timing = noteTiming(step, 2, NOTE_GATE, 0, 4);
      return { step, value: 2, gate: NOTE_GATE, midi: 60, vel: 80, ...timing };
    });
    cleanupPitchedTrack(track, { swing: 0, stepsPerBeat: 4, stepsPerBar: 8 });
    expect(track.map((note) => note.value)).toEqual([4, 4]);
    expect(track.map((note) => note.dur)).toEqual([expect.closeTo(4), expect.closeTo(4)]);
  });

  test("cleanup keeps logical notation equal to a clipped channel handoff", () => {
    const track = [
      { step: 0, value: 4, gate: NOTE_GATE, midi: 60, vel: 80, ...noteTiming(0, 4, NOTE_GATE, 0, 4) },
      { step: 2, value: 2, gate: NOTE_GATE, midi: 62, vel: 80, ...noteTiming(2, 2, NOTE_GATE, 0, 4) },
    ];
    cleanupPitchedTrack(track, { swing: 0, stepsPerBeat: 4, stepsPerBar: 16 });
    expect(track[0]).toMatchObject({ value: 2, dur: 2 });
    expect(notationForValue(track[0].value)).toMatchObject({ flags: 1, open: false });
  });

  test("cleanup does not sustain a repeated pitch across a bar line", () => {
    const track = [6, 8].map((step) => {
      const timing = noteTiming(step, 2, NOTE_GATE, 0, 4);
      return { step, value: 2, gate: NOTE_GATE, midi: 60, vel: 80, ...timing };
    });
    cleanupPitchedTrack(track, { swing: 0, stepsPerBeat: 4, stepsPerBar: 8 });
    expect(track).toHaveLength(2);
  });

  test("monophony clips overlaps and removes duplicate onsets", () => {
    const track = [
      { step: 0, t: 0, dur: 4 },
      { step: 2, t: 2, dur: 2 },
      { step: 2, t: 2, dur: 1 },
    ];
    enforceMonophony(track);
    expect(track).toHaveLength(2);
    expect(track[0].dur).toBe(2);
  });
});
