// @ts-nocheck
/*
  gb-sfx-generator.js - the single-tone sound designer.

  Pick a category, refine a handful of semantic sliders, layer channels, and
  export. One sound at a time: exports are one sound per file, so there is no
  session library to get lost in -- New and Import replace what you have, and
  undo covers you if that was a mistake.

  Note *sequences* (chimes and jingles) live in the sequencer, `SFX - Seq`.
  This tool still loads, plays and exports a file containing one -- nothing a
  file carries is ever dropped by opening it here -- it just points at the
  other tool rather than duplicating its piano roll.

  The model, the compile pipeline and the exporter are shared:
  `src/lib/gbsfx-core.js`. Shared UI is `gbsfx-ui.js`.
*/

import { el, inputText, selectFrom, spacer, toggle } from "../lib/common.js";
import {
  CATEGORY_LIST, CHANNELS, CHANNEL_ORDER, DUTY_LABELS, WAVE_PRESET_NAMES,
  categoryMacro, compileLayer, freezeToManual, clamp01, clampf,
  makeEffect, makeLayer, makeProject, makeRng, mutateMacro, noteName, randomSeed,
  regenerateEffect,
} from "../lib/gbsfx-core.js";
import { audio } from "../lib/gbsfx-audio.js";
import {
  crossToolNotice, doExport, doImport, drawViz, fieldRow, layerHead, makeHistory,
  registerTable, sliderRow, tickRateRow, transportButtons, vizBlock, wireUndoUi,
} from "./gbsfx-ui.js";
import { term, wireGlossaryButton } from "./gbsfx-glossary-ui.js";

const SEQ_TOOL_HREF = "gb-sfx-sequencer.html";
const SEQ_TOOL_NAME = "SFX - Seq";

/* ============================================================
   Editor state (kept separate from the saved project)
   ============================================================ */

const state = {
  project: makeProject(proj => makeEffect(proj, "coin")),
  advanced: false,
  painting: false,          // a manual-mode drag is in progress
};

function effect() { return state.project.effects[0] || null; }

const history = makeHistory(
  () => state.project,
  (project) => { state.project = project; },
  () => refreshUndo(),
);
let refreshUndo = () => {};

/* ============================================================
   Rendering
   ============================================================ */

const leftCol = document.getElementById("left-col");
const rightCol = document.getElementById("right-col");

function render() {
  renderLeft();
  renderRight();
  refreshUndo();
}

function renderLeft() {
  leftCol.innerHTML = "";
  leftCol.appendChild(presetsCard());
  leftCol.appendChild(transportCard());
  leftCol.appendChild(chimeCard());
}

function presetsCard() {
  const card = el("div", "card");
  card.appendChild(el("h2", null, "New from preset"));
  card.appendChild(el("p", "hint", "Replaces the sound you are working on (undo brings it back)."));
  const grid = el("div", "preset-grid");
  CATEGORY_LIST.forEach(cat => {
    const b = el("button", "preset-btn");
    b.appendChild(document.createTextNode(cat.label));
    b.appendChild(el("small", null, cat.hint));
    b.addEventListener("click", () => {
      history.snapshot();
      state.project = makeProject(proj => makeEffect(proj, cat.key));
      regenerateEffect(effect());
      render();
      audio.play(effect());
    });
    grid.appendChild(b);
  });
  card.appendChild(grid);
  return card;
}

