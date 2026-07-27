// @ts-nocheck
import { el, label, spacer, selectFrom, numberInput, clampInt, toggle, sendImageHandoff, downloadBlob } from "../lib/common.js";
import { scaleArray } from "../lib/pixelizer-downscale.js";

"use strict";

/* ============================================================
   Constants and state
   ============================================================ */

const TILE_PX = 8;
const TILE_BUDGET = 256;

// Reconstruction values per shade (0 = lightest), used for dithering error
// and for balancing thresholds. Midpoint-ish spread over 0..255.
const SHADE_LEVELS = [255, 170, 85, 0];

const PALETTES = [
  { name: "GB Green",  colors: ["#e0f8d0", "#88c070", "#346856", "#081820"] },
  { name: "Grayscale", colors: ["#ffffff", "#aaaaaa", "#555555", "#000000"] },
];

// Ordered-dither matrices (values 0..n^2-1), the classic GB dither look.
const BAYER = {
  bayer2: { n: 2, m: [0, 2, 3, 1] },
  bayer4: { n: 4, m: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] },
  bayer8: { n: 8, m: [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21] },
};

const state = {
  fileName: null,
  srcW: 0, srcH: 0,
  srcLum: null,             // Float32Array: source luminance 0..255 (alpha = lightest)
  srcRGBA: null,            // Uint8ClampedArray: raw source pixels, for color-key matching
  srcAlpha: null,           // Uint8Array: 1 = ignored/transparent source pixel
  srcCanvas: null,          // original image for the side-by-side preview

  // Transparency (chroma key): one source color becomes the alpha channel and
  // is left out of tone mapping, quantization, and the tile/palette stats.
  alphaEnabled: false,
  alphaColor: "#ff00ff",
  alphaTolerance: 32,       // RGB euclidean radius around alphaColor
  picking: false,           // eyedropper active: next source-canvas click sets alphaColor

  // Pipeline.
  order: "quantize-first",  // quantize-first | scale-first
  scaleAlgo: "edge-preserving", // edge-preserving | luminance-aware | k-centroid | dominant | box | nearest
  targetW: 160,
  kClusters: 3,             // k for k-centroid
  edgeStrength: 50,         // 0..100 maps to DPID lambda 0..1
  luminanceSensitivity: 28, // 5..100; lower isolates the dominant luminance more strongly

  // Tone controls (applied before anything else).
  autoLevels: true,         // percentile stretch 1..99 before the manual knobs
  brightness: 0,            // -100..100
  contrast: 0,              // -100..100
  gamma: 1.0,               // 0.2..3

  // Quantization.
  t1: 64, t2: 128, t3: 192, // shade boundaries: lum > t3 -> 0 ... <= t1 -> 3
  dither: "none",           // none | bayer2 | bayer4 | bayer8 | fs
  ditherStrength: 75,       // percent of one shade step

  // View.
  paletteIndex: 0,
  zoom: 0,                  // 0 = auto
  result: null,             // { shades: Uint8Array, w, h, uniqueTiles }
};

/* ============================================================
   Transparency (chroma key)
   ============================================================ */

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return "#" + h(r) + h(g) + h(b);
}

// Build the ignore mask: a pixel is transparent if it was already transparent
// in the source, or (when enabled) its color is within tolerance of alphaColor.
function computeAlphaMask() {
  const n = state.srcW * state.srcH;
  const mask = new Uint8Array(n);
  const data = state.srcRGBA;
  if (!data) return mask;

  const key = state.alphaEnabled ? hexToRgb(state.alphaColor) : null;
  const tol2 = state.alphaTolerance * state.alphaTolerance;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (data[j + 3] < 128) { mask[i] = 1; continue; }
    if (key) {
      const dr = data[j] - key[0], dg = data[j + 1] - key[1], db = data[j + 2] - key[2];
      if (dr * dr + dg * dg + db * db <= tol2) mask[i] = 1;
    }
  }
  return mask;
}

/* ============================================================
   Tone mapping
   ============================================================ */

