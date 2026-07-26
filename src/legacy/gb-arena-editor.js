// @ts-nocheck
import { el, inputText, selectFrom, numberInput, clampInt, openModal, downloadText, copyText } from "../lib/common.js";

"use strict";

const FORMAT_VERSION = 2;
const W = 20, H = 18, PX = 8, SCALE = 4, CELL = PX * SCALE;
const COLORS = ["#e0f8d0", "#88c070", "#346856", "#081820"];
const OVERLAYS = {
  empty:    { label: "None",     hint: "no gameplay overlay", color: "transparent", glyph: "" },
  solid:    { label: "Solid",    hint: "full collision",       color: "rgba(224,86,72,.60)", glyph: "■" },
  platform: { label: "Platform", hint: "one-way landing",      color: "rgba(240,160,48,.68)", glyph: "━" },
  water:    { label: "Water",    hint: "water / respawn",      color: "rgba(70,165,220,.62)", glyph: "≈" },
  hazard:   { label: "Hazard",   hint: "damage / respawn",     color: "rgba(224,96,72,.70)", glyph: "▲" },
  ladder:   { label: "Ladder",   hint: "climbable",            color: "rgba(184,242,90,.62)", glyph: "↕" },
  decor:    { label: "Decor",    hint: "art only",             color: "rgba(111,168,96,.45)", glyph: "·" },
};
const MARKERS = {
  playerSpawn: { label: "Player spawn", icon: "P", hint: "where combat begins", color: "#b8f25a" },
  bossAnchor:  { label: "Boss anchor",  icon: "B", hint: "boss script/art origin", color: "#e08a5a" },
  checkpoint:  { label: "Checkpoint",   icon: "C", hint: "optional retry point", color: "#88c070" },
  exitLeft:    { label: "Exit left",    icon: "<", hint: "optional post-fight exit", color: "#8ad4ff" },
  exitRight:   { label: "Exit right",   icon: ">", hint: "optional post-fight exit", color: "#8ad4ff" },
};

const rows = (...lines) => lines.join("").split("").map(Number);
const blankPixels = () => Array(PX * PX).fill(0);
const clonePixels = (pixels) => [...pixels];
const indexAt = (x, y) => y * W + x;
function tileFrames(tile) { return [tile.pixels].concat(tile.frames || []); }
function frameCount(tile) { return tileFrames(tile).length; }
function animated(tile) { return frameCount(tile) > 1; }
function frameIndex(tile) {
  if (!state.animPlay || !animated(tile)) return 0;
  return Math.floor(performance.now() / (1000 / 60) / Math.max(1, tile.frameRate || 12)) % frameCount(tile);
}

function tile(id, name, pixels, extra = {}) { return { id, name, pixels, ...extra }; }
function makeArena(name = "Untitled Arena") {
  const tiles = [
    tile("air", "Air", blankPixels()),
    tile("stone", "Stone", rows("33333333", "22222222", "23223232", "22222222", "23223232", "22222222", "23223232", "22222222")),
    tile("ledge", "Ledge", rows("33333333", "11111111", "22222222", "22222222", "00000000", "00000000", "00000000", "00000000")),
    tile("water", "Water", rows("11111111", "12212212", "11111111", "21221221", "11111111", "12212212", "11111111", "21221221"), {
      frames: [rows("11111111", "21221221", "11111111", "12212212", "11111111", "21221221", "11111111", "12212212")], frameRate: 12,
    }),
  ];
  return {
    kind: "gb-boss-arena", version: FORMAT_VERSION, name, theme: "cavern", notes: "",
    screen: { width: W, height: H, tileSize: PX, camera: "fixed" },
    tiles, map: Array(W * H).fill("air"), overlays: Array(W * H).fill("empty"),
    markers: { playerSpawn: { x: 5, y: 15 }, bossAnchor: { x: 18, y: 14 }, checkpoint: null, exitLeft: null, exitRight: null },
    rules: { water: "respawn", hazards: "damage_respawn", platform: "one_way" },
  };
}
function snapjawArena() {
  const arena = makeArena("Snapjaw Marsh");
  arena.theme = "marsh";
  arena.notes = "Faithful to src/combat/cb_arena.c. Art is authored independently from collision; turn on Gameplay overlays to inspect the runtime layer.";
  for (let y = 16; y < 18; y++) for (let x = 0; x < 10; x++) { arena.map[indexAt(x, y)] = "stone"; arena.overlays[indexAt(x, y)] = "solid"; }
  for (let y = 16; y < 18; y++) for (let x = 10; x < 20; x++) { arena.map[indexAt(x, y)] = "water"; arena.overlays[indexAt(x, y)] = "water"; }
  for (let x = 3; x < 9; x++) { arena.map[indexAt(x, 12)] = "ledge"; arena.overlays[indexAt(x, 12)] = "platform"; }
  for (let x = 6; x < 8; x++) { arena.map[indexAt(x, 8)] = "ledge"; arena.overlays[indexAt(x, 8)] = "platform"; }
  return arena;
}