function transportCard() {
  const e = effect();
  const card = el("div", "card");
  card.appendChild(el("h2", null, "Transport"));
  const t = transportButtons(effect);

  const rnd = el("button", null, "Randomize");
  rnd.disabled = !e;
  rnd.addEventListener("click", () => {
    history.snapshot();
    e.seed = randomSeed();
    regenerateEffect(e); render(); audio.play(e);
  });
  const mut = el("button", null, "Mutate");
  mut.disabled = !e;
  mut.addEventListener("click", () => {
    history.snapshot();
    const rng = makeRng((e.seed = (e.seed + 0x9e3779b9) >>> 0));
    e.layers.forEach(l => { if (l.mode === "macro") mutateMacro(l.macro, rng, 0.2); });
    render(); audio.play(e);
  });
  t.append(rnd, mut);
  card.appendChild(t);

  if (e) {
    const seedRow = el("div", "seed-row");
    seedRow.style.marginTop = "10px";
    seedRow.appendChild(el("span", "hint")).appendChild(term("seed"));
    const seedIn = document.createElement("input");
    seedIn.type = "number"; seedIn.min = "0"; seedIn.max = String(0xffffffff);
    seedIn.value = String(e.seed);
    seedIn.style.width = "96px";
    seedIn.addEventListener("focus", () => history.arm());
    seedIn.addEventListener("change", () => {
      history.commit();
      e.seed = clampf(Math.round(Number(seedIn.value) || 0), 0, 0xffffffff);
      regenerateEffect(e); render(); audio.play(e);
    });
    seedRow.appendChild(seedIn);
    card.appendChild(seedRow);
  }
  return card;
}

// The pointer across: a chime is several notes, which is the other tool's job.
function chimeCard() {
  const card = el("div", "card");
  card.appendChild(el("h2", null, "Chimes and jingles"));
  const chimeHint = el("p", "hint");
  chimeHint.append(
    document.createTextNode("A victory fanfare or a fail sting is a "),
    term("sequence", "run of notes"),
    document.createTextNode(" rather than one tone — those are authored in the sequencer."),
  );
  card.appendChild(chimeHint);
  const link = document.createElement("a");
  link.href = SEQ_TOOL_HREF;
  link.className = "btn-link";
  link.textContent = "Open " + SEQ_TOOL_NAME + " ♪";
  card.appendChild(link);
  return card;
}

function renderRight() {
  rightCol.innerHTML = "";
  const e = effect();
  if (!e) { rightCol.appendChild(el("div", "note-empty", "No sound loaded. Pick a preset to start.")); return; }

  const card = el("div", "card");

  // Name + advanced toggle.
  const head = el("div", "row");
  const nameField = el("div", "field");
  nameField.style.flex = "1";
  nameField.appendChild(el("label", null, "Effect name"));
  const nameIn = inputText(e.name);
  nameIn.style.width = "100%";
  nameIn.addEventListener("focus", () => history.arm());
  nameIn.addEventListener("change", () => {
    history.commit();
    e.name = nameIn.value.trim() || e.name;
    render();
  });
  nameField.appendChild(nameIn);
  head.appendChild(nameField);
  head.appendChild(toggle("Advanced", state.advanced, v => { state.advanced = v; renderRight(); }));
  card.appendChild(head);
  card.appendChild(spacer(12));

  e.layers.forEach(layer => {
    card.appendChild(layer.mode === "sequence" ? sequenceLayerCard(e, layer) : layerCard(e, layer));
  });

  // Add-layer control (multi-channel effects).
  const addRow = el("div", "row");
  const addSel = selectFrom(CHANNEL_ORDER.map(c => ({ value: c, label: CHANNELS[c].label })), "noise", () => {});
  const addBtn = el("button", "tiny", "Add layer");
  addBtn.addEventListener("click", () => {
    history.snapshot();
    const l = makeLayer(state.project, "custom");
    l.channel = addSel.value;
    l.macro = categoryMacro(l.channel === "noise" ? "hit" : "blip");
    e.layers.push(l); renderRight(); refreshUndo();
  });
  const addLabel = el("span", "hint");
  addLabel.append(term("layer"), document.createTextNode(" a channel:"));
  addRow.append(addLabel, addSel, addBtn);
  card.appendChild(addRow);

  rightCol.appendChild(card);
}

/* ---- one layer's card: visualization + macro sliders + advanced ---- */

