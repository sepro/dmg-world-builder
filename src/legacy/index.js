// @ts-nocheck
"use strict";
/* Tiny decorative previews drawn in the four DMG shades. */
const SHADES = ["#e0f8d0", "#88c070", "#346856", "#081820"];

/* World preview: a little tile landscape (trees, water, path). */
(() => {
  const ctx = document.getElementById("preview-world").getContext("2d");
  const px = (x, y, v) => { ctx.fillStyle = SHADES[v]; ctx.fillRect(x * 4, y * 4, 4, 4); };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 40; x++) px(x, y, 1);       // grass
  for (let y = 2; y < 6; y++) for (let x = 26; x < 36; x++) px(x, y, 2);       // pond
  for (let y = 0; y < 12; y++) { px(8, y, 0); px(9, y, 0); }                   // path
  [[3,2],[5,7],[14,3],[18,8],[22,5],[13,9]].forEach(([x, y]) => {              // trees
    px(x, y, 3); px(x + 1, y, 3); px(x, y + 1, 3); px(x + 1, y + 1, 3);
  });
})();

/* Sprite preview: a little walking creature and its animation "frames". */
(() => {
  const ctx = document.getElementById("preview-sprite").getContext("2d");
  ctx.fillStyle = SHADES[3];
  ctx.fillRect(0, 0, 160, 48);
  const px = (x, y, v) => { ctx.fillStyle = SHADES[v]; ctx.fillRect(x * 4, y * 4, 4, 4); };
  // Three frames of a tiny blob hopping across the card.
  const blob = (ox, oy, squash) => {
    const h = squash ? 4 : 5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 6; x++) {
        const edge = (y === 0 || y === h - 1 || x === 0 || x === 5);
        px(ox + x, oy + (5 - h) + y, edge ? 1 : 0);
      }
    }
    px(ox + 1, oy + (5 - h) + 1, 2); px(ox + 4, oy + (5 - h) + 1, 2);   // eyes
  };
  blob(4, 4, false); blob(17, 2, false); blob(30, 5, true);
  // A ground line beneath the hops.
  for (let x = 2; x < 38; x++) px(x, 10, 2);
})();

/* Pixelizer preview: a smooth gradient "photo" turning into chunky 2-bit art. */
(() => {
  const ctx = document.getElementById("preview-pixelizer").getContext("2d");
  // Left half: a smooth grayscale gradient with a "sun".
  for (let x = 0; x < 72; x++) {
    const g = ctx.createLinearGradient(0, 0, 0, 48);
    g.addColorStop(0, "#e8e8e8"); g.addColorStop(1, "#202020");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1, 48);
  }
  ctx.fillStyle = "#fafafa";
  ctx.beginPath(); ctx.arc(22, 14, 8, 0, Math.PI * 2); ctx.fill();
  // Arrow.
  ctx.fillStyle = SHADES[0];
  ctx.fillRect(76, 21, 10, 4);
  ctx.beginPath(); ctx.moveTo(86, 15); ctx.lineTo(94, 23); ctx.lineTo(86, 31); ctx.fill();
  // Right half: the same scene as chunky 4-shade pixels.
  const px = (x, y, v) => { ctx.fillStyle = SHADES[v]; ctx.fillRect(100 + x * 6, y * 6, 6, 6); };
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 10; x++) px(x, y, y < 3 ? 1 : y < 5 ? 2 : 3);
  px(2, 1, 0); px(3, 1, 0); px(2, 2, 0); px(3, 2, 0);   // the sun, now 4 fat pixels
})();

/* Reducer preview: a dense tile grid collapsing into fewer tiles. */
(() => {
  const ctx = document.getElementById("preview-reducer").getContext("2d");
  ctx.fillStyle = SHADES[3];
  ctx.fillRect(0, 0, 160, 48);
  // Left: a "many unique tiles" jumble; right: the same area from 3 tiles.
  const cell = (x, y, v) => { ctx.fillStyle = SHADES[v]; ctx.fillRect(x, y, 10, 10); };
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 5; x++) cell(6 + x * 12, 2 + y * 11, Math.floor(rnd() * 3));
  // Arrow.
  ctx.fillStyle = SHADES[0];
  ctx.fillRect(72, 21, 14, 4);
  ctx.beginPath(); ctx.moveTo(86, 15); ctx.lineTo(94, 23); ctx.lineTo(86, 31); ctx.fill();
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 5; x++) cell(100 + x * 12, 2 + y * 11, (x + y) % 2 ? 1 : 2);
})();

/* SFX preview: a decaying envelope over a falling pitch sweep. */
(() => {
  const ctx = document.getElementById("preview-sfx").getContext("2d");
  ctx.fillStyle = SHADES[3];
  ctx.fillRect(0, 0, 160, 48);
  // Falling pitch bars along the top (a "laser" sweep).
  ctx.fillStyle = SHADES[1];
  for (let i = 0; i < 30; i++) {
    const x = 6 + i * 5;
    const y = 6 + i * 0.7;
    ctx.fillRect(x, y, 3, 2);
  }
  // Decaying volume bars along the bottom.
  ctx.fillStyle = SHADES[0];
  for (let i = 0; i < 30; i++) {
    const x = 6 + i * 5;
    const h = Math.max(2, 22 * Math.exp(-i * 0.12));
    ctx.fillRect(x, 44 - h, 3, h);
  }
})();

/* Music preview: a piano-roll-ish scatter of note bars. */
(() => {
  const ctx = document.getElementById("preview-music").getContext("2d");
  ctx.fillStyle = SHADES[3];
  ctx.fillRect(0, 0, 160, 48);
  const lanes = [[0, 8, 1], [16, 24, 1], [32, 40, 2]];  // [yMin, yMax, shade]
  let x = 2;
  let step = 1;
  while (x < 156) {
    const [lo, hi, v] = lanes[step % 3];
    const w = 6 + (step * 7) % 14;
    ctx.fillStyle = SHADES[v === 2 ? 0 : v];
    ctx.fillRect(x, lo + (step * 5) % (hi - lo), w, 4);
    x += w + 4;
    step++;
  }
})();

/* Arena preview: a water pit and elevated one-way platforms. */
(() => {
  const ctx = document.getElementById("preview-arena").getContext("2d");
  const px = (x, y, v) => { ctx.fillStyle = SHADES[v]; ctx.fillRect(x * 4, y * 4, 4, 4); };
  for (let y = 0; y < 12; y++) for (let x = 0; x < 40; x++) px(x, y, 0);
  for (let x = 0; x < 20; x++) { px(x, 10, 3); px(x, 11, 2); }
  for (let x = 20; x < 40; x++) { px(x, 10, 2); px(x, 11, 1); }
  for (let x = 7; x < 21; x++) px(x, 7, 3);
  for (let x = 14; x < 19; x++) px(x, 4, 3);
  px(4, 8, 3); px(5, 8, 3);
  px(34, 7, 3); px(35, 7, 3); px(34, 8, 3);
})();




export {};
