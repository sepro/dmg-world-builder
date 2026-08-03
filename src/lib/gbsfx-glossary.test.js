import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GLOSSARY, GLOSSARY_GROUPS, GLOSSARY_KEYS, channelTermKey, demoEffect,
  glossaryByGroup, glossaryEntry,
} from "./gbsfx-glossary.js";
import { CHANNEL_ORDER, buildEffectProgram, compileLayer } from "./gbsfx-core.js";

const SOURCES = [
  "src/legacy/gbsfx-ui.js",
  "src/legacy/gb-sfx-generator.js",
  "src/legacy/gb-sfx-sequencer.js",
];

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const allSource = SOURCES.map(read).join("\n");

/* Every key the tools ask for by name: term("decay"), term("frame", "frames").
   The channel entries are reached through channelTermKey(layer.channel), which
   no regex can see, so they are listed explicitly below. */
function referencedKeys() {
  const keys = new Set();
  for (const m of allSource.matchAll(/\bterm(?:Label)?\(\s*"([a-z0-9-]+)"/g)) keys.add(m[1]);
  return keys;
}

// The label -> key table in gbsfx-ui.js, which is how the sliders get theirs.
function controlTerms() {
  const block = /export const CONTROL_TERMS = \{([\s\S]*?)\};/.exec(read("src/legacy/gbsfx-ui.js"));
  expect(block, "CONTROL_TERMS table not found in gbsfx-ui.js").not.toBeNull();
  const map = new Map();
  for (const m of block[1].matchAll(/"([^"]+)":\s*"([a-z0-9-]+)"/g)) map.set(m[1], m[2]);
  return map;
}

// Every control label the two tools build a row for: slider("Decay", ...),
// fieldRow("Tone", ...). These are what CONTROL_TERMS has to cover.
function controlLabels() {
  const names = new Set();
  for (const m of allSource.matchAll(/\b(?:slider|fieldRow)\(\s*"([^"]+)"/g)) names.add(m[1]);
  return names;
}

describe("glossary data", () => {
  it("gives every entry the four things an entry is", () => {
    for (const key of GLOSSARY_KEYS) {
      const e = GLOSSARY[key];
      expect(e.term, key).toBeTruthy();
      expect(e.short, key).toBeTruthy();
      // The hover blurb is one sentence; anything longer belongs in `plain`.
      expect(e.short.length, key + " blurb is too long for a popover").toBeLessThan(120);
      expect(e.plain, key).toBeTruthy();
      expect(e.hardware, key).toBeTruthy();
      expect(GLOSSARY_GROUPS.map(g => g.key), key + " has an unknown group").toContain(e.group);
    }
  });

  it("has no duplicate keys or terms", () => {
    expect(new Set(GLOSSARY_KEYS).size).toBe(GLOSSARY_KEYS.length);
    const terms = GLOSSARY_KEYS.map(k => GLOSSARY[k].term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("lists every entry exactly once when grouped for the browse-all modal", () => {
    const listed = glossaryByGroup().flatMap(g => g.entries.map(e => e.key));
    expect(listed.sort()).toEqual([...GLOSSARY_KEYS].sort());
  });

  it("covers all four channels", () => {
    for (const ch of CHANNEL_ORDER) {
      expect(glossaryEntry(channelTermKey(ch)), ch).not.toBeNull();
    }
  });
});

describe("glossary demos", () => {
  it("builds a playable A/B pair wherever one is offered", () => {
    for (const key of GLOSSARY_KEYS) {
      const demo = GLOSSARY[key].demo;
      if (!demo) continue;
      for (const side of [demo.a, demo.b]) {
        expect(side.label, key).toBeTruthy();
        const effect = side.build();
        expect(effect.layers.length, key).toBeGreaterThan(0);
        for (const layer of effect.layers) {
          const prog = compileLayer(effect, layer);
          expect(prog.frames.length, key + " / " + side.label).toBeGreaterThan(0);
          // A demo nobody can hear teaches nothing.
          expect(prog.frames.some(f => f.vol > 0), key + " / " + side.label + " is silent").toBe(true);
        }
        // The whole effect must survive the export path too, since the demos
        // are ordinary effects and nothing here is allowed to be special.
        expect(buildEffectProgram(effect).length).toBeGreaterThan(0);
      }
    }
  });

  it("differs only in the term being explained", () => {
    for (const key of GLOSSARY_KEYS) {
      const demo = GLOSSARY[key].demo;
      if (!demo) continue;
      const a = JSON.stringify(demo.a.build().layers.map(l => ({ ...l, id: 0 })));
      const b = JSON.stringify(demo.b.build().layers.map(l => ({ ...l, id: 0 })));
      const sameTick = demo.a.build().tickHz === demo.b.build().tickHz;
      expect(a !== b || !sameTick, key + " plays the same sound twice").toBe(true);
    }
  });

  it("keeps demos short enough to sit through", () => {
    for (const key of GLOSSARY_KEYS) {
      const demo = GLOSSARY[key].demo;
      if (!demo) continue;
      for (const side of [demo.a, demo.b]) {
        const effect = side.build();
        const frames = Math.max(...effect.layers.map(l => compileLayer(effect, l).frames.length));
        expect(frames / effect.tickHz, key + " / " + side.label).toBeLessThanOrEqual(2.5);
      }
    }
  });

  it("does not leak state between builds", () => {
    const first = JSON.stringify(demoEffect({ layers: [{}] }).layers[0].macro);
    demoEffect({ layers: [{ macro: { decay: 1, punch: 0 } }] });
    expect(JSON.stringify(demoEffect({ layers: [{}] }).layers[0].macro)).toBe(first);
  });
});

describe("glossary wiring", () => {
  it("resolves every key the two tools ask for", () => {
    for (const key of referencedKeys()) {
      expect(glossaryEntry(key), key + " is used in the UI but has no entry").not.toBeNull();
    }
  });

  it("has no entry the tools never surface", () => {
    const reachable = new Set([
      ...referencedKeys(),
      ...controlTerms().values(),
      ...CHANNEL_ORDER.map(channelTermKey),   // reached via channelTermKey()
    ]);
    const orphans = GLOSSARY_KEYS.filter(k => !reachable.has(k));
    expect(orphans, "entries no term in either tool points at").toEqual([]);
  });

  it("underlines every slider and dropdown the tools label", () => {
    const mapped = controlTerms();
    const unexplained = [...controlLabels()].filter(name => !mapped.has(name));
    expect(unexplained, "controls with no glossary term in CONTROL_TERMS").toEqual([]);
  });

  it("points CONTROL_TERMS at entries that exist", () => {
    for (const [name, key] of controlTerms()) {
      expect(glossaryEntry(key), name + " -> " + key).not.toBeNull();
    }
  });
});
