// @ts-nocheck
/*
  gbsfx-ui.js - the DOM pieces both sound tools share.

  The SFX generator (single-tone layers) and the SFX sequencer (note
  sequences) are two engines over one model, so everything that is neither
  tool's own idea lives here: the undo history, the pitch/volume
  visualization, the slider rows, the register inspector, and the
  import/export modals. Tool-specific panels stay in the tool's own file.
*/

import { el, label, spacer, numberInput, openModal, closeModal, downloadBlob, downloadText, copyText } from "../lib/common.js";
import {
  CHANNELS, compileLayer, cId, exportC, exportJson, importJson, layerToRegisters,
  noteFromFreq, singleEffectProject,
} from "../lib/gbsfx-core.js";
import { channelTermKey } from "../lib/gbsfx-glossary.js";
import { term, termLabel } from "./gbsfx-glossary-ui.js";
import { audio, renderWav } from "../lib/gbsfx-audio.js";

/* ============================================================
   Control labels -> glossary terms
   ============================================================
   Both tools build their sliders through `sliderRow`/`fieldRow` with a
   display name, so the name is the natural key: one table here underlines
   every control in both tools without a call site having to know the glossary
   exists. `gbsfx-glossary.test.js` fails if a name here has no entry, or if a
   tool grows a control this table has never heard of. */

export const CONTROL_TERMS = {
  "Length":    "length",
  "Pitch":     "pitch",
  "Bend":      "bend",
  "Bend amt":  "bend-amount",
  "Punch":     "punch",
  "Decay":     "decay",
  "Sustain":   "sustain",
  "Tone":      "tone",
  "Jump":      "jump",
  "Jump at":   "jump-at",
  "Vib rate":  "vibrato-rate",
  "Vib depth": "vibrato-depth",
  "Volume":    "volume",
};

// The label for a control row: an underlined term when we can explain it.
function controlLabel(name) {
  const key = CONTROL_TERMS[name];
  return key ? termLabel(key, name) : label(name);
}

/* ============================================================
   Undo / redo
   ============================================================
   Snapshots of the whole project as JSON, the same approach the world editor
   uses. Two ways to take one: `snapshot()` for a discrete action (a button
   that overwrites the settings), and `arm()` + `commit()` for a continuous
   one -- a slider drag arms on pointerdown and commits on its first
   mutation, so a whole drag collapses into a single undo step and a drag
   that changes nothing costs nothing.
*/

const HISTORY_LIMIT = 60;

export function makeHistory(getProject, setProject, onChange) {
  const past = [];
  const future = [];
  let pending = null;

  const notify = () => { if (onChange) onChange(); };

  return {
    arm() { pending = JSON.stringify(getProject()); },
    commit() {
      if (pending == null) return;
      past.push(pending);
      if (past.length > HISTORY_LIMIT) past.shift();
      future.length = 0;
      pending = null;
      notify();
    },
    snapshot() { this.arm(); this.commit(); },
    undo() {
      if (!past.length) return false;
      future.push(JSON.stringify(getProject()));
      setProject(JSON.parse(past.pop()));
      pending = null;
      notify();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(JSON.stringify(getProject()));
      setProject(JSON.parse(future.pop()));
      pending = null;
      notify();
      return true;
    },
    canUndo() { return past.length > 0; },
    canRedo() { return future.length > 0; },
    clear() { past.length = 0; future.length = 0; pending = null; notify(); },
  };
}

/* Wire the top bar's Undo/Redo buttons plus the usual keyboard shortcuts.
   `after` re-renders the page once the project has been swapped out. */
export function wireUndoUi(history, after) {
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  const run = (fn) => { if (fn()) after(); };
  if (undoBtn) undoBtn.addEventListener("click", () => run(() => history.undo()));
  if (redoBtn) redoBtn.addEventListener("click", () => run(() => history.redo()));
  window.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const key = ev.key.toLowerCase();
    if (key === "z" && !ev.shiftKey) { ev.preventDefault(); run(() => history.undo()); }
    else if ((key === "z" && ev.shiftKey) || key === "y") { ev.preventDefault(); run(() => history.redo()); }
  });
  return function refresh() {
    if (undoBtn) undoBtn.disabled = !history.canUndo();
    if (redoBtn) redoBtn.disabled = !history.canRedo();
  };
}

/* ============================================================
   Shared controls
   ============================================================ */