// Apply auto-levels (percentile stretch), then brightness/contrast/gamma.
// Input and output are luminance arrays in 0..255 (not yet clamped to int).
// Transparent pixels (alpha[i] === 1) are left out of the percentile histogram
// so a chroma-key background can't skew the levels.
function toneMap(lum, alpha) {
  const out = new Float32Array(lum.length);

  let lo = 0, hi = 255;
  if (state.autoLevels) {
    // Stretch the 1st..99th percentile to full range; robust to outliers.
    const hist = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < lum.length; i++) {
      if (alpha && alpha[i]) continue;
      hist[Math.max(0, Math.min(255, Math.round(lum[i])))]++;
      total++;
    }
    if (total === 0) total = 1;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.01) { hi = v; break; } }
    if (hi <= lo) { lo = 0; hi = 255; }
  }

  const contrastFactor = Math.tan((state.contrast / 100 + 1) * Math.PI / 4); // -100..100 -> ~0..inf
  const invGamma = 1 / Math.max(0.2, state.gamma);
  for (let i = 0; i < lum.length; i++) {
    let v = (lum[i] - lo) * 255 / (hi - lo);                    // auto-levels
    v = (v - 128) * contrastFactor + 128 + state.brightness;    // contrast + brightness
    v = Math.max(0, Math.min(255, v));
    v = 255 * Math.pow(v / 255, invGamma);                      // gamma
    out[i] = v;
  }
  return out;
}

/* ============================================================
   Quantization to shades (0 = lightest .. 3 = darkest)
   ============================================================ */

function shadeFor(v) {
  if (v > state.t3) return 0;
  if (v > state.t2) return 1;
  if (v > state.t1) return 2;
  return 3;
}

// Quantize a luminance array to shades, with optional dithering.
function quantizeArr(gray, w, h) {
  const shades = new Uint8Array(gray.length);

  if (state.dither === "fs") {
    // Floyd-Steinberg error diffusion against the shade reconstruction levels.
    const buf = Float32Array.from(gray);
    const strength = state.ditherStrength / 100;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const s = shadeFor(buf[i]);
        shades[i] = s;
        const err = (buf[i] - SHADE_LEVELS[s]) * strength;
        if (x + 1 < w) buf[i + 1] += err * 7 / 16;
        if (y + 1 < h) {
          if (x > 0) buf[i + w - 1] += err * 3 / 16;
          buf[i + w] += err * 5 / 16;
          if (x + 1 < w) buf[i + w + 1] += err * 1 / 16;
        }
      }
    }
    return shades;
  }

  const bayer = BAYER[state.dither];
  if (bayer) {
    // Ordered dither: bias each pixel by its matrix cell, scaled to a
    // fraction of one shade step (~85), then threshold as usual.
    const spread = 85 * (state.ditherStrength / 100);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = (bayer.m[(y % bayer.n) * bayer.n + (x % bayer.n)] + 0.5) / (bayer.n * bayer.n) - 0.5;
        shades[y * w + x] = shadeFor(gray[y * w + x] + b * spread);
      }
    }
    return shades;
  }

  for (let i = 0; i < gray.length; i++) shades[i] = shadeFor(gray[i]);
  return shades;
}

/* ============================================================
   Downscaling
   ============================================================

   Every algorithm maps one output pixel to a floating source block
   [x0..x1) x [y0..y1) and reduces that block to one value. Reducers use exact
   fractional source-pixel coverage and work on either raw luminance
   (scale-first) or already-quantized shades (quantize-first). */

function downscale(src, srcAlpha, sw, sh, dw, dh, valueRange) {
  return scaleArray(src, srcAlpha, sw, sh, dw, dh, {
    algorithm: state.scaleAlgo,
    kClusters: state.kClusters,
    edgeStrength: state.edgeStrength,
    luminanceSensitivity: state.luminanceSensitivity,
    valueRange,
  });
}

/* ============================================================
   The pipeline
   ============================================================ */

function outputSize() {
  const dw = Math.max(TILE_PX, Math.min(state.srcW, state.targetW));
  const dh = Math.max(1, Math.round(state.srcH * dw / state.srcW));
  return { dw, dh };
}