const state = {
  arena: snapjawArena(), selectedTileId: "stone", selectedFrame: 0, ink: 3, pixelTool: "pencil",
  mapTool: "paint", overlayBrush: "solid", markerBrush: null, showOverlays: false, animPlay: true,
  hover: null, painting: false, lastAnimSignature: "", dirty: false,
};
const history = { undo: [], redo: [], limit: 60 };
function currentJson() { return JSON.stringify(state.arena); }
function snapshot() { history.undo.push(currentJson()); if (history.undo.length > history.limit) history.undo.shift(); history.redo.length = 0; updateHistoryButtons(); }
function normalizeSelection() { if (!tileById(state.selectedTileId)) state.selectedTileId = state.arena.tiles[0].id; if (state.selectedFrame >= frameCount(activeTile())) state.selectedFrame = 0; }
function restoreFrom(json) { state.arena = validate(JSON.parse(json)); normalizeSelection(); state.dirty = true; }
function undo() { if (!history.undo.length) return; history.redo.push(currentJson()); restoreFrom(history.undo.pop()); updateHistoryButtons(); render(); }
function redo() { if (!history.redo.length) return; history.undo.push(currentJson()); restoreFrom(history.redo.pop()); updateHistoryButtons(); render(); }
function resetHistory() { history.undo.length = 0; history.redo.length = 0; updateHistoryButtons(); }
function updateHistoryButtons() { const undoButton = document.getElementById("btn-undo"); const redoButton = document.getElementById("btn-redo"); if (undoButton) undoButton.disabled = history.undo.length === 0; if (redoButton) redoButton.disabled = history.redo.length === 0; }

const toolHost = document.getElementById("arena-tools");
const workspace = document.getElementById("arena-workspace");
const inspector = document.getElementById("arena-inspector");

function activeTile() { return state.arena.tiles.find((t) => t.id === state.selectedTileId) || state.arena.tiles[0]; }
function tileById(id) { return state.arena.tiles.find((t) => t.id === id); }
function mapTile(x, y) { return tileById(state.arena.map[indexAt(x, y)]) || activeTile(); }
function overlayAt(x, y) { return state.arena.overlays[indexAt(x, y)] || "empty"; }
function markerAt(x, y) { return Object.entries(state.arena.markers).find(([, p]) => p && p.x === x && p.y === y); }
function markDirty() { state.dirty = true; }
function filename() { return (state.arena.name || "arena").trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "arena"; }
function drawPixels(ctx, pixels, scale, ox = 0, oy = 0) {
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) { ctx.fillStyle = COLORS[pixels[y * PX + x] || 0]; ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale); }
}
function drawTile(ctx, t, scale, ox = 0, oy = 0) { drawPixels(ctx, tileFrames(t)[frameIndex(t)], scale, ox, oy); }
function drawThumbnail(t, size = 40) { const c = document.createElement("canvas"); c.width = size; c.height = size; drawTile(c.getContext("2d"), t, size / PX); return c; }