function layerCard(effect_, layer) {
  const card = el("div", "layer-card");
  card.appendChild(layerHead(effect_, layer, () => {
    history.snapshot();
    effect_.layers = effect_.layers.filter(l => l.id !== layer.id);
    renderRight(); refreshUndo();
  }));

  const canvas = vizBlock(card, effect_, layer, layer.mode === "manual" ? "drag to edit frames" : "");
  const redraw = () => drawViz(canvas, compileLayer(effect_, layer));
  if (layer.mode === "manual") attachPaint(canvas, effect_, layer, redraw);

  const m = layer.macro;
  const slider = (name, value, min, max, step, setter, fmt) => sliderRow({
    name, value, min, max, step, setter, fmt, history,
    onEdit: redraw,
    onCommit: () => audio.play(effect_),
  });
  const box = el("div");

  if (layer.mode === "manual") {
    const manualHint = el("p", "hint");
    manualHint.append(
      document.createTextNode("This layer is in "),
      term("macro-manual", "manual (hand-edited) mode"),
      document.createTextNode(". Sliders are paused."),
    );
    box.appendChild(manualHint);
    const back = el("button", "tiny", "Back to macro");
    back.addEventListener("click", () => {
      if (!confirm("Discard hand-edited frames and return to sliders?")) return;
      history.snapshot();
      layer.mode = "macro"; layer.steps = null;
      renderRight(); refreshUndo();
    });
    box.appendChild(back);
  } else {
    box.appendChild(slider("Length", m.lengthMs, 40, 2000, 10, v => m.lengthMs = v, v => Math.round(v) + " ms"));
    if (layer.channel === "noise") {
      box.appendChild(slider("Pitch", m.noiseTone, 0, 15, 0.1, v => m.noiseTone = v, v => v.toFixed(1)));
    } else {
      box.appendChild(slider("Pitch", m.baseNote, 36, 108, 1, v => m.baseNote = v, v => noteName(v)));
    }
    box.appendChild(slider("Bend", m.bend, -1, 1, 0.02, v => m.bend = v, v => (v > 0 ? "up " : v < 0 ? "down " : "") + Math.abs(v).toFixed(2)));
    box.appendChild(slider("Punch", m.punch, 0, 1, 0.02, v => m.punch = v, v => v.toFixed(2)));
    box.appendChild(slider("Decay", m.decay, 0, 1, 0.02, v => m.decay = v, v => v.toFixed(2)));
    box.appendChild(toneRow(effect_, layer, slider));
  }
  card.appendChild(box);

  if (state.advanced) card.appendChild(advancedPanel(effect_, layer, redraw, slider));
  return card;
}

// Timbre: duty on the pulses, a wavetable on wave, LFSR width on noise.
function toneRow(effect_, layer, slider) {
  const m = layer.macro;
  if (layer.channel === "wave") {
    return fieldRow("Tone", selectFrom(WAVE_PRESET_NAMES, layer.wavePreset, v => {
      history.snapshot();
      layer.wavePreset = v; renderRight(); refreshUndo(); audio.play(effect_);
    }));
  }
  if (layer.channel === "noise") {
    return fieldRow("Tone", selectFrom([{ value: 1, label: "15-bit hiss" }, { value: 0, label: "7-bit metallic" }], m.width, v => {
      history.snapshot();
      m.width = Number(v); renderRight(); refreshUndo(); audio.play(effect_);
    }));
  }
  return slider("Tone", m.duty, 0, 3, 1, v => m.duty = Math.round(v), v => DUTY_LABELS[Math.round(v)]);
}

/* A sequence layer, seen from this tool: played and exported like any other,
   but edited next door. Showing it read-only (rather than hiding or dropping
   it) is what keeps a chime's noise underlay editable here without the file
   losing its melody. */
function sequenceLayerCard(effect_, layer) {
  const card = el("div", "layer-card");
  card.appendChild(layerHead(effect_, layer, () => {
    history.snapshot();
    effect_.layers = effect_.layers.filter(l => l.id !== layer.id);
    renderRight(); refreshUndo();
  }));
  vizBlock(card, effect_, layer, "");
  const n = (layer.notes || []).length;
  card.appendChild(crossToolNotice(
    "This layer is a sequence of " + n + " note" + (n === 1 ? "" : "s") + ". It plays and exports from here; edit its notes in " + SEQ_TOOL_NAME + ".",
    SEQ_TOOL_HREF, "Open " + SEQ_TOOL_NAME + " →",
  ));
  return card;
}

/* ---- advanced drawer: extra macros, register inspector, manual editing ---- */

