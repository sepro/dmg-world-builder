"use strict";
/*
  gb-common.js - small shared helpers for the GB tool suite.

  Pure, framework-free utilities used by both the world editor and the music
  generator: DOM construction, form-control factories, the modal, and
  file download / clipboard helpers. No page-specific state lives here.
*/

/* ---- DOM construction ---- */

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
function label(text) { return el("label", null, text); }
function spacer(px) { const d = document.createElement("div"); d.style.height = px + "px"; return d; }

function inputText(value, widthPx) {
  const i = document.createElement("input");
  i.type = "text"; i.value = value;
  if (widthPx) i.style.width = widthPx + "px";
  return i;
}
function selectFrom(options, current, onChange) {
  const s = document.createElement("select");
  options.forEach(o => {
    // Allow plain strings or {value,label} pairs.
    const value = (o && o.value !== undefined) ? o.value : o;
    const text = (o && o.label !== undefined) ? o.label : o;
    const opt = document.createElement("option");
    opt.value = value; opt.textContent = text;
    if (String(value) === String(current)) opt.selected = true;
    s.appendChild(opt);
  });
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function numberInput(value, min, max) {
  const i = document.createElement("input");
  i.type = "number"; i.value = value;
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  i.style.width = "80px";
  return i;
}
function clampInt(value, min, max) {
  const n = Math.round(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}
// A labeled checkbox that reports its boolean on change.
function toggle(text, checked, onChange) {
  const wrap = el("label", "group");
  wrap.style.cursor = "pointer";
  const box = document.createElement("input");
  box.type = "checkbox"; box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  wrap.append(box, el("span", "cell-label", text));
  return wrap;
}

/* ---- Modal ---- */

function openModal(title, buildContent) {
  closeModal();
  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "modal-backdrop";
  const modal = el("div", "modal");
  const close = el("button", "tiny modal-close", "Close");
  close.addEventListener("click", closeModal);
  modal.appendChild(close);
  modal.appendChild(el("h2", null, title));
  buildContent(modal);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
}
function closeModal() {
  const existing = document.getElementById("modal-backdrop");
  if (existing) existing.remove();
}

/* ---- Cross-tool image handoff ---- */

// Lets one tool pass its output image straight into another (e.g. Pixelizer ->
// Tile Reducer) without a download/upload round trip. The image travels as a
// PNG data URL through sessionStorage, which survives a same-tab navigation on
// the same origin. The key is read-and-removed on pickup, so nothing persists
// beyond the hop (the tools otherwise avoid browser storage on purpose).
const IMAGE_HANDOFF_KEY = "gb-image-handoff";

function sendImageHandoff(targetPage, name, dataUrl) {
  try {
    sessionStorage.setItem(IMAGE_HANDOFF_KEY, JSON.stringify({ name, dataUrl }));
  } catch (err) {
    // Quota or a storage-blocking context: fall back to the manual route.
    alert("Could not hand the image over (" + err.message + "). " +
      "Download the PNG and load it in the other tool instead.");
    return;
  }
  location.href = targetPage;
}

function takeImageHandoff() {
  try {
    const raw = sessionStorage.getItem(IMAGE_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(IMAGE_HANDOFF_KEY);
    const handoff = JSON.parse(raw);
    return (handoff && typeof handoff.dataUrl === "string") ? handoff : null;
  } catch {
    return null;
  }
}

/* ---- File / clipboard ---- */

// Try a real file download. This works when the page is opened directly, but a
// sandboxed preview may block it, which is why callers also offer copy.
function downloadBlob(filename, blob) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    alert("Download was blocked here. Use Copy or the text box instead.");
    return false;
  }
}
function downloadText(filename, text, mime) {
  return downloadBlob(filename, new Blob([text], { type: mime || "text/plain" }));
}
// Resolves true on success so callers can show feedback. Falls back to execCommand.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
    return ok;
  }
}


/* ---- Shared tool menu ---- */

// One source of truth for the suite's navigation, grouped by what each tool is
// for. Every page renders this identical menu, including a link to itself, so
// the same markup works everywhere; the current page's link is marked active
// for orientation rather than hidden. To add a tool, edit only this table.
const TOOL_GROUPS = [
  { label: "Pre-process", tools: [
    { name: "Pixelizer", href: "gb-pixelizer.html" },
    { name: "Reducer",   href: "gb-tile-reducer.html" },
  ] },
  { label: "Graphics", tools: [
    { name: "World",   href: "gb-world-editor.html" },
    { name: "Sprites", href: "gb-sprite-editor.html" },
  ] },
  { label: "Audio", tools: [
    { name: "Music \u266a", href: "gb-music-generator.html" },
    { name: "SFX \u266a",   href: "gb-sfx-generator.html" },
  ] },
];

function buildToolMenu() {
  const nav = el("nav", "tool-menu");
  // Match on the file name so it works from any serving path (root or /dist).
  const here = location.pathname.split("/").pop();
  TOOL_GROUPS.forEach(group => {
    const g = el("span", "tool-group");
    g.appendChild(el("span", "tool-group-label", group.label));
    group.tools.forEach(tool => {
      const a = el("a", "nav-link", tool.name);
      a.href = tool.href;
      if (tool.href === here) a.classList.add("active");
      g.appendChild(a);
    });
    nav.appendChild(g);
  });
  return nav;
}

// Swap any <nav class="tool-menu"> placeholder in the page for the real menu.
function mountToolMenu() {
  document.querySelectorAll("nav.tool-menu").forEach(ph => ph.replaceWith(buildToolMenu()));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountToolMenu);
} else {
  mountToolMenu();
}
