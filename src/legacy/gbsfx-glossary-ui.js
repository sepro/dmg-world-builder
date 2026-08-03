// @ts-nocheck
/*
  gbsfx-glossary-ui.js - the "what does this word mean?" layer.

  Both sound tools label their controls with borrowed studio vocabulary
  (decay, duty, envelope, tie). Every one of those words is underlined with a
  dashed line here and answers in two depths:

    hover / keyboard focus   a one-sentence blurb in a small popover
    click / Enter / Space    the full entry in a modal, with A/B demo sounds

  The definitions themselves live in `../lib/gbsfx-glossary.js` -- this file is
  only the DOM and the audio. Terms that cannot carry an underline (the
  options inside a dropdown, a table's column headings) are folded into the
  entry of the control they belong to, so `Tone` explains every duty cycle and
  wavetable it can offer rather than each needing its own hook.
*/

import { el, openModal } from "../lib/common.js";
import { glossaryByGroup, glossaryEntry } from "../lib/gbsfx-glossary.js";
import { audio } from "../lib/gbsfx-audio.js";

/* ============================================================
   The hover popover
   ============================================================
   One element, reused: only ever one term is hovered at a time, and a shared
   node means nothing can be orphaned by a re-render mid-hover.
*/

let popEl = null;
let popOwner = null;

function popover() {
  if (popEl) return popEl;
  popEl = el("div", "term-pop");
  popEl.setAttribute("role", "tooltip");
  popEl.id = "term-pop";
  popEl.hidden = true;
  document.body.appendChild(popEl);
  // A scroll or a resize moves the term the popover is pinned to, so follow it
  // rather than hiding: reaching a term below the fold *is* a scroll (the
  // browser brings it into view on focus, and Playwright does the same on
  // hover), and hiding there would blank the blurb the moment it was asked for.
  window.addEventListener("scroll", followOwner, true);
  window.addEventListener("resize", followOwner);
  return popEl;
}

function showPopover(anchor, entry) {
  const pop = popover();
  pop.innerHTML = "";
  pop.appendChild(el("strong", null, entry.term));
  pop.appendChild(el("span", null, entry.short));
  pop.appendChild(el("em", null, "Click for the full explanation"));
  pop.hidden = false;
  popOwner = anchor;
  anchor.setAttribute("aria-describedby", pop.id);
  place(anchor);
}

// Sit below the term, nudged back inside the viewport if it would spill out.
function place(anchor) {
  const pop = popover();
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
  let top = r.bottom + 6;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

function followOwner() {
  if (!popEl || popEl.hidden) return;
  // A re-render can take the term away underneath an open blurb.
  if (popOwner && document.contains(popOwner)) place(popOwner);
  else hidePopover();
}

function hidePopover() {
  if (!popEl || popEl.hidden) return;
  popEl.hidden = true;
  if (popOwner) popOwner.removeAttribute("aria-describedby");
  popOwner = null;
}

/* ============================================================
   A term
   ============================================================ */

/* The underlined word itself. `key` indexes the glossary; `text` overrides the
   printed label for the places a control is named more tersely than the term
   ("Vib depth" on a slider, "Vibrato depth" in prose). */
export function term(key, text) {
  const entry = glossaryEntry(key);
  // An unknown key must not cost the user a control label, so fall back to
  // plain text. The unit test is what keeps this from happening quietly.
  if (!entry) return el("span", null, text || key);

  const node = el("span", "term", text || entry.term);
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", entry.term + " - what does this mean?");
  node.addEventListener("mouseenter", () => showPopover(node, entry));
  node.addEventListener("mouseleave", hidePopover);
  node.addEventListener("focus", () => showPopover(node, entry));
  node.addEventListener("blur", hidePopover);
  node.addEventListener("click", (ev) => { ev.preventDefault(); openTerm(key); });
  node.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openTerm(key); }
    else if (ev.key === "Escape") hidePopover();
  });
  return node;
}

// A <label> wrapping a term, for the slider and field rows.
export function termLabel(key, text) {
  const l = document.createElement("label");
  l.appendChild(term(key, text));
  return l;
}

/* ============================================================
   The full entry
   ============================================================ */

export function openTerm(key) {
  const entry = glossaryEntry(key);
  if (!entry) return;
  hidePopover();
  openModal(entry.term, (modal) => {
    modal.appendChild(entryBody(entry));
    const back = el("button", "tiny", "All terms");
    back.addEventListener("click", () => openGlossary());
    modal.appendChild(el("div", "row")).appendChild(back);
  });
}

/* `withShort` is false in the browse-all list, where the row's summary is
   already the blurb and repeating it reads as a stutter. */
function entryBody(entry, withShort = true) {
  const box = el("div", "term-entry");
  if (withShort) box.appendChild(el("p", "term-short", entry.short));
  paragraphs(entry.plain).forEach(p => box.appendChild(el("p", null, p)));
  if (entry.example) {
    const ex = el("div", "term-example");
    ex.appendChild(el("span", "term-tag", "Sounds like"));
    ex.appendChild(el("p", null, entry.example));
    box.appendChild(ex);
  }
  if (entry.demo) box.appendChild(demoRow(entry.demo));
  if (entry.hardware) {
    const hw = el("div", "term-hardware");
    hw.appendChild(el("span", "term-tag", "On the hardware"));
    hw.appendChild(el("p", null, entry.hardware));
    box.appendChild(hw);
  }
  return box;
}

function paragraphs(plain) {
  if (!plain) return [];
  return Array.isArray(plain) ? plain : [plain];
}

/* The A/B demo: two throwaway sounds that differ only in this term, so it can
   be heard rather than read. They are built fresh on each press and played
   through the same engine as the preview, so pressing one stops the other. */
function demoRow(demo) {
  const wrap = el("div", "term-demo");
  wrap.appendChild(el("span", "term-tag", "Hear it"));
  const row = el("div", "row");
  [demo.a, demo.b].forEach(side => {
    const b = el("button", "tiny", "▶ " + side.label);
    b.addEventListener("click", () => {
      try { audio.play(side.build()); }
      catch (err) { b.textContent = "audio blocked"; }
    });
    row.appendChild(b);
  });
  wrap.appendChild(row);
  return wrap;
}

/* ============================================================
   Browse-all
   ============================================================ */

export function openGlossary() {
  hidePopover();
  openModal("Glossary", (modal) => {
    modal.appendChild(el("p", "hint",
      "Every term the sound tools use. Anything underlined with a dashed line in the editor opens its entry here too."));
    glossaryByGroup().forEach(group => {
      if (!group.entries.length) return;
      modal.appendChild(el("h2", null, group.label));
      const list = el("div", "term-list");
      group.entries.forEach(entry => {
        const item = el("details", "term-item");
        const sum = el("summary");
        sum.appendChild(el("span", "term-name", entry.term));
        sum.appendChild(el("span", "term-blurb", entry.short));
        item.appendChild(sum);
        item.appendChild(entryBody(entry, false));
        list.appendChild(item);
      });
      modal.appendChild(list);
    });
  });
}

// Wire the top bar's Glossary button. Both tools call this at boot.
export function wireGlossaryButton() {
  const btn = document.getElementById("btn-glossary");
  if (btn) btn.addEventListener("click", () => openGlossary());
}
