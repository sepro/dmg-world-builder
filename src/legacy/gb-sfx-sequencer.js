// @ts-nocheck
/*
  gb-sfx-sequencer.js - the note-sequence tool ("SFX - Seq").

  A macro layer is one tone: it can bend and jump, but it cannot play
  "C5, E5, G5, C6", which is exactly what a victory fanfare, a fail sting or
  an item-get flourish is. This tool authors those -- a list of notes played
  through one timbre -- on a piano roll and a note table that edit the same
  model side by side.

  Chimes start procedurally: each button on the left is an **archetype**
  (chord, contour, pacing, timbre) and one press is a deterministic draw from
  it, so Re-roll hunts for a good one and the seed makes it reproducible.
  After the draw it is an ordinary sequence -- every note can be edited, and
  nothing downstream knows it was generated.

  Single-tone sounds are the other tool, `SFX`. A file holding one still
  loads, plays and exports from here; its layer is shown read-only with the
  way across rather than duplicating that tool's sliders.

  Model, compile pipeline and exporter: `src/lib/gbsfx-core.js`. Chime
  generation: `src/lib/gbsfx-chimes.js`. Shared UI: `gbsfx-ui.js`.
*/

import { el, inputText, numberInput, selectFrom, spacer, toggle, clampInt } from "../lib/common.js";
import {
  CHANNELS, CHANNEL_ORDER, DUTY_LABELS, MAX_NOTE_FRAMES, WAVE_PRESET_NAMES,
  clamp01, clampf, compileLayer, makeLayer, makeNote, makeProject, noteName,
  parseNoteName, randomSeed, sequenceFrames,
} from "../lib/gbsfx-core.js";
import { CHIME_ARCHETYPES, makeChimeLayer, rerollChimeLayer } from "../lib/gbsfx-chimes.js";
import { audio } from "../lib/gbsfx-audio.js";
import {
  crossToolNotice, doExport, doImport, drawViz, fieldRow, layerHead, makeHistory,
  registerTable, sliderRow, tickRateRow, transportButtons, vizBlock, wireUndoUi,
} from "./gbsfx-ui.js";
import { term, wireGlossaryButton } from "./gbsfx-glossary-ui.js";

const SFX_TOOL_HREF = "gb-sfx-generator.html";
const SFX_TOOL_NAME = "SFX";

// The roll reserves a strip along its bottom for per-note volume, so a
// volume edit is visible in the same picture as the pitches (and can be
// dragged there directly).
const ROLL_VOL_H = 34;

/* ============================================================
   Editor state (kept separate from the saved project)
   ============================================================ */

const state = {
  project: null,
  advanced: false,
  selNote: null,            // { layerId, index } selected note in a sequence layer
};

function effect() { return state.project.effects[0] || null; }

// A fresh sound is a chime rather than an empty grid: there is always
// something to hear, and the first press of Re-roll has somewhere to go.
function newChimeProject(archetypeKey, seed) {
  const key = archetypeKey || CHIME_ARCHETYPES[0].key;
  const s = seed == null ? randomSeed() : seed;
  return makeProject(proj => {
    const id = proj.nextId++;
    return {
      id,
      name: key + "_" + id,
      seed: s,
      tickHz: 60,
      layers: [makeChimeLayer(proj, key, s)],
    };
  });
}
state.project = newChimeProject(CHIME_ARCHETYPES[0].key);

const history = makeHistory(
  () => state.project,
  (project) => { state.project = project; },
  () => refreshUndo(),
);
let refreshUndo = () => {};

// Re-roll every generated layer of the effect from one visible seed. Layers
// are offset by the golden ratio so two chimes in one sound don't draw the
// same phrase.
function rerollEffect(e, seed) {
  e.seed = seed >>> 0;
  let any = false;
  e.layers.forEach((layer, i) => {
    if (rerollChimeLayer(layer, (e.seed + Math.imul(i, 0x9e3779b9)) >>> 0)) any = true;
  });
  return any;
}

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
  leftCol.appendChild(chimesCard());
  leftCol.appendChild(transportCard());
  leftCol.appendChild(sfxLinkCard());
}

