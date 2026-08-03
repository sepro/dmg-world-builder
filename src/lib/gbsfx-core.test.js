import { describe, expect, it } from "vitest";
import {
  DEFAULT_TICK_HZ, buildEffectProgram, compileLayer, exportC, importJson,
  layerToRegisters, makeEffect, makeNote, makeProject, parseNoteName, noteName,
  sequenceFrames, singleEffectProject,
} from "./gbsfx-core.js";

// A minimal project holding one sequence layer, built the way both tools do.
function seqProject(notes, macro) {
  const project = makeProject(proj => makeEffect(proj, "custom"));
  const effect = project.effects[0];
  const layer = effect.layers[0];
  layer.channel = "pulse1";
  layer.mode = "sequence";
  layer.notes = notes.map(n => makeNote(n));
  Object.assign(layer.macro, macro || {});
  return { project, effect, layer };
}

describe("sequence compilation", () => {
  it("spans exactly the notes' frames and keys each note once", () => {
    const { effect, layer } = seqProject([{ note: 72, len: 6 }, { note: 79, len: 10 }]);
    const prog = compileLayer(effect, layer);
    expect(prog.frames).toHaveLength(16);
    expect(sequenceFrames(layer)).toBe(16);
    expect(prog.frames.filter(f => f.trigger).map((f, i) => i)).toHaveLength(2);
    expect(prog.frames[0].trigger).toBe(true);
    expect(prog.frames[6].trigger).toBe(true);
  });

  it("carries one envelope through a tie instead of re-attacking", () => {
    const { effect, layer } = seqProject([{ note: 72, len: 4, tie: true }, { note: 76, len: 4 }]);
    const prog = compileLayer(effect, layer);
    // One trigger for the whole tied run, and the length counter counts down
    // to the end of the run rather than the end of the first note.
    expect(prog.frames.filter(f => f.trigger)).toHaveLength(1);
    expect(prog.frames[0].remain).toBe(8);
    // The second note still writes (its pitch differs) without keying.
    expect(prog.frames[4].write).toBe(true);
    expect(prog.frames[4].trigger).toBe(false);
  });

  it("writes nothing at all during a rest", () => {
    const { effect, layer } = seqProject([{ note: 72, len: 3 }, { rest: true, len: 3 }, { note: 72, len: 3 }]);
    const regs = layerToRegisters(effect, layer);
    expect(regs.frames.slice(3, 6).every(row => row === null)).toBe(true);
    expect(regs.frames[0]).not.toBeNull();
    expect(regs.frames[6]).not.toBeNull();
  });

  it("scales a note's attack volume by its own vol", () => {
    const loud = seqProject([{ note: 72, len: 4, vol: 15 }], { punch: 1, decay: 0 });
    const soft = seqProject([{ note: 72, len: 4, vol: 5 }], { punch: 1, decay: 0 });
    const a = compileLayer(loud.effect, loud.layer).frames[0].vol;
    const b = compileLayer(soft.effect, soft.layer).frames[0].vol;
    expect(b).toBeLessThan(a);
  });
});

describe("C export", () => {
  it("collapses held frames into the hold opcode", () => {
    // One long note: the frames after the first change nothing audible, so
    // they must cost a hold rather than seven bytes each.
    const { effect } = seqProject([{ note: 72, len: 120 }], { decay: 0, sustain: 1 });
    const bytes = buildEffectProgram(effect);
    expect(bytes).toContain(0x03);
    expect(bytes.length).toBeLessThan(40);
    expect(bytes[bytes.length - 1]).toBe(0x00);
  });

  it("keeps a whole chime inside a ROM-sized program", () => {
    const { effect } = seqProject([
      { note: 72, len: 6 }, { note: 76, len: 6 }, { note: 79, len: 6 }, { note: 84, len: 30 },
    ]);
    expect(buildEffectProgram(effect).length).toBeLessThan(80);
  });

  it("names the effect and ships the player", () => {
    const { effect } = seqProject([{ note: 72, len: 4 }]);
    effect.name = "win chime!";
    const { h, c } = exportC(singleEffectProject(effect));
    expect(h).toContain("#define SFX_WIN_CHIME_ 0");
    expect(c).toContain("sfx_hold");
    expect(c).toContain("sfx_data_0");
  });
});

describe("import", () => {
  it("keeps a sequence layer's notes and reports extra effects", () => {
    const { project } = seqProject([{ note: 72, len: 5 }, { note: 79, len: 9 }]);
    const doubled = JSON.parse(JSON.stringify(project));
    doubled.effects.push(JSON.parse(JSON.stringify(project.effects[0])));
    const { project: loaded, dropped } = importJson(JSON.stringify(doubled));
    expect(dropped).toBe(1);
    expect(loaded.effects).toHaveLength(1);
    expect(loaded.effects[0].layers[0].notes).toHaveLength(2);
    expect(loaded.effects[0].layers[0].mode).toBe("sequence");
  });

  it("falls back to the sliders for a sequence layer with no notes", () => {
    const { project } = seqProject([{ note: 72, len: 5 }]);
    project.effects[0].layers[0].notes = [];
    const { project: loaded } = importJson(JSON.stringify(project));
    expect(loaded.effects[0].layers[0].mode).toBe("macro");
  });

  it("backfills an older file's missing fields", () => {
    const bare = { effects: [{ name: "old", layers: [{ channel: "pulse1", macro: { baseNote: 60 } }] }] };
    const { project } = importJson(JSON.stringify(bare));
    const layer = project.effects[0].layers[0];
    expect(project.effects[0].tickHz).toBe(DEFAULT_TICK_HZ);
    expect(layer.mode).toBe("macro");
    expect(layer.gain).toBe(1);
    expect(layer.macro.punch).toBeGreaterThan(0);   // defaults filled in
  });

  it("rejects anything that is not a sound bank", () => {
    expect(() => importJson('{"tilesets":[]}')).toThrow();
  });
});

describe("note names", () => {
  it("round-trips through the table's text form", () => {
    for (const midi of [36, 60, 61, 72, 96]) {
      expect(parseNoteName(noteName(midi))).toBe(midi);
    }
    expect(parseNoteName("Bb3")).toBe(parseNoteName("A#3"));
    expect(parseNoteName("nonsense")).toBeNull();
  });
});
