// @ts-nocheck
import { el, inputText, selectFrom, openModal, downloadText, copyText } from "../lib/common.js";

"use strict";

const W = 20, H = 18, TILE = 32;
const TERRAIN = {
  empty:    { label: "Empty",    hint: "visual background", color: "#e0f8d0" },
  solid:    { label: "Solid",    hint: "full collision",     color: "#346856" },
  platform: { label: "Platform", hint: "one-way from above", color: "#081820" },
  water:    { label: "Water",    hint: "water / respawn",    color: "#88c070" },
  hazard:   { label: "Hazard",   hint: "damage / respawn",   color: "#e08a5a" },
  ladder:   { label: "Ladder",   hint: "climbable",           color: "#b8f25a" },
  decor:    { label: "Decor",    hint: "no collision",       color: "#6fa860" },
};
const MARKERS = {
  playerSpawn: { label: "Player spawn", icon: "P", hint: "where the player enters", color: "#b8f25a" },
  bossAnchor:  { label: "Boss anchor",  icon: "B", hint: "boss body / script origin", color: "#e08a5a" },
  checkpoint:  { label: "Checkpoint",   icon: "C", hint: "optional retry point", color: "#88c070" },
  exitLeft:    { label: "Exit left",    icon: "<", hint: "optional post-fight exit", color: "#346856" },
  exitRight:   { label: "Exit right",   icon: ">", hint: "optional post-fight exit", color: "#346856" },
};

function blankTerrain() { return Array(W * H).fill("empty"); }
function makeArena(name = "Untitled Arena") {
  return {
    kind: "gb-boss-arena", version: 1, name, theme: "cavern", notes: "",
    screen: { width: W, height: H, tileSize: 8, camera: "fixed" },
    terrain: blankTerrain(),
    markers: { playerSpawn: { x: 5, y: 15 }, bossAnchor: { x: 18, y: 14 }, checkpoint: null, exitLeft: null, exitRight: null },
    rules: { water: "respawn", hazards: "damage_respawn", platform: "one_way" },
  };
}
function snapjawArena() {
  const arena = makeArena("Snapjaw Marsh");
  arena.theme = "marsh";
  arena.notes = "Faithful to src/combat/cb_arena.c: safe floor through x=79px, water from x=80px, a 48px platform at y=96px, and a 16px platform at y=64px.";
  for (let y = 16; y < 18; y++) for (let x = 0; x < 10; x++) arena.terrain[y * W + x] = "solid";
  for (let y = 16; y < 18; y++) for (let x = 10; x < 20; x++) arena.terrain[y * W + x] = "water";
  for (let x = 3; x < 9; x++) arena.terrain[12 * W + x] = "platform";
  for (let x = 6; x < 8; x++) arena.terrain[8 * W + x] = "platform";
  arena.markers.playerSpawn = { x: 5, y: 15 };  // cb_player_init(40), standing above y=128 floor
  arena.markers.bossAnchor = { x: 18, y: 14 }; // Snapjaw SJ_VISIBLE: top-left (144, 112)
  return arena;
}

let state = { arena: snapjawArena(), brush: "solid", hover: null, dirty: false, painting: false };
const toolHost = document.getElementById("arena-tools");
const workspace = document.getElementById("arena-workspace");
const inspector = document.getElementById("arena-inspector");

function terrainAt(x, y) { return state.arena.terrain[y * W + x]; }
function setTerrain(x, y, value) { state.arena.terrain[y * W + x] = value; }
function markDirty() { state.dirty = true; }
function filename() { return (state.arena.name || "arena").trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "arena"; }
function markerAt(x, y) { return Object.entries(state.arena.markers).find(([, p]) => p && p.x === x && p.y === y); }
function statusLines() {
  const a = state.arena;
  const lines = [];
  lines.push([!!a.markers.playerSpawn, "Player spawn"]);
  lines.push([!!a.markers.bossAnchor, "Boss anchor"]);
  const solid = a.terrain.filter((t) => t === "solid" || t === "platform").length;
  lines.push([solid > 0, solid ? `${solid} supporting tile${solid === 1 ? "" : "s"}` : "No floor or platform"]);
  return lines;
}