function render() { renderTools(); renderWorkspace(); renderInspector(); }
function renderTools() {
  toolHost.innerHTML = "";
  const library = el("section", "card"); library.appendChild(el("h2", null, "Arena tiles"));
  library.appendChild(el("p", "hint", `${state.arena.tiles.length} authored tile${state.arena.tiles.length === 1 ? "" : "s"} · select a tile, then paint the arena art layer.`));
  const grid = el("div", "arena-tile-grid");
  state.arena.tiles.forEach((t, i) => {
    const button = el("button", `arena-tile${t.id === state.selectedTileId ? " selected" : ""}`);
    button.title = t.name; button.appendChild(drawThumbnail(t)); button.appendChild(el("span", "idx", `${i}`));
    if (animated(t)) button.appendChild(el("span", "anim-badge", `▶${frameCount(t)}`));
    button.addEventListener("click", () => { state.selectedTileId = t.id; state.selectedFrame = 0; state.markerBrush = null; render(); }); grid.appendChild(button);
  });
  library.appendChild(grid);
  const tileButtons = el("div", "row");
  const add = el("button", null, "+ New tile"); add.addEventListener("click", () => { snapshot(); const id = uniqueTileId("tile"); state.arena.tiles.push(tile(id, `Tile ${state.arena.tiles.length}`, blankPixels())); state.selectedTileId = id; state.selectedFrame = 0; markDirty(); render(); });
  const duplicate = el("button", null, "Duplicate"); duplicate.addEventListener("click", () => { snapshot(); const src = activeTile(); const id = uniqueTileId(`${src.id}_copy`); state.arena.tiles.push(tile(id, `${src.name} copy`, clonePixels(src.pixels), src.frames ? { frames: src.frames.map(clonePixels), frameRate: src.frameRate } : {})); state.selectedTileId = id; state.selectedFrame = 0; markDirty(); render(); });
  const remove = el("button", "danger", "Delete"); remove.addEventListener("click", () => deleteActiveTile()); tileButtons.append(add, duplicate, remove); library.appendChild(tileButtons); toolHost.appendChild(library);

  const overlay = el("section", "card"); overlay.appendChild(el("h2", null, "Gameplay overlays")); overlay.appendChild(el("p", "hint", "Paint collision separately from tile art. Toggle the overlay view in the canvas toolbar."));
  const overlayGrid = el("div", "brush-grid"); Object.entries(OVERLAYS).forEach(([id, data]) => {
    const b = el("button", `brush${state.overlayBrush === id && !state.markerBrush ? " active" : ""}`); b.append(el("span", null, data.label), el("small", null, data.hint)); b.addEventListener("click", () => { state.overlayBrush = id; state.markerBrush = null; renderTools(); }); overlayGrid.appendChild(b);
  }); overlay.appendChild(overlayGrid); toolHost.appendChild(overlay);

  const markers = el("section", "card"); markers.appendChild(el("h2", null, "Annotations")); const markerGrid = el("div", "brush-grid"); Object.entries(MARKERS).forEach(([id, data]) => { const b = el("button", `brush${state.markerBrush === id ? " active" : ""}`); b.append(el("span", null, data.label), el("small", null, data.hint)); b.addEventListener("click", () => { state.markerBrush = id; renderTools(); }); markerGrid.appendChild(b); }); markers.appendChild(markerGrid); toolHost.appendChild(markers);

  const presets = el("section", "card"); presets.appendChild(el("h2", null, "Presets")); const snap = el("button", "primary", "Load Snapjaw"); snap.style.width = "100%"; snap.addEventListener("click", () => { snapshot(); state.arena = snapjawArena(); state.selectedTileId = "stone"; state.selectedFrame = 0; markDirty(); render(); }); presets.appendChild(snap); toolHost.appendChild(presets);
}
function uniqueTileId(base) { let n = base, i = 2; while (tileById(n)) n = `${base}_${i++}`; return n; }
function deleteActiveTile() {
  if (state.arena.tiles.length <= 1) { alert("Keep at least one tile in an arena."); return; }
  const t = activeTile(); const refs = state.arena.map.filter((id) => id === t.id).length;
  if (refs && !confirm(`"${t.name}" is painted in ${refs} arena cell${refs === 1 ? "" : "s"}. Replace it with Air?`)) return;
  snapshot(); const fallback = state.arena.tiles.find((x) => x.id !== t.id); state.arena.map = state.arena.map.map((id) => id === t.id ? fallback.id : id); state.arena.tiles = state.arena.tiles.filter((x) => x.id !== t.id); state.selectedTileId = fallback.id; state.selectedFrame = 0; markDirty(); render();
}