function chimesCard() {
  const card = el("div", "card");
  card.appendChild(el("h2", null, "New chime"));
  card.appendChild(el("p", "hint", "Each is a shape, not a fixed phrase — press again for another draw. Replaces the sound you are working on (undo brings it back)."));
  const grid = el("div", "preset-grid");
  CHIME_ARCHETYPES.forEach(a => {
    const b = el("button", "preset-btn");
    b.appendChild(document.createTextNode(a.label));
    b.appendChild(el("small", null, a.hint));
    b.addEventListener("click", () => {
      history.snapshot();
      state.project = newChimeProject(a.key);
      state.selNote = null;
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

  const roll = el("button", null, "Re-roll");
  roll.title = "Draw new notes from the same archetype";
  roll.addEventListener("click", () => {
    history.snapshot();
    if (!rerollEffect(e, randomSeed())) {
      alert("Nothing to re-roll: these notes were authored by hand, not generated. Start from a chime button to get a re-rollable sound.");
      return;
    }
    state.selNote = null;
    render(); audio.play(e);
  });
  t.append(roll);
  card.appendChild(t);

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
    rerollEffect(e, Math.max(0, Math.round(Number(seedIn.value) || 0)));
    state.selNote = null;
    render(); audio.play(e);
  });
  seedRow.appendChild(seedIn);
  card.appendChild(seedRow);
  card.appendChild(el("p", "hint", "The seed reproduces a generated chime exactly. Editing notes by hand leaves it behind as a record."));
  return card;
}

function sfxLinkCard() {
  const card = el("div", "card");
  card.appendChild(el("h2", null, "Single-tone effects"));
  card.appendChild(el("p", "hint", "A hit, a laser, an explosion — one tone with a bend and an envelope — is the other tool."));
  const link = document.createElement("a");
  link.href = SFX_TOOL_HREF;
  link.className = "btn-link";
  link.textContent = "Open " + SFX_TOOL_NAME + " ♪";
  card.appendChild(link);
  return card;
}

function renderRight() {
  rightCol.innerHTML = "";
  const e = effect();
  if (!e) { rightCol.appendChild(el("div", "note-empty", "No sound loaded. Pick a chime to start.")); return; }

  const card = el("div", "card");

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
    card.appendChild(layer.mode === "sequence" ? sequenceLayerCard(e, layer) : singleToneLayerCard(e, layer));
  });

  const addRow = el("div", "row");
  const addSel = selectFrom(CHANNEL_ORDER.map(c => ({ value: c, label: CHANNELS[c].label })), "pulse2", () => {});
  const addBtn = el("button", "tiny", "Add sequence layer");
  addBtn.title = "A second voice: harmony under the melody, or a noise pulse under both";
  addBtn.addEventListener("click", () => {
    history.snapshot();
    const l = makeLayer(state.project, "custom");
    l.channel = addSel.value;
    l.mode = "sequence";
    l.macro.punch = 0.75; l.macro.decay = 0.3; l.macro.duty = 2;
    // Start on a note the roll can draw rather than an empty grid.
    l.notes = [makeNote({ note: 72, noiseTone: 8, len: 8 })];
    e.layers.push(l); renderRight(); refreshUndo();
  });
  const addLabel = el("span", "hint");
  addLabel.append(term("layer"), document.createTextNode(" a channel:"));
  addRow.append(addLabel, addSel, addBtn);
  card.appendChild(addRow);

  rightCol.appendChild(card);
}

/* ---- one sequence layer: roll + table + the timbre every note is struck with ---- */