function renderTools() {
  toolHost.innerHTML = "";
  const paint = el("section", "card"); paint.appendChild(el("h2", null, "Paint"));
  const grid = el("div", "brush-grid");
  Object.entries(TERRAIN).forEach(([id, info]) => grid.appendChild(brushButton(id, info.label, info.hint)));
  grid.appendChild(brushButton("erase", "Erase", "return to empty"));
  paint.appendChild(grid); toolHost.appendChild(paint);
  const markers = el("section", "card"); markers.appendChild(el("h2", null, "Annotations"));
  const markerGrid = el("div", "brush-grid");
  Object.entries(MARKERS).forEach(([id, info]) => markerGrid.appendChild(brushButton(id, info.label, info.hint)));
  markers.appendChild(markerGrid); toolHost.appendChild(markers);
  const quick = el("section", "card"); quick.appendChild(el("h2", null, "Presets"));
  const snap = el("button", "primary", "Load Snapjaw"); snap.style.width = "100%";
  snap.addEventListener("click", () => { state.arena = snapjawArena(); markDirty(); render(); }); quick.appendChild(snap);
  const clear = el("button", "danger", "Clear terrain"); clear.style.width = "100%"; clear.style.marginTop = "7px";
  clear.addEventListener("click", () => { state.arena.terrain = blankTerrain(); markDirty(); render(); }); quick.appendChild(clear);
  toolHost.appendChild(quick);
}
function brushButton(id, label, hint) {
  const b = el("button", `brush${state.brush === id ? " active" : ""}`); b.type = "button";
  b.append(el("span", null, label), el("small", null, hint));
  b.addEventListener("click", () => { state.brush = id; renderTools(); draw(); }); return b;
}