function renderWorkspace() {
  workspace.innerHTML = "";
  const card = el("section", "card"); const head = el("div", "row"); head.append(el("h2", null, "Arena map"));
  const art = el("button", `tiny${state.mapTool === "paint" ? " primary" : ""}`, "Paint tiles"); art.addEventListener("click", () => { state.mapTool = "paint"; state.markerBrush = null; renderWorkspace(); });
  const erase = el("button", `tiny${state.mapTool === "erase" ? " primary" : ""}`, "Erase art"); erase.addEventListener("click", () => { state.mapTool = "erase"; state.markerBrush = null; renderWorkspace(); });
  const overlays = el("button", `tiny${state.showOverlays ? " primary" : ""}`, state.showOverlays ? "Gameplay overlays: on" : "Gameplay overlays: off"); overlays.id = "btn-overlay-toggle"; overlays.addEventListener("click", () => { state.showOverlays = !state.showOverlays; renderWorkspace(); renderInspector(); });
  const anim = el("button", `tiny${state.animPlay ? " primary" : ""}`, state.animPlay ? "Animation: playing" : "Animation: paused"); anim.id = "btn-animation-toggle"; anim.addEventListener("click", () => { state.animPlay = !state.animPlay; state.lastAnimSignature = ""; renderWorkspace(); });
  head.append(art, erase, overlays, anim); card.appendChild(head);
  const toolbar = el("div", "arena-toolbar"); toolbar.id = "arena-map-toolbar"; card.appendChild(toolbar);
  const frame = el("div", "arena-frame"); const canvas = document.createElement("canvas"); canvas.id = "arena-canvas"; canvas.width = W * CELL; canvas.height = H * CELL; canvas.setAttribute("aria-label", "Arena map art and gameplay overlay grid"); frame.appendChild(canvas); card.appendChild(frame);
  card.appendChild(el("p", "arena-caption", "Paint tile art with the selected library tile. Select an overlay or annotation in the left rail to paint the independent gameplay layer.")); workspace.appendChild(card);
  renderWorkspaceToolbar();
  canvas.addEventListener("pointerdown", (event) => { snapshot(); state.painting = true; canvas.setPointerCapture(event.pointerId); applyMapAt(event, canvas); });
  canvas.addEventListener("pointermove", (event) => { state.hover = cellAt(event, canvas); if (state.painting) applyMapAt(event, canvas); else drawArena(); });
  canvas.addEventListener("pointerup", () => { state.painting = false; }); canvas.addEventListener("pointerleave", () => { if (!state.painting) { state.hover = null; drawArena(); } });
  drawArena();
}
function renderWorkspaceToolbar() {
  const root = document.getElementById("arena-map-toolbar"); if (!root) return; root.innerHTML = "";
  const t = activeTile(); const sw = drawThumbnail(t, 28); const describe = el("span", "map-selection", state.markerBrush ? `Annotation: ${MARKERS[state.markerBrush].label}` : `${state.mapTool === "erase" ? "Erasing tile art" : `Tile: ${t.name}`} · overlay brush: ${OVERLAYS[state.overlayBrush].label}`); root.append(sw, describe);
  if (state.showOverlays) root.appendChild(el("span", "overlay-state", "Overlay legend is active"));
}
function cellAt(event, canvas) { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(W - 1, Math.floor((event.clientX - r.left) * W / r.width))), y: Math.max(0, Math.min(H - 1, Math.floor((event.clientY - r.top) * H / r.height))) }; }
function applyMapAt(event, canvas) {
  const { x, y } = cellAt(event, canvas); const i = indexAt(x, y);
  if (state.markerBrush) state.arena.markers[state.markerBrush] = { x, y };
  else if (state.showOverlays) state.arena.overlays[i] = state.overlayBrush;
  else state.arena.map[i] = state.mapTool === "erase" ? "air" : activeTile().id;
  state.hover = { x, y }; markDirty(); drawArena(); renderInspector();
}
function drawArena() {
  const canvas = document.getElementById("arena-canvas"); if (!canvas) return; const ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawTile(ctx, mapTile(x, y), SCALE, x * CELL, y * CELL);
  if (state.showOverlays) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawOverlay(ctx, overlayAt(x, y), x * CELL, y * CELL);
  for (let x = 0; x <= W; x++) { ctx.strokeStyle = "rgba(8,24,32,.25)"; ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, H * CELL); ctx.stroke(); }
  for (let y = 0; y <= H; y++) { ctx.strokeStyle = "rgba(8,24,32,.25)"; ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(W * CELL, y * CELL + .5); ctx.stroke(); }
  Object.entries(state.arena.markers).forEach(([id, p]) => { if (p) drawMarker(ctx, id, p.x * CELL, p.y * CELL); });
  if (state.hover) { ctx.strokeStyle = "#b8f25a"; ctx.lineWidth = 2; ctx.strokeRect(state.hover.x * CELL + 1, state.hover.y * CELL + 1, CELL - 2, CELL - 2); }
}
function drawOverlay(ctx, type, x, y) { const d = OVERLAYS[type]; if (!d || type === "empty") return; ctx.fillStyle = d.color; ctx.fillRect(x, y, CELL, CELL); ctx.fillStyle = "#081820"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(d.glyph, x + CELL / 2, y + CELL / 2 + 1); }
function drawMarker(ctx, id, x, y) { const d = MARKERS[id]; ctx.fillStyle = d.color; ctx.fillRect(x + 5, y + 5, CELL - 10, CELL - 10); ctx.strokeStyle = "#081820"; ctx.lineWidth = 2; ctx.strokeRect(x + 5, y + 5, CELL - 10, CELL - 10); ctx.fillStyle = "#081820"; ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(d.icon, x + CELL / 2, y + CELL / 2 + 1); }

