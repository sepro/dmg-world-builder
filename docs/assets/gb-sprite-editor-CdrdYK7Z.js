const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./gb-sprite-editor-CvOqsMmz.js","./common-68Tf6uEl.js"])))=>i.map(i=>d[i]);
import{m as t,L as e,_ as n}from"./theme-CNUsdib9.js";t(e,{target:document.body,props:{beforeMenu:`<span class="brand">GB&nbsp;Sprite&nbsp;Editor <span class="sub">v1</span></span>
    <div class="field" style="flex-direction:row;align-items:center;gap:6px;">
      <label style="margin:0;">Project</label>
      <input type="text" id="project-name" style="width:150px;">
    </div>
    <div class="field" style="flex-direction:row;align-items:center;gap:6px;">
      <label style="margin:0;">OBJ size</label>
      <select id="sprite-mode">
        <option value="8x8">8&times;8</option>
        <option value="8x16">8&times;16</option>
      </select>
    </div>
    <div class="field" style="flex-direction:row;align-items:center;gap:6px;">
      <label style="margin:0;" title="Render sprites through the OBP0/OBP1 shade mappings, as DMG hardware would">DMG preview
        <input type="checkbox" id="dmg-preview" style="vertical-align:middle;">
      </label>
    </div>
    <div class="spacer"></div>`,afterMenu:`<button id="btn-undo" title="Undo (Ctrl/Cmd+Z)">Undo</button>
    <button id="btn-redo" title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
    <button id="btn-new">New</button>
    <button id="btn-import">Import</button>
    <button class="primary" id="btn-export">Export</button>
    <input type="file" id="file-input" accept="application/json,.json" style="display:none;">`,content:`<nav class="tabs">
    <button class="tab" data-panel="palettes">Palettes</button>
    <button class="tab" data-panel="tiles">Tiles</button>
    <button class="tab" data-panel="metasprites">Metasprites</button>
    <button class="tab" data-panel="animations">Animations</button>
  </nav>

  <main id="panel"></main>`,currentPage:"gb-sprite-editor.html",initialize:()=>n(()=>import("./gb-sprite-editor-CvOqsMmz.js"),__vite__mapDeps([0,1]),import.meta.url)}});
