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
