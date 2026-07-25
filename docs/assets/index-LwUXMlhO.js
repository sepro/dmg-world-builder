import{m as e,L as n,_ as a}from"./theme-DaBNiN0a.js";e(n,{target:document.body,props:{beforeMenu:`<span class="brand">GB&nbsp;Tool&nbsp;Suite <span class="sub">for DMG / GBC</span></span>
    <div class="spacer"></div>`,afterMenu:'<span class="target-tag">no build &middot; no server state</span>',content:`<div class="hero">
    <h1>Game Boy Tool Suite</h1>
    <p>Build worlds, sprites and chiptunes for GBDK-2020 — and squeeze your
       art into VRAM — right in the browser.</p>
  </div>

  <main class="tools">
    <a class="tool-card" href="gb-world-editor.html">
      <canvas id="preview-world" width="160" height="48"></canvas>
      <h2>World Editor</h2>
      <p>Draw 8&times;8 tiles, compose metatiles and blocks, paint maps, place
         warps and events. Exports .gbworld.json, convertible to GBDK-2020 C.</p>
      <span class="go">Open editor &raquo;</span>
    </a>
    <a class="tool-card" href="gb-sprite-editor.html">
      <canvas id="preview-sprite" width="160" height="48"></canvas>
      <h2>Sprite Editor</h2>
      <p>Draw or import sprite sheets, arrange 8&times;8 / 8&times;16 hardware
         sprites into metasprites, and sequence them into animations. Exports
         .gbsprite.json and PNG.</p>
      <span class="go">Open editor &raquo;</span>
    </a>
    <a class="tool-card" href="gb-music-generator.html">
      <canvas id="preview-music" width="160" height="48"></canvas>
      <h2>Music Generator</h2>
      <p>A deterministic four-channel chiptune improviser. Pick key, mood,
         pattern and seed; export settings as .gbmusic.json or a MIDI file.</p>
      <span class="go">Open generator &raquo;</span>
    </a>
    <a class="tool-card" href="gb-sfx-generator.html">
      <canvas id="preview-sfx" width="160" height="48"></canvas>
      <h2>SFX Generator</h2>
      <p>Design Game Boy sound effects from presets (coin, laser, jump,
         explosion&hellip;), refine with semantic sliders, and export
         .gbsfx.json, a WAV, or GBDK-2020 C with a tiny player.</p>
      <span class="go">Open generator &raquo;</span>
    </a>
    <a class="tool-card" href="gb-pixelizer.html">
      <canvas id="preview-pixelizer" width="160" height="48"></canvas>
      <h2>Pixelizer</h2>
      <p>Turn any image into 2-bit pixel art: tone controls, pixel-art-aware
         downscaling (k-centroid and friends), optional dithering, and a live
         tile-count readout.</p>
      <span class="go">Open pixelizer &raquo;</span>
    </a>
    <a class="tool-card" href="gb-tile-reducer.html">
      <canvas id="preview-reducer" width="160" height="48"></canvas>
      <h2>Tile Reducer</h2>
      <p>Load a PNG, count its unique 8&times;8 tiles, and merge similar ones
         until the image fits your VRAM budget while staying close to the
         original.</p>
      <span class="go">Open reducer &raquo;</span>
    </a>
  </main>

  <footer>Everything runs locally. Projects live in exported files, not the browser.</footer>`,currentPage:"",initialize:()=>a(()=>import("./index-HJP_9KxY.js"),[],import.meta.url)}});