function renderInspector() {
  inspector.innerHTML = ""; const a = state.arena;
  const editor = el("section", "card"); editor.appendChild(el("h2", null, "Tile editor")); const t = activeTile();
  const name = inputText(t.name); name.addEventListener("focus", snapshot); name.addEventListener("input", (e) => { t.name = e.target.value; markDirty(); }); editor.appendChild(field("Tile name", name));
  const inkRow = el("div", "row"); inkRow.appendChild(el("span", "cell-label", "Ink")); const inks = el("div", "ink-swatches"); for (let v = 0; v < 4; v++) { const b = el("button", `ink-swatch${state.ink === v ? " active" : ""}`); b.style.background = COLORS[v]; b.appendChild(el("span", "val", String(v))); b.addEventListener("click", () => { state.ink = v; renderInspector(); }); inks.appendChild(b); } inkRow.appendChild(inks); editor.appendChild(inkRow);
  const tools = el("div", "row"); ["pencil", "fill", "eyedropper"].forEach((kind) => { const b = el("button", `tiny${state.pixelTool === kind ? " primary" : ""}`, kind); b.addEventListener("click", () => { state.pixelTool = kind; renderInspector(); }); tools.appendChild(b); }); const clear = el("button", "tiny danger", "Clear frame"); clear.addEventListener("click", () => { snapshot(); editFrame(t).fill(0); markDirty(); drawPixelEditor(); refreshTileThumbs(); drawArena(); }); tools.appendChild(clear); editor.appendChild(tools);
  const canvas = document.createElement("canvas"); canvas.id = "tile-editor-canvas"; canvas.className = "tile-editor-canvas"; canvas.width = PX * 28; canvas.height = PX * 28; editor.appendChild(canvas); bindPixelEditor(canvas, t); drawPixelEditor();
  editor.appendChild(el("span", "cell-label", "Animation frames")); const strip = el("div", "frame-strip"); tileFrames(t).forEach((pixels, i) => { const b = el("button", `frame-cell${state.selectedFrame === i ? " selected" : ""}`); const c = document.createElement("canvas"); c.width = 38; c.height = 38; drawPixels(c.getContext("2d"), pixels, 38 / PX); b.append(c, el("span", "fnum", i === 0 ? "base" : String(i))); b.addEventListener("click", () => { state.selectedFrame = i; renderInspector(); }); strip.appendChild(b); }); const add = el("button", "frame-cell", "+"); add.title = "Add a frame copied from this frame"; add.addEventListener("click", () => { snapshot(); if (!t.frames) t.frames = []; if (!t.frameRate) t.frameRate = 12; t.frames.push(clonePixels(editFrame(t))); state.selectedFrame = frameCount(t) - 1; markDirty(); renderInspector(); drawArena(); }); strip.appendChild(add); editor.appendChild(strip);
  if (animated(t)) { const controls = el("div", "row"); const rate = numberInput(t.frameRate || 12, 1, 120); rate.addEventListener("change", () => { snapshot(); t.frameRate = clampInt(rate.value, 1, 120); markDirty(); }); controls.append(field("Ticks / frame", rate)); const removeFrame = el("button", "tiny danger", "Delete frame"); removeFrame.disabled = state.selectedFrame === 0; removeFrame.addEventListener("click", () => { if (!state.selectedFrame) return; snapshot(); t.frames.splice(state.selectedFrame - 1, 1); if (!t.frames.length) delete t.frames; state.selectedFrame = 0; markDirty(); renderInspector(); drawArena(); }); controls.appendChild(removeFrame); editor.appendChild(controls); }
  inspector.appendChild(editor);

  const properties = el("section", "card"); properties.appendChild(el("h2", null, "Arena properties")); const nameField = inputText(a.name); nameField.addEventListener("focus", snapshot); nameField.addEventListener("input", (e) => { a.name = e.target.value; markDirty(); }); properties.appendChild(field("Name", nameField)); const theme = selectFrom([{ value: "marsh", label: "Marsh / water" }, { value: "cavern", label: "Cavern" }, { value: "ruins", label: "Ancient ruins" }, { value: "void", label: "Void" }], a.theme, (v) => { snapshot(); a.theme = v; markDirty(); }); properties.appendChild(field("Art direction", theme)); const notes = document.createElement("textarea"); notes.rows = 4; notes.value = a.notes || ""; notes.addEventListener("focus", snapshot); notes.addEventListener("input", () => { a.notes = notes.value; markDirty(); }); properties.appendChild(field("Notes", notes)); inspector.appendChild(properties);
  const selection = el("section", "card"); selection.appendChild(el("h2", null, "Selection")); const h = state.hover; selection.appendChild(el("div", "inspector-value", h ? `Tile ${h.x}, ${h.y} · art ${mapTile(h.x, h.y).name} · ${OVERLAYS[overlayAt(h.x, h.y)].label}${markerAt(h.x, h.y) ? ` · ${MARKERS[markerAt(h.x, h.y)[0]].label}` : ""}` : "Hover a cell to inspect both layers.")); inspector.appendChild(selection);
}
function field(text, control) { const wrap = el("div", "field"); wrap.append(el("label", null, text), control); return wrap; }
function editFrame(t) { if (state.selectedFrame >= frameCount(t)) state.selectedFrame = 0; return state.selectedFrame === 0 ? t.pixels : t.frames[state.selectedFrame - 1]; }
function refreshTileThumbs() { document.querySelectorAll(".arena-tile").forEach((button) => { const index = Number(button.querySelector(".idx")?.textContent); const canvas = button.querySelector("canvas"); if (!Number.isInteger(index) || !canvas || !state.arena.tiles[index]) return; const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); drawTile(ctx, state.arena.tiles[index], canvas.width / PX); }); }
function drawPixelEditor() { const c = document.getElementById("tile-editor-canvas"); if (!c) return; const ctx = c.getContext("2d"), pixels = editFrame(activeTile()), s = c.width / PX; drawPixels(ctx, pixels, s); ctx.strokeStyle = "rgba(224,248,208,.2)"; for (let i = 0; i <= PX; i++) { ctx.beginPath(); ctx.moveTo(i * s + .5, 0); ctx.lineTo(i * s + .5, c.height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s + .5); ctx.lineTo(c.width, i * s + .5); ctx.stroke(); } }
function bindPixelEditor(canvas, t) { let painting = false; const pixelAt = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(7, Math.floor((e.clientX - r.left) * PX / r.width))), y: Math.max(0, Math.min(7, Math.floor((e.clientY - r.top) * PX / r.height))) }; }; const apply = (e) => { const p = pixelAt(e), pixels = editFrame(t), i = p.y * PX + p.x; if (state.pixelTool === "eyedropper") { state.ink = pixels[i]; renderInspector(); return; } if (state.pixelTool === "fill") floodFill(pixels, p.x, p.y, state.ink); else pixels[i] = state.ink; markDirty(); drawPixelEditor(); refreshTileThumbs(); drawArena(); }; canvas.addEventListener("pointerdown", (e) => { if (state.pixelTool !== "eyedropper") snapshot(); painting = state.pixelTool === "pencil"; canvas.setPointerCapture(e.pointerId); apply(e); }); canvas.addEventListener("pointermove", (e) => { if (painting) apply(e); }); canvas.addEventListener("pointerup", () => { painting = false; }); }
function floodFill(pixels, x, y, value) { const at = y * PX + x, old = pixels[at]; if (old === value) return; const queue = [[x, y]]; while (queue.length) { const [cx, cy] = queue.pop(); const i = cy * PX + cx; if (cx < 0 || cy < 0 || cx >= PX || cy >= PX || pixels[i] !== old) continue; pixels[i] = value; queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]); } }