function advancedPanel(effect_, layer, redraw, slider) {
  const m = layer.macro;
  const adv = el("div", "adv");
  adv.appendChild(el("h2", null, "Advanced"));

  if (layer.mode !== "manual") {
    const grid = el("div", "adv-grid");
    grid.appendChild(slider("Sustain", m.sustain, 0, 1, 0.02, v => m.sustain = v, v => v.toFixed(2)));
    grid.appendChild(slider("Bend amt", m.bendAmount, 0, 1, 0.02, v => m.bendAmount = v, v => v.toFixed(2)));
    grid.appendChild(slider("Jump", m.jump, -24, 24, 1, v => m.jump = Math.round(v), v => (v > 0 ? "+" : "") + Math.round(v) + " st"));
    grid.appendChild(slider("Jump at", m.jumpAt, 0, 1, 0.02, v => m.jumpAt = v, v => v.toFixed(2)));
    grid.appendChild(slider("Vib rate", m.vibratoRate, 0, 1, 0.02, v => m.vibratoRate = v, v => v.toFixed(2)));
    grid.appendChild(slider("Vib depth", m.vibratoDepth, 0, 1, 0.02, v => m.vibratoDepth = v, v => v.toFixed(2)));
    adv.appendChild(grid);

    adv.appendChild(tickRateRow(effect_, () => { renderRight(); refreshUndo(); }, history));
    adv.appendChild(spacer(8));

    const edit = el("button", "tiny", "Edit frames by hand");
    edit.addEventListener("click", () => {
      history.snapshot();
      freezeToManual(effect_, layer);
      renderRight(); refreshUndo();
    });
    adv.appendChild(edit);
  }

  // Sweep-channel caveat: falling/rising pitch is only truly hardware-swept on
  // Pulse 1. Everything here drives pitch in software per frame, so it works on
  // any channel, but flag when a strong bend sits off Pulse 1.
  if (layer.channel !== "pulse1" && layer.channel !== "noise" && Math.abs(m.bend) > 0.4) {
    adv.appendChild(el("p", "warn", "Note: strong pitch bends are cheapest on Pulse 1 (the only channel with a hardware sweep). This tool drives the bend in software, which is fine but uses a register write each frame."));
  }

  adv.appendChild(registerTable(effect_, layer));
  return adv;
}

/* ---- manual frame painting (draw the shape) ---- */

function attachPaint(canvas, effect_, layer, redraw) {
  const paint = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    const n = layer.steps.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(x * n)));
    const step = layer.steps[i];
    history.commit();
    if (y < 0.5) {
      // Top lane sets pitch.
      const norm = 1 - clamp01(y / 0.5);
      if (layer.channel === "noise") step.noiseTone = clampf(norm * 15, 0, 15);
      else step.note = Math.round(clampf(36 + norm * 60, 24, 108));
    } else {
      // Bottom lane sets volume.
      const norm = 1 - clamp01((y - 0.5) / 0.5);
      step.vol = Math.round(clampf(norm * 15, 0, 15));
    }
    redraw();
  };
  canvas.style.cursor = "crosshair";
  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    history.arm();
    state.painting = true;
    paint(ev);
  });
  canvas.addEventListener("pointermove", (ev) => { if (state.painting) paint(ev); });
  canvas.addEventListener("pointerup", () => {
    if (!state.painting) return;
    state.painting = false;
    refreshUndo();
    audio.play(effect_);
  });
}

/* ============================================================
   Wire up top bar + boot
   ============================================================ */

const exportCtx = {
  getEffect: effect,
  applyProject: (project) => { history.snapshot(); state.project = project; render(); },
  otherToolHref: SEQ_TOOL_HREF,
  otherToolName: SEQ_TOOL_NAME,
};

document.getElementById("btn-new").addEventListener("click", () => {
  if (!confirm("Start a new sound? The current one will be replaced (undo brings it back).")) return;
  history.snapshot();
  state.project = makeProject(proj => makeEffect(proj, "coin"));
  render();
});
document.getElementById("btn-import").addEventListener("click", () => doImport(exportCtx));
document.getElementById("btn-export").addEventListener("click", () => doExport(exportCtx));
wireGlossaryButton();

refreshUndo = wireUndoUi(history, () => render());
render();