/* A labeled slider. `setter` writes into the model, `onEdit` redraws whatever
   the caller wants refreshed, and `history` collapses the drag into one undo
   step. Playing on release (not during) keeps a drag from stuttering. */
export function sliderRow(opts) {
  const { name, value, min, max, step, setter, fmt, onEdit, onCommit, history } = opts;
  const row = el("div", "slider-row");
  row.appendChild(controlLabel(name));
  const input = document.createElement("input");
  input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value;
  const val = el("span", "val", fmt ? fmt(value) : String(value));
  const arm = () => { if (history) history.arm(); };
  input.addEventListener("pointerdown", arm);
  input.addEventListener("focus", arm);
  input.addEventListener("input", () => {
    if (history) history.commit();
    const v = Number(input.value);
    setter(v);
    val.textContent = fmt ? fmt(v) : String(v);
    if (onEdit) onEdit();
  });
  input.addEventListener("change", () => { if (onCommit) onCommit(); });
  row.append(input, val);
  return row;
}

export function fieldRow(name, control) {
  const row = el("div", "slider-row");
  row.appendChild(controlLabel(name));
  const wrap = el("div"); wrap.style.gridColumn = "2 / 4";
  control.style.width = "100%";
  wrap.appendChild(control);
  row.appendChild(wrap);
  return row;
}

// "This sound has something this tool doesn't edit" -- with the way across.
export function crossToolNotice(text, href, linkText) {
  const box = el("div", "cross-note");
  box.appendChild(el("span", null, text + " "));
  const a = document.createElement("a");
  a.href = href;
  a.textContent = linkText;
  box.appendChild(a);
  return box;
}

/* ============================================================
   Visualization: the compiled program's pitch and volume lanes
   ============================================================ */

export function drawViz(canvas, prog) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
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

// The visualization block a layer card opens with: canvas + legend. Returns
// the canvas so the caller can redraw it after any edit to the layer.
export function vizBlock(card, effect, layer, extraLegend) {
  const vizWrap = el("div", "viz-wrap");
  const canvas = document.createElement("canvas");
  canvas.width = 520; canvas.height = 160;
  vizWrap.appendChild(canvas);
  card.appendChild(vizWrap);
  drawViz(canvas, compileLayer(effect, layer));

  const legend = el("div", "viz-legend");
  legend.innerHTML = '<span><span class="sw" style="background:var(--gb-1)"></span>Pitch</span>' +
                     '<span><span class="sw" style="background:var(--accent)"></span>Volume</span>' +
                     (extraLegend ? '<span style="color:var(--accent)">' + extraLegend + '</span>' : '');
  card.appendChild(legend);
  return canvas;
}

export function layerHead(effect, layer, onRemove) {
  const ch = CHANNELS[layer.channel];
  const head = el("div", "layer-head");
  const dot = el("span", "dot"); dot.style.background = ch.dot;
  head.appendChild(dot);
  // The channel's name is the term: what a Wave or a Noise channel actually
  // is belongs next to the card it heads, not in a manual.
  const title = el("span", "layer-title");
  title.append(term(channelTermKey(layer.channel), ch.label), document.createTextNode("  (" + ch.role + ")"));
  head.appendChild(title);
  if (effect.layers.length > 1 && onRemove) {
    const rm = el("button", "tiny danger", "remove");
    rm.addEventListener("click", onRemove);
    head.appendChild(rm);
  }
  return head;
}

/* ============================================================
   Register inspector (first / middle / last frames)
   ============================================================ */

export function registerTable(effect, layer) {
  const box = el("div");
  // The five register names are folded into the one term rather than each
  // column heading carrying its own hook.
  const heading = el("h2");
  heading.append(term("registers"), document.createTextNode(" (NRx0-NRx4)"));
  box.appendChild(heading);
  const regs = layerToRegisters(effect, layer);
  const scroll = el("div", "reg-scroll");
  const table = el("table", "reg-table");
  const thead = el("tr");
  ["frame", "NRx0", "NRx1", "NRx2", "NRx3", "NRx4"].forEach(h => thead.appendChild(el("th", null, h)));
  table.appendChild(thead);
  pickFrameIndices(regs.frames.length).forEach(i => {
    const tr = el("tr");
    tr.appendChild(el("td", null, String(i)));
    const row = regs.frames[i];
    // A rest writes nothing at all, so there is no register row to show.
    if (!row) for (let k = 0; k < 5; k++) tr.appendChild(el("td", null, "—"));
    else row.forEach(b => tr.appendChild(el("td", null, "$" + b.toString(16).padStart(2, "0").toUpperCase())));
    table.appendChild(tr);
  });
  scroll.appendChild(table);
  box.appendChild(scroll);
  return box;
}