function migrate(data) {
  if (data.version >= 2 && Array.isArray(data.tiles) && Array.isArray(data.map) && Array.isArray(data.overlays)) return data;
  if (!Array.isArray(data.terrain)) throw new Error("Not a supported arena project.");
  const a = makeArena(data.name || "Imported Arena"); a.theme = data.theme || a.theme; a.notes = data.notes || a.notes; a.markers = { ...a.markers, ...(data.markers || {}) }; a.rules = { ...a.rules, ...(data.rules || {}) };
  const art = { empty: "air", solid: "stone", platform: "ledge", water: "water", hazard: "air", ladder: "air", decor: "air" }; a.overlays = data.terrain.map((v) => OVERLAYS[v] ? v : "empty"); a.map = data.terrain.map((v) => art[v] || "air"); return a;
}
function validate(data) { const a = migrate(data); if (!a || a.kind !== "gb-boss-arena" || !Array.isArray(a.map) || !Array.isArray(a.overlays)) throw new Error("Not a .gbarena.json project."); if (a.map.length !== W * H || a.overlays.length !== W * H) throw new Error(`Expected ${W * H} map and overlay cells.`); if (!a.screen || a.screen.width !== W || a.screen.height !== H || !Array.isArray(a.tiles) || !a.tiles.length) throw new Error("This editor requires a 20×18 arena with at least one tile."); a.tiles.forEach((t, i) => { t.id = String(t.id || `tile_${i}`); t.name = String(t.name || t.id); t.pixels = validPixels(t.pixels); if (Array.isArray(t.frames)) t.frames = t.frames.map(validPixels); else delete t.frames; }); const ids = new Set(a.tiles.map((t) => t.id)); a.map = a.map.map((id) => ids.has(id) ? id : a.tiles[0].id); a.overlays = a.overlays.map((v) => OVERLAYS[v] ? v : "empty"); Object.keys(MARKERS).forEach((key) => { const p = a.markers?.[key]; a.markers[key] = p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < W && p.y >= 0 && p.y < H ? p : null; }); a.version = FORMAT_VERSION; return a; }
function validPixels(value) { return Array.isArray(value) && value.length === 64 ? value.map((v) => clampInt(v, 0, 3)) : blankPixels(); }
function exportArena() { const text = JSON.stringify(state.arena, null, 2); openModal("Export arena", (modal) => { modal.appendChild(el("p", "hint", "The project contains authored tile pixels, optional animation frames, tile map, independent gameplay overlays, annotations, and notes.")); const row = el("div", "row"); const download = el("button", "primary", "Download .gbarena.json"); const copy = el("button", null, "Copy JSON"); row.append(download, copy); modal.appendChild(row); const out = document.createElement("textarea"); out.readOnly = true; out.value = text; modal.appendChild(out); download.addEventListener("click", () => downloadText(`${filename()}.gbarena.json`, text, "application/json")); copy.addEventListener("click", async () => { copy.textContent = await copyText(text) ? "Copied" : "Copy failed"; }); }); }
function importArena() { openModal("Import arena", (modal) => { modal.appendChild(el("p", "hint", "Arena projects from the original semantic-only editor are upgraded automatically.")); const choose = el("button", "primary", "Choose file"); const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; file.style.display = "none"; const text = document.createElement("textarea"); text.placeholder = "Paste .gbarena.json here…"; const load = el("button", null, "Load pasted JSON"); modal.append(choose, file, text, load); const apply = (raw) => { try { state.arena = validate(JSON.parse(raw)); state.selectedTileId = state.arena.tiles[0].id; state.selectedFrame = 0; state.dirty = false; resetHistory(); render(); document.getElementById("modal-backdrop")?.remove(); } catch (error) { alert(`Could not import arena: ${error.message}`); } }; choose.addEventListener("click", () => file.click()); file.addEventListener("change", () => { const chosen = file.files[0]; if (!chosen) return; const reader = new FileReader(); reader.onload = () => apply(reader.result); reader.readAsText(chosen); }); load.addEventListener("click", () => apply(text.value)); }); }

