import { describe, expect, it } from "vitest";
import { CHIME_ARCHETYPES, generateChime, makeChimeLayer, rerollChimeLayer } from "./gbsfx-chimes.js";
import { MAX_NOTE_FRAMES, buildEffectProgram, makeEffect, makeProject, sequenceFrames } from "./gbsfx-core.js";

const KEYS = CHIME_ARCHETYPES.map(a => a.key);

describe("chime generation", () => {
  it("is deterministic in (archetype, seed)", () => {
    for (const key of KEYS) {
      const a = generateChime(key, 12345);
      const b = generateChime(key, 12345);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("draws a different phrase from a different seed", () => {
    for (const key of KEYS) {
      const seen = new Set();
      for (let seed = 1; seed <= 12; seed++) {
        seen.add(JSON.stringify(generateChime(key, seed).notes));
      }
      // A shape, not a fixed phrase: a dozen draws must not all be one tune.
      expect(seen.size).toBeGreaterThan(3);
    }
  });

  it("produces playable, in-range, ROM-sized chimes for every archetype", () => {
    for (const key of KEYS) {
      for (let seed = 0; seed < 24; seed++) {
        const chime = generateChime(key, seed);
        const sounding = chime.notes.filter(n => !n.rest);

        expect(sounding.length).toBeGreaterThanOrEqual(2);
        expect(chime.notes.length).toBeLessThanOrEqual(12);
        expect(chime.notes.at(-1).rest).toBe(false);   // never end on silence
        expect(chime.notes.at(-1).tie).toBe(false);    // nothing to tie into

        for (const n of sounding) {
          expect(n.note).toBeGreaterThanOrEqual(24);
          expect(n.note).toBeLessThanOrEqual(108);
          expect(n.len).toBeGreaterThanOrEqual(1);
          expect(n.len).toBeLessThanOrEqual(MAX_NOTE_FRAMES);
          expect(n.vol).toBeGreaterThan(0);
          expect(n.vol).toBeLessThanOrEqual(15);
        }

        // One gesture, not a scale exercise: two octaves is the ceiling.
        const pitches = sounding.map(n => n.note);
        expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(19);

        // Under three seconds at 60 Hz: a chime, not a song.
        const layer = { notes: chime.notes };
        expect(sequenceFrames(layer)).toBeLessThanOrEqual(180);

        // And it has to fit a ROM: compile the thing rather than trusting it.
        const project = makeProject(proj => makeEffect(proj, "custom"));
        const effect = project.effects[0];
        Object.assign(effect.layers[0], {
          channel: chime.channel, mode: "sequence", macro: chime.macro, notes: chime.notes,
        });
        expect(buildEffectProgram(effect).length).toBeLessThan(160);
      }
    }
  });

  it("shapes each archetype the way its name promises", () => {
    const pitchesOf = (key, seed) => generateChime(key, seed).notes.filter(n => !n.rest).map(n => n.note);
    for (let seed = 0; seed < 8; seed++) {
      const victory = pitchesOf("victory", seed);
      expect(victory.at(-1)).toBeGreaterThan(victory[0]);        // rises to its landing
      const sad = pitchesOf("sad", seed);
      expect(sad.at(-1)).toBeLessThan(sad[0]);                   // falls away
      const ui = generateChime("ui", seed).notes;
      expect(sequenceFrames({ notes: ui })).toBeLessThanOrEqual(20);  // a blip, not a tune
    }
  });

  it("holds the last note of a landing chime longer than the run into it", () => {
    for (const key of ["victory", "sad", "itemget", "levelup"]) {
      for (let seed = 0; seed < 8; seed++) {
        const notes = generateChime(key, seed).notes.filter(n => !n.rest);
        expect(notes.at(-1).len).toBeGreaterThan(notes[0].len);
      }
    }
  });
});

describe("chime layers", () => {
  it("records where it came from so it can be re-rolled", () => {
    const project = makeProject(proj => makeEffect(proj, "custom"));
    const layer = makeChimeLayer(project, "victory", 7);
    expect(layer.mode).toBe("sequence");
    expect(layer.chime).toEqual({ archetype: "victory", seed: 7 });

    const before = JSON.stringify(layer.notes);
    expect(rerollChimeLayer(layer, 8)).toBe(true);
    expect(layer.chime.seed).toBe(8);
    expect(JSON.stringify(layer.notes)).not.toBe(before);

    // Re-rolling back to the old seed restores the old phrase exactly.
    rerollChimeLayer(layer, 7);
    expect(JSON.stringify(layer.notes)).toBe(before);
  });

  it("refuses to re-roll a hand-authored layer", () => {
    expect(rerollChimeLayer({ mode: "sequence", notes: [] }, 1)).toBe(false);
  });
});