function pickFrameIndices(n) {
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  const set = new Set([0, 1, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 2, n - 1]);
  return Array.from(set).sort((a, b) => a - b);
}

// The tick-rate control, which both tools tuck into their advanced drawer.
export function tickRateRow(effect, onChange, history) {
  const row = el("div", "row");
  const tickLabel = el("span", "hint");
  tickLabel.append(term("tick-rate"), document.createTextNode(" (Hz)"));
  row.appendChild(tickLabel);
  const tickIn = numberInput(effect.tickHz, 15, 120);
  tickIn.addEventListener("focus", () => history && history.arm());
  tickIn.addEventListener("change", () => {
    if (history) history.commit();
    effect.tickHz = Math.max(15, Math.min(120, Math.round(Number(tickIn.value) || 60)));
    onChange();
  });
  const tickHint = el("span", "hint");
  tickHint.append(term("frame", "frames"), document.createTextNode(" per second the effect steps at"));
  row.append(tickIn, tickHint);
  return row;
}

/* ============================================================
   Import / export modals
   ============================================================
   Every export covers the one sound the tool holds. `ctx` is
   { getEffect, applyProject, otherToolHref, otherToolName }.
*/

function baseNameOf(effect) {
  return cId((effect && effect.name) || "sfx");
}

export function doExport(ctx) {
  openModal("Export", (modal) => {
    modal.appendChild(el("p", "hint", "Exports the sound you are working on, one sound per file. The .gbsfx.json is the editable source of truth. WAV renders the preview. C emits gbsfx.h / gbsfx.c for GBDK-2020."));

    const row = el("div", "row");
    const jsonBtn = el("button", "primary", "Download .gbsfx.json");
    jsonBtn.addEventListener("click", () => {
      const e = ctx.getEffect(); if (!e) return;
      downloadText(baseNameOf(e) + ".gbsfx.json", exportJson(singleEffectProject(e)), "application/json");
    });

    const wavBtn = el("button", null, "Download .wav");
    wavBtn.addEventListener("click", async () => {
      const e = ctx.getEffect(); if (!e) return;
      wavBtn.textContent = "Rendering...";
      try {
        const blob = await renderWav(e);
        downloadBlob(baseNameOf(e) + ".wav", blob);
      } catch (err) { alert("WAV render failed: " + err.message); }
      wavBtn.textContent = "Download .wav";
    });

    const cBtn = el("button", null, "Show gbsfx.c / .h");
    cBtn.addEventListener("click", () => showCExport(ctx));
    row.append(jsonBtn, wavBtn, cBtn);
    modal.appendChild(row);
  });
}

export function showCExport(ctx) {
  const e = ctx.getEffect();
  if (!e) return;
  const { h, c } = exportC(singleEffectProject(e));
  openModal("GBDK C export", (modal) => {
    modal.appendChild(el("p", "hint", "Two files for your GBDK-2020 project. Bytes are one frame program, stepped by the included player."));
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

export function doImport(ctx) {
  openModal("Import .gbsfx.json", (modal) => {
    modal.appendChild(el("p", "hint", "Paste a .gbsfx.json below, or choose a file. Both sound tools read the same format: " + ctx.otherToolName + " opens what this one saves."));
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
        const { project, dropped } = importJson(ta.value);
        ctx.applyProject(project);
        closeModal();
        if (dropped) {
          alert("That file holds " + (dropped + 1) + " sounds. The first was loaded — this tool works on one sound at a time.");
        }
      } catch (err) { alert("Import failed: " + err.message); }
    });
    modal.appendChild(el("div", "row")).appendChild(go);
  });
}

/* The transport row both tools open with: Play and Stop, plus whatever
   buttons the tool adds after them. */
export function transportButtons(getEffect) {
  const t = el("div", "transport");
  const play = el("button", "primary btn-play", "Play");
  play.addEventListener("click", () => { const e = getEffect(); if (e) audio.play(e); });
  const stop = el("button", null, "Stop");
  stop.addEventListener("click", () => audio.stop());
  t.append(play, stop);
  return t;
}