function sequenceLayerCard(e, layer) {
  const card = el("div", "layer-card");
  card.appendChild(layerHead(e, layer, () => {
    history.snapshot();
    e.layers = e.layers.filter(l => l.id !== layer.id);
    state.selNote = null;
    renderRight(); refreshUndo();
  }));

  // The compiled pitch/volume picture, and the roll. Every edit below
  // refreshes *both*: the roll shows what is authored, the viz shows what
  // the envelope actually does with it, and a volume edit changes both.
  const vizCanvas = vizBlock(card, e, layer, "");
  const panel = sequencePanel(e, layer, () => drawViz(vizCanvas, compileLayer(e, layer)));
  card.appendChild(panel.node);

  if (layer.chime) card.appendChild(chimeRow(e, layer));

  const m = layer.macro;
  const refresh = () => { panel.redraw(); drawViz(vizCanvas, compileLayer(e, layer)); };
  const slider = (name, value, min, max, step, setter, fmt) => sliderRow({
    name, value, min, max, step, setter, fmt, history,
    onEdit: refresh,
    onCommit: () => audio.play(e),
  });

  const box = el("div");
  // Pitch and length come from the notes; bend/jump/vibrato are single-tone
  // shaping and are ignored by the sequence compiler. What is left is the
  // timbre and the envelope every note is struck with.
  const timbreHint = el("p", "hint");
  timbreHint.append(
    document.createTextNode("Timbre and "),
    term("envelope"),
    document.createTextNode(" for every note in the sequence. Pitch and length are the notes' own."),
  );
  box.appendChild(timbreHint);
  box.appendChild(slider("Punch", m.punch, 0, 1, 0.02, v => m.punch = v, v => v.toFixed(2)));
  box.appendChild(slider("Decay", m.decay, 0, 1, 0.02, v => m.decay = v, v => v.toFixed(2)));
  box.appendChild(slider("Sustain", m.sustain, 0, 1, 0.02, v => m.sustain = v, v => v.toFixed(2)));
  if (layer.channel === "wave") {
    box.appendChild(fieldRow("Tone", selectFrom(WAVE_PRESET_NAMES, layer.wavePreset, v => {
      history.snapshot(); layer.wavePreset = v; renderRight(); refreshUndo(); audio.play(e);
    })));
  } else if (layer.channel === "noise") {
    box.appendChild(fieldRow("Tone", selectFrom([{ value: 1, label: "15-bit hiss" }, { value: 0, label: "7-bit metallic" }], m.width, v => {
      history.snapshot(); m.width = Number(v); renderRight(); refreshUndo(); audio.play(e);
    })));
  } else {
    box.appendChild(slider("Tone", m.duty, 0, 3, 1, v => m.duty = Math.round(v), v => DUTY_LABELS[Math.round(v)]));
  }
  card.appendChild(box);

  if (state.advanced) {
    const adv = el("div", "adv");
    adv.appendChild(el("h2", null, "Advanced"));
    adv.appendChild(el("p", "hint", "Bend, jump and vibrato apply to single-tone layers only — a sequence's pitch comes from its notes."));
    adv.appendChild(tickRateRow(e, () => { renderRight(); refreshUndo(); }, history));
    adv.appendChild(registerTable(e, layer));
    card.appendChild(adv);
  }
  return card;
}

// Which archetype this layer was drawn from, and a way to draw again.
function chimeRow(e, layer) {
  const row = el("div", "chime-row");
  row.appendChild(el("span", "hint")).appendChild(term("archetype"));
  row.appendChild(selectFrom(
    CHIME_ARCHETYPES.map(a => ({ value: a.key, label: a.label })),
    layer.chime.archetype,
    (v) => {
      history.snapshot();
      layer.chime.archetype = v;
      rerollChimeLayer(layer, layer.chime.seed);
      state.selNote = null;
      renderRight(); refreshUndo(); audio.play(e);
    },
  ));
  const roll = el("button", "tiny", "Re-roll layer");
  roll.addEventListener("click", () => {
    history.snapshot();
    rerollChimeLayer(layer, randomSeed());
    state.selNote = null;
    renderRight(); refreshUndo(); audio.play(e);
  });
  row.appendChild(roll);
  return row;
}

/* A single-tone layer, seen from this tool: played and exported like any
   other, edited next door. */
function singleToneLayerCard(e, layer) {
  const card = el("div", "layer-card");
  card.appendChild(layerHead(e, layer, () => {
    history.snapshot();
    e.layers = e.layers.filter(l => l.id !== layer.id);
    renderRight(); refreshUndo();
  }));
  vizBlock(card, e, layer, "");
  card.appendChild(crossToolNotice(
    "This layer is a single tone (" + layer.mode + " mode). It plays and exports from here; edit it in " + SFX_TOOL_NAME + ".",
    SFX_TOOL_HREF, "Open " + SFX_TOOL_NAME + " →",
  ));
  return card;
}