function recompute() {
  if (!state.srcLum) return;
  const { dw, dh } = outputSize();
  const alphaMask = state.srcAlpha;
  const tone = toneMap(state.srcLum, alphaMask);

  let shades, alpha;
  if (state.order === "quantize-first") {
    // Quantize at source resolution, then scale in shade space. The reducers
    // see values 0..3, and the result is rounded back to a valid shade.
    const srcShades = quantizeArr(tone, state.srcW, state.srcH);
    const scaled = downscale(srcShades, alphaMask, state.srcW, state.srcH, dw, dh, 3);
    alpha = scaled.alpha;
    shades = new Uint8Array(dw * dh);
    for (let i = 0; i < shades.length; i++) {
      shades[i] = Math.max(0, Math.min(3, Math.round(scaled.out[i])));
    }
  } else {
    // Scale the tone-mapped luminance, then quantize (dithering happens at
    // output resolution, which is what dithering usually wants).
    const scaled = downscale(tone, alphaMask, state.srcW, state.srcH, dw, dh, 255);
    alpha = scaled.alpha;
    shades = quantizeArr(scaled.out, dw, dh);
  }

  state.result = { shades, alpha, w: dw, h: dh, uniqueTiles: countUniqueTiles(shades, alpha, dw, dh) };
}

// Unique 8x8 tiles the result would need, as a preview of the VRAM cost before
// the image goes anywhere near a map. Transparent pixels use a distinct symbol
// so identical transparent regions dedupe and mixed tiles stay honest.
function countUniqueTiles(shades, alpha, w, h) {
  const tw = Math.ceil(w / TILE_PX), th = Math.ceil(h / TILE_PX);
  const seen = new Set();
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let key = "";
      for (let y = 0; y < TILE_PX; y++) {
        for (let x = 0; x < TILE_PX; x++) {
          const sx = tx * TILE_PX + x, sy = ty * TILE_PX + y;
          if (sx >= w || sy >= h) { key += "0"; continue; }
          const idx = sy * w + sx;
          key += (alpha && alpha[idx]) ? "t" : shades[idx];
        }
      }
      seen.add(key);
    }
  }
  return seen.size;
}

/* ============================================================
   Image loading
   ============================================================ */

function loadImageFile(file) {
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;

      const lum = new Float32Array(img.width * img.height);
      for (let i = 0; i < lum.length; i++) {
        const j = i * 4;
        // Transparent pixels read as the lightest shade, like the importers.
        lum[i] = data[j + 3] < 128
          ? 255
          : 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      }
      state.fileName = file.name;
      state.srcW = img.width; state.srcH = img.height;
      state.srcLum = lum;
      state.srcRGBA = data;
      state.srcCanvas = canvas;
      state.targetW = Math.min(img.width, 160);   // GB screen width as the default
      state.picking = false;
      state.srcAlpha = computeAlphaMask();
      recompute();
      render();
    } catch (err) {
      alert("Could not load image: " + err.message);
    }
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => alert("Could not read that file as an image.");
  img.src = URL.createObjectURL(file);
}

/* ============================================================
   Rendering
   ============================================================ */

function autoZoom() {
  return Math.max(1, Math.min(8, Math.floor(480 / (state.result ? state.result.w : 160))));
}

// Paint a shade array via 1x ImageData + scaled blit (crisp and fast).
// Pixels flagged in `alpha` are written fully transparent (alpha byte 0).
function paintShades(canvas, shades, alpha, w, h, zoom, colors) {
  const rgb = colors.map(c => [
    parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16),
  ]);
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const sctx = src.getContext("2d");
  const img = sctx.createImageData(w, h);
  for (let i = 0; i < shades.length; i++) {
    const transparent = alpha && alpha[i];
    const [r, g, b] = rgb[shades[i]];
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = transparent ? 0 : 255;
  }
  sctx.putImageData(img, 0, 0);

  canvas.width = w * zoom; canvas.height = h * zoom;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
}

// A labeled slider row with a live value readout.
let sliderSerial = 0;
function sliderRow(text, min, max, step, value, format, onChange) {
  const field = el("div", "field");
  const sliderId = "pixelizer-slider-" + sliderSerial++;
  const sliderLabel = label(text);
  sliderLabel.htmlFor = sliderId;
  field.appendChild(sliderLabel);
  const row = el("div", "slider-row");
  const slider = document.createElement("input");
  slider.id = sliderId;
  slider.type = "range"; slider.min = min; slider.max = max; slider.step = step; slider.value = value;
  slider.setAttribute("aria-valuetext", format(value));
  const val = el("output", "slider-val", format(value));
  val.htmlFor = sliderId;
  slider.addEventListener("input", () => {
    const formatted = format(Number(slider.value));
    val.textContent = formatted;
    slider.setAttribute("aria-valuetext", formatted);
  });
  slider.addEventListener("change", () => onChange(Number(slider.value)));
  row.append(slider, val);
  field.appendChild(row);
  return field;
}