function renderWorkspace() {
  workspace.innerHTML = "";
  const card = el("section", "card");
  const head = el("div", "row"); head.append(el("h2", null, "Arena canvas"), el("span", "target-tag", "click / drag to paint")); card.appendChild(head);
  const frame = el("div", "arena-frame"); const canvas = document.createElement("canvas"); canvas.id = "arena-canvas"; canvas.width = W * TILE; canvas.height = H * TILE;
  canvas.setAttribute("aria-label", "Boss arena grid"); frame.appendChild(canvas); card.appendChild(frame);
  card.appendChild(el("p", "arena-caption", "Each cell represents one 8×8 Game Boy background tile. Grid annotations remain separate from art and collision."));
  const legend = el("div", "legend"); Object.entries(TERRAIN).forEach(([, info]) => { const item = el("span"); const sw = el("i"); sw.style.background = info.color; item.append(sw, document.createTextNode(info.label)); legend.appendChild(item); }); card.appendChild(legend);
  workspace.appendChild(card);
  canvas.addEventListener("pointerdown", (event) => { state.painting = true; canvas.setPointerCapture(event.pointerId); paintCell(event, canvas); });
  canvas.addEventListener("pointermove", (event) => { state.hover = getCell(event, canvas); if (state.painting) paintCell(event, canvas); else draw(); });
  canvas.addEventListener("pointerup", () => { state.painting = false; });
  canvas.addEventListener("pointerleave", () => { if (!state.painting) { state.hover = null; draw(); } });
  draw();
}
function getCell(event, canvas) { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(W - 1, Math.floor((event.clientX - r.left) * W / r.width))), y: Math.max(0, Math.min(H - 1, Math.floor((event.clientY - r.top) * H / r.height))) }; }
function paintCell(event, canvas) {
  const { x, y } = getCell(event, canvas); const brush = state.brush;
  if (MARKERS[brush]) state.arena.markers[brush] = { x, y };
  else setTerrain(x, y, brush === "erase" ? "empty" : brush);
  markDirty(); state.hover = { x, y }; draw(); renderInspector();
}
function draw() {
  const canvas = document.getElementById("arena-canvas"); if (!canvas) return; const c = canvas.getContext("2d");
  c.imageSmoothingEnabled = false; c.fillStyle = "#e0f8d0"; c.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) drawCell(c, x, y, terrainAt(x, y));
  c.strokeStyle = "rgba(8,24,32,.23)"; c.lineWidth = 1;
  for (let x = 0; x <= W; x++) { c.beginPath(); c.moveTo(x * TILE + .5, 0); c.lineTo(x * TILE + .5, H * TILE); c.stroke(); }
  for (let y = 0; y <= H; y++) { c.beginPath(); c.moveTo(0, y * TILE + .5); c.lineTo(W * TILE, y * TILE + .5); c.stroke(); }
  Object.entries(state.arena.markers).forEach(([id, p]) => { if (p) drawMarker(c, id, p.x, p.y); });
  if (state.hover) { c.strokeStyle = "#b8f25a"; c.lineWidth = 3; c.strokeRect(state.hover.x * TILE + 2, state.hover.y * TILE + 2, TILE - 4, TILE - 4); }
}
function drawCell(c, x, y, type) {
  const px = x * TILE, py = y * TILE;
  if (type === "empty") return;
  if (type === "solid") { c.fillStyle = "#346856"; c.fillRect(px, py, TILE, TILE); c.fillStyle = "#081820"; c.fillRect(px, py, TILE, 5); c.fillRect(px + 5, py + 12, 5, 5); c.fillRect(px + 21, py + 23, 5, 5); }
  if (type === "platform") { c.fillStyle = "#081820"; c.fillRect(px, py + 12, TILE, 6); c.fillStyle = "#346856"; c.fillRect(px, py + 18, TILE, 6); }
  if (type === "water") { c.fillStyle = "#88c070"; c.fillRect(px, py, TILE, TILE); c.fillStyle = "#346856"; for (let i = 0; i < 4; i++) c.fillRect(px + i * 9, py + 7 + (i % 2) * 3, 6, 3); }
  if (type === "hazard") { c.fillStyle = "#e08a5a"; c.fillRect(px, py, TILE, TILE); c.fillStyle = "#081820"; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(px + i * 8, py + TILE); c.lineTo(px + i * 8 + 4, py + 5); c.lineTo(px + i * 8 + 8, py + TILE); c.fill(); } }
  if (type === "ladder") { c.fillStyle = "#88c070"; c.fillRect(px, py, TILE, TILE); c.fillStyle = "#346856"; c.fillRect(px + 7, py, 4, TILE); c.fillRect(px + 21, py, 4, TILE); for (let k = 5; k < TILE; k += 9) c.fillRect(px + 7, py + k, 18, 3); }
  if (type === "decor") { c.fillStyle = "#d8f0c8"; c.fillRect(px, py, TILE, TILE); c.fillStyle = "#6fa860"; c.fillRect(px + 9, py + 7, 13, 18); c.fillStyle = "#346856"; c.fillRect(px + 13, py + 3, 5, 24); }
}
function drawMarker(c, id, x, y) { const m = MARKERS[id], px = x * TILE, py = y * TILE; c.fillStyle = m.color; c.fillRect(px + 5, py + 5, 22, 22); c.strokeStyle = "#081820"; c.lineWidth = 2; c.strokeRect(px + 5, py + 5, 22, 22); c.fillStyle = "#081820"; c.font = "bold 15px monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(m.icon, px + 16, py + 17); }

function renderInspector() {
  inspector.innerHTML = ""; const a = state.arena;
  const properties = el("section", "card"); properties.appendChild(el("h2", null, "Arena properties"));
  const nameField = field("Name", inputText(a.name)); nameField.querySelector("input").addEventListener("input", (e) => { a.name = e.target.value; markDirty(); }); properties.appendChild(nameField);
  const themeField = field("Art direction", selectFrom([{ value: "marsh", label: "Marsh / water" }, { value: "cavern", label: "Cavern" }, { value: "ruins", label: "Ancient ruins" }, { value: "void", label: "Void" }], a.theme, (v) => { a.theme = v; markDirty(); })); properties.appendChild(themeField);
  const notes = document.createElement("textarea"); notes.rows = 5; notes.value = a.notes; notes.placeholder = "Design notes, boss-specific rules, tuning reminders…"; notes.addEventListener("input", () => { a.notes = notes.value; markDirty(); }); properties.appendChild(field("Notes", notes)); inspector.appendChild(properties);
  const inspect = el("section", "card"); inspect.appendChild(el("h2", null, "Selection"));
  const h = state.hover; const text = h ? `Tile ${h.x}, ${h.y} · ${terrainAt(h.x, h.y)}${markerAt(h.x, h.y) ? ` · ${MARKERS[markerAt(h.x, h.y)[0]].label}` : ""}` : "Hover a tile to inspect it."; inspect.appendChild(el("div", "inspector-value", text)); inspector.appendChild(inspect);
  const ready = el("section", "card"); ready.appendChild(el("h2", null, "Runtime checklist")); statusLines().forEach(([ok, text]) => { const line = el("div", `checkline ${ok ? "ok" : "bad"}`, `${ok ? "✓" : "!"} ${text}`); ready.appendChild(line); }); ready.appendChild(el("p", "hint", "Exported terrain is semantic. Runtime code can choose its own tile art, collision values, damage, and water behavior.")); inspector.appendChild(ready);
  const help = el("section", "card"); help.appendChild(el("h2", null, "Controls")); const list = el("ul", "help-list"); ["Click or drag to apply the selected terrain or annotation.", "Solid blocks movement; platforms only catch falling feet.", "Water and hazards are intentionally separate so combat scripts can give each a distinct consequence.", "One player spawn and one boss anchor make a combat room immediately testable."].forEach((t) => list.appendChild(el("li", null, t))); help.appendChild(list); inspector.appendChild(help);
}
function field(labelText, control) { const wrap = el("div", "field"); wrap.appendChild(el("label", null, labelText)); wrap.appendChild(control); return wrap; }
function render() { renderTools(); renderWorkspace(); renderInspector(); }

function serializableArena() { return JSON.parse(JSON.stringify(state.arena)); }
function validate(data) {
  if (!data || data.kind !== "gb-boss-arena" || !Array.isArray(data.terrain)) throw new Error("Not a .gbarena.json project.");
  if (data.terrain.length !== W * H) throw new Error(`Expected ${W * H} terrain cells.`);
  if (!data.markers || !data.screen || data.screen.width !== W || data.screen.height !== H) throw new Error("This tool only supports a 20×18 single-screen arena.");
  data.terrain = data.terrain.map((cell) => TERRAIN[cell] ? cell : "empty");
  Object.keys(MARKERS).forEach((key) => { const p = data.markers[key]; data.markers[key] = p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < W && p.y >= 0 && p.y < H ? p : null; });
}
function exportArena() { const text = JSON.stringify(serializableArena(), null, 2); openModal("Export arena", (modal) => { modal.appendChild(el("p", "hint", "This .gbarena.json stores visual terrain, semantic collision types, annotations, and design notes. It is deliberately independent from overworld tiles.")); const row = el("div", "row"); const download = el("button", "primary", "Download .gbarena.json"); const copy = el("button", null, "Copy JSON"); row.append(download, copy); modal.appendChild(row); const out = document.createElement("textarea"); out.readOnly = true; out.value = text; modal.appendChild(out); download.addEventListener("click", () => downloadText(`${filename()}.gbarena.json`, text, "application/json")); copy.addEventListener("click", async () => { copy.textContent = await copyText(text) ? "Copied" : "Copy failed"; }); }); }
function importArena() { openModal("Import arena", (modal) => { modal.appendChild(el("p", "hint", "Choose a .gbarena.json file or paste its JSON.")); const choose = el("button", "primary", "Choose file"); const file = document.createElement("input"); file.type = "file"; file.accept = ".json,application/json"; file.style.display = "none"; const text = document.createElement("textarea"); text.placeholder = "Paste .gbarena.json here…"; const load = el("button", null, "Load pasted JSON"); modal.append(choose, file, text, load); const apply = (raw) => { try { const data = JSON.parse(raw); validate(data); state.arena = data; state.dirty = false; render(); document.getElementById("modal-backdrop")?.remove(); } catch (err) { alert(`Could not import arena: ${err.message}`); } }; choose.addEventListener("click", () => file.click()); file.addEventListener("change", () => { const selected = file.files[0]; if (!selected) return; const reader = new FileReader(); reader.onload = () => apply(reader.result); reader.readAsText(selected); }); load.addEventListener("click", () => apply(text.value)); }); }

document.getElementById("btn-new").addEventListener("click", () => { if (confirm("Start a blank arena? Export first to keep this one.")) { state.arena = makeArena(); state.dirty = false; render(); } });
document.getElementById("btn-import").addEventListener("click", importArena);
document.getElementById("btn-export").addEventListener("click", exportArena);
document.addEventListener("keydown", (event) => { if (event.target.matches("input, textarea, select")) return; const keys = ["empty", "solid", "platform", "water", "hazard", "ladder", "decor"]; const index = Number(event.key) - 1; if (index >= 0 && index < keys.length) { state.brush = keys[index]; renderTools(); draw(); } });
render();