/* ---- the piano roll ---- */

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
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const pitchH = H - ROLL_VOL_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#081820"; ctx.fillRect(0, 0, W, H);

  const notes = layer.notes || [];
  const total = Math.max(1, sequenceFrames(layer));
  const { lo, hi } = rollRange(layer);
  const rows = hi - lo + 1;
  const rh = pitchH / rows;
  const noise = layer.channel === "noise";

  // Lane stripes: the black keys on a pitched channel, every fourth step on
  // noise -- enough to read intervals off without a full grid.
  for (let p = lo; p <= hi; p++) {
    const black = noise ? (p % 4 === 0) : [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
    if (!black) continue;
    ctx.fillStyle = "#0d2028";
    ctx.fillRect(0, (hi - p) * rh, W, rh);
  }

  // The volume strip along the bottom: one bar per note, draggable. Without
  // it a `vol` edit changed nothing you could see on the roll.
  ctx.fillStyle = "#0a1a20";
  ctx.fillRect(0, pitchH, W, ROLL_VOL_H);
  ctx.strokeStyle = "#18301f";
  ctx.beginPath(); ctx.moveTo(0, pitchH + 0.5); ctx.lineTo(W, pitchH + 0.5); ctx.stroke();

  let x = 0;
  notes.forEach((n, i) => {
    const len = clampInt(n.len, 1, MAX_NOTE_FRAMES);
    const w = Math.max(2, (len / total) * W);
    const sel = state.selNote && state.selNote.layerId === layer.id && state.selNote.index === i;
    if (!n.rest) {
      const p = noise ? Math.round(n.noiseTone) : n.note;
      const y = (hi - clampf(p, lo, hi)) * rh;
      ctx.fillStyle = sel ? "#b8f25a" : "#88c070";
      ctx.fillRect(x + 0.5, y + 1, w - 1, Math.max(3, rh - 2));
      if (n.tie) {
        // A tie is drawn as a bridge into the next note: no re-attack there.
        ctx.fillStyle = "#e08a5a";
        ctx.fillRect(x + w - 3, y + 1, 3, Math.max(3, rh - 2));
      }
      // Volume bar for this note.
      const vh = (clampInt(n.vol, 0, 15) / 15) * (ROLL_VOL_H - 6);
      ctx.fillStyle = sel ? "#b8f25a" : "#346856";
      ctx.fillRect(x + 0.5, H - 3 - vh, w - 1, vh);
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

function attachRoll(canvas, e, layer, sync, refresh) {
  let drag = null;
  const redraw = () => { drawRoll(canvas, layer); refresh(); sync(); };

  const pos = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      fx: clamp01((ev.clientX - rect.left) / rect.width),
      fy: clamp01((ev.clientY - rect.top) / rect.height),
    };
  };
  // The bottom strip is the volume lane; everything above it is pitch.
  const volLane = (fy) => fy * canvas.height >= canvas.height - ROLL_VOL_H;

  canvas.addEventListener("pointerdown", (ev) => {
    const { fx, fy } = pos(ev);
    const hit = rollHit(layer, fx);
    if (!hit) return;
    canvas.setPointerCapture(ev.pointerId);
    history.arm();
    state.selNote = { layerId: layer.id, index: hit.index };
    drag = {
      index: hit.index,
      mode: volLane(fy) ? "vol" : (hit.edge ? "len" : "pitch"),
      startFx: fx,
      startLen: layer.notes[hit.index].len,
    };
    if (drag.mode === "pitch") { history.commit(); applyRollPitch(layer, hit.index, fy, canvas.height); }
    else if (drag.mode === "vol") { history.commit(); applyRollVol(layer, hit.index, fy, canvas.height); }
    redraw();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const { fx, fy } = pos(ev);
    history.commit();
    if (drag.mode === "pitch") applyRollPitch(layer, drag.index, fy, canvas.height);
    else if (drag.mode === "vol") applyRollVol(layer, drag.index, fy, canvas.height);
    else {
      // Stretch: the drag distance is read against the sequence's own length,
      // so dragging feels the same in a short chime and a long one.
      const total = Math.max(1, sequenceFrames(layer));
      const delta = Math.round((fx - drag.startFx) * total);
      layer.notes[drag.index].len = clampInt(drag.startLen + delta, 1, MAX_NOTE_FRAMES);
    }
    redraw();
  });
  const end = () => { if (!drag) return; drag = null; refreshUndo(); audio.play(e); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.style.cursor = "pointer";
}

function applyRollPitch(layer, index, fy, canvasH) {
  const { lo, hi } = rollRange(layer);
  // fy spans the whole canvas, but the pitch rows only occupy the part above
  // the volume strip -- rescale before mapping onto a row.
  const t = clamp01((fy * canvasH) / (canvasH - ROLL_VOL_H));
  const p = Math.round(hi - t * (hi - lo + 1) + 0.5);
  const note = layer.notes[index];
  if (layer.channel === "noise") note.noiseTone = clampf(p, 0, 15);
  else note.note = clampInt(p, 24, 108);
  note.rest = false;
}

// The strip's bars run from 3px above the bottom edge up to its top + 3.
function applyRollVol(layer, index, fy, canvasH) {
  const norm = clamp01((canvasH - 3 - fy * canvasH) / (ROLL_VOL_H - 6));
  layer.notes[index].vol = clampInt(Math.round(norm * 15), 0, 15);
}

/* ---- roll + table, editing one model ----
   The table writes straight into the notes and redraws the roll; a roll drag
   pushes its new values back into the table's inputs rather than rebuilding
   it, which would drop focus mid-typing. `refresh` is the layer's compiled
   visualization, redrawn on every edit -- including volume, which used to
   change nothing you could see. */
function sequencePanel(e, layer, refresh) {
  const wrap = el("div", "seq-wrap");

  const rollWrap = el("div", "seq-roll");
  const canvas = document.createElement("canvas");
  canvas.width = 420; canvas.height = 200 + ROLL_VOL_H;
  rollWrap.appendChild(canvas);
  const rollHint = el("p", "hint", "Drag a note up/down to transpose, its right edge to stretch, or its bar in the strip below to set volume.");

  const tableWrap = el("div", "seq-table-wrap");
  const redrawAll = () => { drawRoll(canvas, layer); refresh(); };
  const structural = () => { rebuild(); redrawAll(); };
  const rebuild = () => {
    tableWrap.innerHTML = "";
    tableWrap.appendChild(seqTable(e, layer, redrawAll, sync, structural));
  };
  const sync = () => {
    tableWrap.querySelectorAll("[data-note-field]").forEach(inp => {
      const i = Number(inp.dataset.noteIndex);
      const n = layer.notes[i];
      if (!n) return;
      const f = inp.dataset.noteField;
      if (f === "pitch") inp.value = layer.channel === "noise" ? String(Math.round(n.noiseTone)) : noteName(n.note);
      else if (f === "len") inp.value = String(n.len);
      else if (f === "vol") inp.value = String(n.vol);
    });
    tableWrap.querySelectorAll("tr[data-note-row]").forEach(tr => {
      const sel = state.selNote && state.selNote.layerId === layer.id && Number(tr.dataset.noteRow) === state.selNote.index;
      tr.classList.toggle("sel", !!sel);
    });
  };

  rebuild();
  drawRoll(canvas, layer);
  attachRoll(canvas, e, layer, sync, refresh);

  const left = el("div");
  left.append(rollWrap, rollHint);
  wrap.append(left, tableWrap);
  return { node: wrap, redraw: () => { drawRoll(canvas, layer); sync(); } };
}

function seqTable(e, layer, redrawAll, sync, structural) {
  const box = el("div");
  const noise = layer.channel === "noise";
  const table = el("table", "seq-table");
  const head = el("tr");
  // Column headings double as the glossary hooks for the note model: what a
  // tie or a len of 8 means is answered where it is being typed.
  const heads = [
    document.createTextNode("#"),
    noise ? term("tone", "tone") : term("note", "note"),
    term("frame", "len"),
    term("tie", "tie"),
    term("volume", "vol"),
    document.createTextNode(""),
  ];
  heads.forEach(h => head.appendChild(el("th")).appendChild(h));
  table.appendChild(head);

  // Every value edit takes one undo step: arm on focus, commit on change.
  const armed = (input) => { input.addEventListener("focus", () => history.arm()); return input; };
  const commit = () => { history.commit(); refreshUndo(); };

  layer.notes.forEach((n, i) => {
    const tr = el("tr");
    tr.dataset.noteRow = String(i);
    tr.addEventListener("click", () => { state.selNote = { layerId: layer.id, index: i }; redrawAll(); sync(); });
    tr.appendChild(el("td", null, String(i + 1)));

    // Pitch: note names for the pitched channels ("C5", "f#4"), a 0..15
    // number for noise. Anything unparseable leaves the note as it was.
    const pitchTd = el("td");
    const pitchIn = armed(inputText(noise ? String(Math.round(n.noiseTone)) : noteName(n.note)));
    pitchIn.className = "seq-in";
    pitchIn.style.width = "54px";
    pitchIn.dataset.noteField = "pitch";
    pitchIn.dataset.noteIndex = String(i);
    pitchIn.disabled = !!n.rest;
    pitchIn.addEventListener("change", () => {
      commit();
      if (noise) n.noiseTone = clampf(Number(pitchIn.value) || 0, 0, 15);
      else {
        const midi = parseNoteName(pitchIn.value);
        if (midi != null) n.note = midi;
        pitchIn.value = noteName(n.note);
      }
      redrawAll(); audio.play(e);
    });
    pitchTd.appendChild(pitchIn);
    tr.appendChild(pitchTd);

    const lenTd = el("td");
    const lenIn = armed(numberInput(n.len, 1, MAX_NOTE_FRAMES));
    lenIn.className = "seq-in";
    lenIn.style.width = "54px";
    lenIn.dataset.noteField = "len";
    lenIn.dataset.noteIndex = String(i);
    lenIn.addEventListener("change", () => {
      commit();
      n.len = clampInt(lenIn.value, 1, MAX_NOTE_FRAMES);
      lenIn.value = String(n.len);
      redrawAll(); audio.play(e);
    });
    lenTd.appendChild(lenIn);
    tr.appendChild(lenTd);

    const tieTd = el("td");
    const tie = document.createElement("input");
    tie.type = "checkbox"; tie.checked = !!n.tie;
    tie.title = "Hold into the next note: no re-attack, the envelope carries on";
    tie.addEventListener("change", () => {
      history.snapshot();
      n.tie = tie.checked; redrawAll(); audio.play(e);
    });
    tieTd.appendChild(tie);
    tr.appendChild(tieTd);

    const volTd = el("td");
    const vol = armed(numberInput(n.vol, 0, 15));
    vol.className = "seq-in";
    vol.style.width = "48px";
    vol.dataset.noteField = "vol";
    vol.dataset.noteIndex = String(i);
    vol.addEventListener("change", () => {
      commit();
      n.vol = clampInt(vol.value, 0, 15);
      vol.value = String(n.vol);
      redrawAll(); audio.play(e);
    });
    volTd.appendChild(vol);
    tr.appendChild(volTd);

    const actTd = el("td", "seq-act");
    const rest = el("button", "tiny" + (n.rest ? " active" : ""), "R");
    rest.title = "Rest: silence for this note's length";
    rest.addEventListener("click", () => {
      history.snapshot();
      n.rest = !n.rest; structural(); audio.play(e);
    });
    const dup = el("button", "tiny", "+");
    dup.title = "Duplicate this note below";
    dup.addEventListener("click", () => {
      history.snapshot();
      layer.notes.splice(i + 1, 0, makeNote(JSON.parse(JSON.stringify(n))));
      structural();
    });
    const del = el("button", "tiny danger", "×");
    del.title = "Delete this note";
    del.disabled = layer.notes.length <= 1;
    del.addEventListener("click", () => {
      history.snapshot();
      layer.notes.splice(i, 1); state.selNote = null; structural();
    });
    actTd.append(rest, dup, del);
    tr.appendChild(actTd);

    table.appendChild(tr);
  });
  box.appendChild(table);

  const row = el("div", "row");
  row.style.marginTop = "8px";
  const add = el("button", "tiny", "Add note");
  add.addEventListener("click", () => {
    history.snapshot();
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
  const lenHint = el("p", "hint");
  lenHint.append(
    document.createTextNode("Length is in "),
    term("frame", "frames"),
    document.createTextNode(" — 60 to the second at the default tick rate. R turns a note into a "),
    term("rest"),
    document.createTextNode("."),
  );
  box.appendChild(lenHint);
  return box;
}

function moveSelected(layer, dir, structural) {
  const sel = state.selNote;
  if (!sel || sel.layerId !== layer.id) return;
  const j = sel.index + dir;
  if (j < 0 || j >= layer.notes.length) return;
  history.snapshot();
  const [n] = layer.notes.splice(sel.index, 1);
  layer.notes.splice(j, 0, n);
  state.selNote = { layerId: layer.id, index: j };
  structural();
}

/* ============================================================
   Wire up top bar + boot
   ============================================================ */

const exportCtx = {
  getEffect: effect,
  applyProject: (project) => { history.snapshot(); state.project = project; state.selNote = null; render(); },
  otherToolHref: SFX_TOOL_HREF,
  otherToolName: SFX_TOOL_NAME,
};

document.getElementById("btn-new").addEventListener("click", () => {
  if (!confirm("Start a new chime? The current sound will be replaced (undo brings it back).")) return;
  history.snapshot();
  state.project = newChimeProject(CHIME_ARCHETYPES[0].key);
  state.selNote = null;
  render();
});
document.getElementById("btn-import").addEventListener("click", () => doImport(exportCtx));
document.getElementById("btn-export").addEventListener("click", () => doExport(exportCtx));
wireGlossaryButton();

refreshUndo = wireUndoUi(history, () => render());
render();