function render() {
  document.getElementById("btn-download").disabled = !state.result;
  document.getElementById("btn-send").disabled = !state.result;
  const panel = document.getElementById("panel");
  panel.innerHTML = "";

  if (!state.srcLum) {
    const card = el("div", "card");
    card.appendChild(el("h2", null, "Load an image"));
    const drop = el("div", "drop-zone",
      "Click to choose an image, or drop one here. Any size or color: it will be " +
      "tone-mapped, downscaled with a pixel-art-aware algorithm, and quantized " +
      "to the four DMG shades.");
    drop.addEventListener("click", () => document.getElementById("file-input").click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const file = e.dataTransfer.files[0];
      if (file) loadImageFile(file);
    });
    card.appendChild(drop);
    panel.appendChild(card);
    return;
  }

  const res = state.result;
  const cols = el("div", "cols");

  /* ---- left: pipeline controls ---- */
  const ctl = el("div", "card col-library");
  ctl.appendChild(el("h2", null, "Pipeline"));

  const { dw, dh } = outputSize();
  const wField = el("div", "field");
  wField.appendChild(label("Output width (px) — height follows: " + dh));
  const wIn = numberInput(state.targetW, TILE_PX, state.srcW);
  wIn.addEventListener("change", () => {
    state.targetW = clampInt(wIn.value, TILE_PX, state.srcW);
    recompute(); render();
  });
  wField.appendChild(wIn);
  ctl.appendChild(wField);

  const orderField = el("div", "field");
  orderField.appendChild(label("Order"));
  orderField.appendChild(selectFrom(
    [{ value: "quantize-first", label: "4 shades first, then scale" },
     { value: "scale-first", label: "Scale first, then 4 shades" }],
    state.order, v => { state.order = v; recompute(); render(); }));
  ctl.appendChild(orderField);
  ctl.appendChild(el("p", "hint", state.order === "quantize-first"
    ? "Keeps hard 2-bit edges through the scaler. Dithering is applied before scaling, so fine dither patterns mostly wash out."
    : "Keeps gradients for the quantizer; dithering happens at output resolution."));

  const algoField = el("div", "field");
  const algoLabel = label("Scale algorithm");
  algoLabel.htmlFor = "scale-algorithm";
  const algoSelect = selectFrom(
    [{ value: "edge-preserving", label: "Edge-preserving (recommended)" },
     { value: "luminance-aware", label: "Luminance-aware" },
     { value: "k-centroid", label: "K-centroid" },
     { value: "dominant", label: "Dominant value" },
     { value: "box", label: "Box average" },
     { value: "nearest", label: "Nearest sample" }],
    state.scaleAlgo, v => { state.scaleAlgo = v; recompute(); render(); });
  algoSelect.id = "scale-algorithm";
  algoField.append(algoLabel, algoSelect);
  ctl.appendChild(algoField);

  if (state.scaleAlgo === "edge-preserving") {
    const note = el("div", "algorithm-note");
    note.appendChild(el("span", "algorithm-tag", "Best for fine details"));
    note.appendChild(el("strong", null, "Edge-preserving"));
    note.appendChild(el("p", null,
      "Keeps locally distinctive lines, highlights, and facial details. The balanced default is tuned to preserve thin features without making them look heavy."));
    ctl.appendChild(note);
    ctl.appendChild(sliderRow("Detail strength", 0, 100, 5, state.edgeStrength, v => v + "%",
      v => { state.edgeStrength = v; recompute(); render(); }));
    ctl.appendChild(el("p", "hint",
      "Raise it when fine details disappear; lower it if lines thicken or image noise becomes prominent."));
  } else if (state.scaleAlgo === "luminance-aware") {
    const note = el("div", "algorithm-note");
    note.appendChild(el("span", "algorithm-tag", "Best for bold shapes"));
    note.appendChild(el("strong", null, "Luminance-aware"));
    note.appendChild(el("p", null,
      "Favors each block’s dominant light or dark band, keeping silhouettes and region boundaries cleaner than an ordinary average."));
    ctl.appendChild(note);
    ctl.appendChild(sliderRow("Edge softness", 5, 100, 1, state.luminanceSensitivity, v => String(v),
      v => { state.luminanceSensitivity = v; recompute(); render(); }));
    ctl.appendChild(el("p", "hint",
      "Lower values make boundaries crisper. Raise it for gentler transitions and less aggressive luminance selection."));
  }

  if (state.scaleAlgo === "k-centroid") {
    const kField = el("div", "field");
    kField.appendChild(label("K (clusters per block, 2-4)"));
    const kIn = numberInput(state.kClusters, 2, 4);
    kIn.addEventListener("change", () => {
      state.kClusters = clampInt(kIn.value, 2, 4);
      recompute(); render();
    });
    kField.appendChild(kIn);
    ctl.appendChild(kField);
  }

  /* ---- transparency (chroma key) ---- */
  ctl.appendChild(spacer(12));
  ctl.appendChild(el("h2", null, "Transparency"));
  ctl.appendChild(toggle("Key out a color (make it transparent)", state.alphaEnabled,
    v => {
      state.alphaEnabled = v;
      if (!v) state.picking = false;
      state.srcAlpha = computeAlphaMask();
      recompute(); render();
    }));
  if (state.alphaEnabled) {
    const keyField = el("div", "field");
    keyField.appendChild(label("Transparent color"));
    const keyRow = el("div", "key-row");
    const colorIn = document.createElement("input");
    colorIn.type = "color";
    colorIn.value = state.alphaColor;
    colorIn.addEventListener("input", () => {
      state.alphaColor = colorIn.value;
      state.srcAlpha = computeAlphaMask();
      recompute(); render();
    });
    const pickBtn = el("button", "tiny", state.picking ? "Click the image…" : "Pick from image");
    pickBtn.addEventListener("click", () => { state.picking = !state.picking; render(); });
    keyRow.append(colorIn, pickBtn);
    keyField.appendChild(keyRow);
    ctl.appendChild(keyField);

    ctl.appendChild(sliderRow("Tolerance", 0, 150, 1, state.alphaTolerance, v => String(v),
      v => { state.alphaTolerance = v; state.srcAlpha = computeAlphaMask(); recompute(); render(); }));
    ctl.appendChild(el("p", "hint",
      "Matching pixels become the alpha channel: left out of tone mapping, the shade split, and the tile count, and written transparent in the PNG."));
  }

  /* ---- tone ---- */
  ctl.appendChild(spacer(12));
  ctl.appendChild(el("h2", null, "Tone"));
  ctl.appendChild(toggle("Auto levels (stretch 1-99 percentile)", state.autoLevels,
    v => { state.autoLevels = v; recompute(); render(); }));
  ctl.appendChild(spacer(6));
  ctl.appendChild(sliderRow("Brightness", -100, 100, 1, state.brightness, v => String(v),
    v => { state.brightness = v; recompute(); render(); }));
  ctl.appendChild(sliderRow("Contrast", -100, 100, 1, state.contrast, v => String(v),
    v => { state.contrast = v; recompute(); render(); }));
  ctl.appendChild(sliderRow("Gamma", 0.2, 3, 0.05, state.gamma, v => v.toFixed(2),
    v => { state.gamma = v; recompute(); render(); }));

  /* ---- quantization ---- */
  ctl.appendChild(spacer(12));
  ctl.appendChild(el("h2", null, "Shades"));
  ctl.appendChild(sliderRow("Dark / mid-dark boundary", 1, 253, 1, state.t1, v => String(v),
    v => { state.t1 = Math.min(v, state.t2 - 1); recompute(); render(); }));
  ctl.appendChild(sliderRow("Mid-dark / mid-light boundary", 2, 254, 1, state.t2, v => String(v),
    v => { state.t2 = Math.max(state.t1 + 1, Math.min(v, state.t3 - 1)); recompute(); render(); }));
  ctl.appendChild(sliderRow("Mid-light / light boundary", 3, 255, 1, state.t3, v => String(v),
    v => { state.t3 = Math.max(state.t2 + 1, v); recompute(); render(); }));

  const balanceBtn = el("button", "tiny", "Balance shades");
  balanceBtn.title = "Fit the boundaries to the image: 4-cluster split of the tone-mapped histogram (Otsu-style)";
  balanceBtn.addEventListener("click", () => {
    // Percentile splits fail on images dominated by one brightness (a mostly
    // white background pushes all three boundaries to 255). Instead, run a
    // weighted 1D k-means over the histogram: a dominant background becomes
    // ONE cluster, and the thresholds land between the four cluster centers.
    const tone = toneMap(state.srcLum, state.srcAlpha);
    const hist = new Float64Array(256);
    for (let i = 0; i < tone.length; i++) {
      if (state.srcAlpha && state.srcAlpha[i]) continue;
      hist[Math.max(0, Math.min(255, Math.round(tone[i])))]++;
    }

    const centers = [32, 96, 160, 224];   // ascending init keeps clusters ordered
    for (let iter = 0; iter < 24; iter++) {
      const sums = [0, 0, 0, 0], ns = [0, 0, 0, 0];
      for (let v = 0; v < 256; v++) {
        if (!hist[v]) continue;
        let best = 0, bestD = Infinity;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(v - centers[c]);
          if (d < bestD) { bestD = d; best = c; }
        }
        sums[best] += v * hist[v];
        ns[best] += hist[v];
      }
      let moved = false;
      for (let c = 0; c < 4; c++) {
        if (!ns[c]) continue;                 // empty cluster keeps its center
        const next = sums[c] / ns[c];
        if (Math.abs(next - centers[c]) > 0.25) moved = true;
        centers[c] = next;
      }
      if (!moved) break;
    }
    centers.sort((a, b) => a - b);
    // Boundaries halfway between adjacent centers, kept strictly ordered.
    state.t1 = Math.max(1, Math.min(253, Math.round((centers[0] + centers[1]) / 2)));
    state.t2 = Math.max(state.t1 + 1, Math.min(254, Math.round((centers[1] + centers[2]) / 2)));
    state.t3 = Math.max(state.t2 + 1, Math.min(255, Math.round((centers[2] + centers[3]) / 2)));
    recompute(); render();
  });
  ctl.appendChild(balanceBtn);

  ctl.appendChild(spacer(10));
  const dField = el("div", "field");
  dField.appendChild(label("Dithering"));
  dField.appendChild(selectFrom(
    [{ value: "none", label: "None (best for tiles)" },
     { value: "bayer2", label: "Bayer 2×2" },
     { value: "bayer4", label: "Bayer 4×4" },
     { value: "bayer8", label: "Bayer 8×8" },
     { value: "fs", label: "Floyd–Steinberg" }],
    state.dither, v => { state.dither = v; recompute(); render(); }));
  ctl.appendChild(dField);
  if (state.dither !== "none") {
    ctl.appendChild(sliderRow("Dither strength (%)", 0, 150, 5, state.ditherStrength, v => String(v),
      v => { state.ditherStrength = v; recompute(); render(); }));
    ctl.appendChild(el("p", "hint",
      "Dithering multiplies unique tile counts — watch the stat below if this art is headed for a tileset."));
  }

  /* ---- stats + view ---- */
  ctl.appendChild(spacer(12));
  const table = document.createElement("table");
  table.className = "stats-table";
  const trow = (k, v) => {
    const tr = document.createElement("tr");
    tr.appendChild(el("td", null, k));
    tr.appendChild(el("td", null, v));
    table.appendChild(tr);
  };
  trow("Source", state.fileName + " (" + state.srcW + "×" + state.srcH + ")");
  trow("Output", res.w + "×" + res.h);
  trow("Unique 8×8 tiles", String(res.uniqueTiles));
  ctl.appendChild(table);
  const fits = res.uniqueTiles <= TILE_BUDGET;
  ctl.appendChild(el("p", fits ? "budget-ok" : "budget-over",
    res.uniqueTiles + " / " + TILE_BUDGET + " VRAM budget" +
    (fits ? "" : "  (use “Send to Reducer” to merge tiles)")));

  ctl.appendChild(spacer(10));
  const viewRow = el("div", "row");
  const palField = el("div", "field");
  palField.appendChild(label("Palette"));
  palField.appendChild(selectFrom(
    PALETTES.map((p, i) => ({ value: i, label: p.name })),
    state.paletteIndex, v => { state.paletteIndex = Number(v); render(); }));
  const zoomField = el("div", "field");
  zoomField.appendChild(label("Zoom"));
  zoomField.appendChild(selectFrom(
    [{ value: 0, label: "auto" }, 1, 2, 3, 4, 6, 8],
    state.zoom, v => { state.zoom = Number(v); render(); }));
  viewRow.append(palField, zoomField);
  ctl.appendChild(viewRow);

  ctl.appendChild(spacer(12));
  const loadOther = el("button", null, "Load another image");
  loadOther.addEventListener("click", () => document.getElementById("file-input").click());
  ctl.appendChild(loadOther);

  cols.appendChild(ctl);

  /* ---- right: source and result previews ---- */
  const srcCard = el("div", "card col-editor");
  srcCard.appendChild(el("h2", null, "Source" +
    (state.picking ? " — click to pick the transparent color" : "")));
  const srcWrap = el("div", "preview-wrap" + (state.picking ? " picking" : ""));
  const srcView = document.createElement("canvas");
  // Fit the source preview to roughly the same on-screen width as the result.
  const fit = Math.min(1, 480 / state.srcW);
  srcView.width = Math.max(1, Math.round(state.srcW * fit));
  srcView.height = Math.max(1, Math.round(state.srcH * fit));
  const sctx = srcView.getContext("2d");
  sctx.drawImage(state.srcCanvas, 0, 0, srcView.width, srcView.height);
  if (state.picking) {
    // Eyedropper: map the click back to a source pixel and adopt its color.
    srcView.addEventListener("click", (e) => {
      const rect = srcView.getBoundingClientRect();
      const sx = Math.floor((e.clientX - rect.left) / fit);
      const sy = Math.floor((e.clientY - rect.top) / fit);
      if (sx < 0 || sy < 0 || sx >= state.srcW || sy >= state.srcH) return;
      const j = (sy * state.srcW + sx) * 4;
      state.alphaColor = rgbToHex(state.srcRGBA[j], state.srcRGBA[j + 1], state.srcRGBA[j + 2]);
      state.alphaEnabled = true;
      state.picking = false;
      state.srcAlpha = computeAlphaMask();
      recompute(); render();
    });
  }
  srcWrap.appendChild(srcView);
  srcCard.appendChild(srcWrap);
  cols.appendChild(srcCard);

  const outCard = el("div", "card col-editor");
  outCard.appendChild(el("h2", null, "Result — " + res.w + "×" + res.h +
    " · " + res.uniqueTiles + " unique tiles"));
  const hasAlpha = res.alpha && res.alpha.some(a => a);
  const outWrap = el("div", "preview-wrap" + (hasAlpha ? " preview-checker" : ""));
  const outView = document.createElement("canvas");
  paintShades(outView, res.shades, res.alpha, res.w, res.h, state.zoom || autoZoom(), PALETTES[state.paletteIndex].colors);
  outWrap.appendChild(outView);
  outCard.appendChild(outWrap);
  cols.appendChild(outCard);

  panel.appendChild(cols);
}

