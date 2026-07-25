import { describe, expect, test } from "vitest";
import {
  barShouldPlay,
  densityProfile,
  enforceMonophony,
  gridRhythm,
  noteTiming,
  onsetTime,
} from "./music-rhythm.js";

function sequenceRng(values) {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("music rhythm", () => {
  test("rejected density slots become real rests instead of longer notes", () => {
    const rhythm = gridRhythm(16, 4, 0.5, 0.6, sequenceRng([0.9, 0.1, 0.9]), 0);
    expect(rhythm).toEqual([
      { step: 0, dur: 4, gate: 0.6 },
      { step: 8, dur: 4, gate: 0.6 },
    ]);
    expect(noteTiming(0, rhythm[0].dur, rhythm[0].gate, 0, 4).dur).toBeCloseTo(2.4);
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

  test("lower density means fewer attacks, shorter gates, and more phrase space", () => {
    const sparse = densityProfile("sparse");
    const busy = densityProfile("busy");
    expect(sparse.hit).toBeLessThan(busy.hit);
    expect(sparse.gate).toBeLessThan(busy.gate);
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
        const notes = gridRhythm(16, 2, profile.hit, profile.gate, rng, 0.2);
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
    expect(sparse).toBeLessThan(0.35);
    expect(busy).toBeGreaterThan(0.7);
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