function animationLoop() { const signature = state.arena.tiles.map((t) => frameIndex(t)).join(","); if (state.animPlay && signature !== state.lastAnimSignature) { state.lastAnimSignature = signature; drawArena(); document.querySelectorAll(".arena-tile canvas").forEach((c) => { const parent = c.parentElement; const index = Number(parent.querySelector(".idx")?.textContent); if (Number.isInteger(index) && state.arena.tiles[index]) { c.getContext("2d").clearRect(0, 0, c.width, c.height); drawTile(c.getContext("2d"), state.arena.tiles[index], c.width / PX); } }); } requestAnimationFrame(animationLoop); }
document.getElementById("btn-new").addEventListener("click", () => { if (confirm("Start a new blank arena? Export first to keep this one.")) { state.arena = makeArena(); state.selectedTileId = "stone"; state.selectedFrame = 0; state.dirty = false; resetHistory(); render(); } });
document.getElementById("btn-import").addEventListener("click", importArena); document.getElementById("btn-export").addEventListener("click", exportArena); document.getElementById("btn-undo").addEventListener("click", undo); document.getElementById("btn-redo").addEventListener("click", redo);
document.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; } if (event.target.matches("input,textarea,select")) return; if (event.key.toLowerCase() === "o") { state.showOverlays = !state.showOverlays; renderWorkspace(); renderInspector(); } if (event.key === " ") { event.preventDefault(); state.animPlay = !state.animPlay; renderWorkspace(); } });
render(); updateHistoryButtons(); requestAnimationFrame(animationLoop);