/* ============================================================
   Download
   ============================================================ */

// The result at 1x in the current palette: the exact pixels the download and
// the reducer handoff share, so both routes re-import identically.
function resultCanvas() {
  const { shades, w, h } = state.result;
  const canvas = document.createElement("canvas");
  paintShades(canvas, shades, state.result.alpha, w, h, 1, PALETTES[state.paletteIndex].colors);
  return canvas;
}

function resultBaseName() {
  return (state.fileName || "image").replace(/\.[^.]*$/, "").replace(/[^a-z0-9_-]+/gi, "_");
}

function downloadResult() {
  if (!state.result) return;
  resultCanvas().toBlob(blob => {
    if (blob) downloadBlob(resultBaseName() + "-2bpp.png", blob);
    else alert("Could not encode the PNG.");
  }, "image/png");
}

// Hand the result to the tile reducer without a download/upload round trip.
function sendToReducer() {
  if (!state.result) return;
  sendImageHandoff("gb-tile-reducer.html",
    resultBaseName() + "-2bpp.png",
    resultCanvas().toDataURL("image/png"));
}

/* ============================================================
   Wiring
   ============================================================ */

document.getElementById("btn-load").addEventListener("click", () =>
  document.getElementById("file-input").click());
document.getElementById("btn-download").addEventListener("click", downloadResult);
document.getElementById("btn-send").addEventListener("click", sendToReducer);
document.getElementById("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadImageFile(file);
  e.target.value = "";   // allow reloading the same file
});

render();
