const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./gb-world-editor-p_m1cVVi.js","./common-68Tf6uEl.js"])))=>i.map(i=>d[i]);
import{m as t,L as n,_ as a}from"./theme-DCgAGtXn.js";t(n,{target:document.body,props:{beforeMenu:`<span class="brand">GB&nbsp;World&nbsp;Editor <span class="sub">v1</span></span>
    <div class="field" style="flex-direction:row;align-items:center;gap:6px;">
      <label style="margin:0;">Project</label>
      <input type="text" id="project-name" style="width:180px;">
    </div>
    <span class="target-tag" id="target-tag"></span>
    <div class="spacer"></div>`,afterMenu:`<button id="btn-undo" title="Undo (Ctrl/Cmd+Z)">Undo</button>
    <button id="btn-redo" title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
    <button id="btn-new">New</button>
    <button id="btn-import">Import</button>
    <button class="primary" id="btn-export">Export</button>
    <input type="file" id="file-input" accept="application/json,.json" style="display:none;">`,content:`<nav class="tabs">
    <button class="tab" data-panel="palettes">Palettes</button>
    <button class="tab" data-panel="tiles">Tiles</button>
    <button class="tab" data-panel="metatiles">Metatiles</button>
    <button class="tab" data-panel="blocks">Blocks</button>
    <button class="tab" data-panel="maps">Maps</button>
  </nav>

  <main id="panel"></main>`,currentPage:"gb-world-editor.html",initialize:()=>a(()=>import("./gb-world-editor-p_m1cVVi.js"),__vite__mapDeps([0,1]),import.meta.url)}});
