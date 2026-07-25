import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-sprite-editor.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;Sprite&nbsp;Editor <span class=\"sub\">v1</span></span>\n    <div class=\"field\" style=\"flex-direction:row;align-items:center;gap:6px;\">\n      <label style=\"margin:0;\">Project</label>\n      <input type=\"text\" id=\"project-name\" style=\"width:150px;\">\n    </div>\n    <div class=\"field\" style=\"flex-direction:row;align-items:center;gap:6px;\">\n      <label style=\"margin:0;\">OBJ size</label>\n      <select id=\"sprite-mode\">\n        <option value=\"8x8\">8&times;8</option>\n        <option value=\"8x16\">8&times;16</option>\n      </select>\n    </div>\n    <div class=\"field\" style=\"flex-direction:row;align-items:center;gap:6px;\">\n      <label style=\"margin:0;\" title=\"Render sprites through the OBP0/OBP1 shade mappings, as DMG hardware would\">DMG preview\n        <input type=\"checkbox\" id=\"dmg-preview\" style=\"vertical-align:middle;\">\n      </label>\n    </div>\n    <div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-undo\" title=\"Undo (Ctrl/Cmd+Z)\">Undo</button>\n    <button id=\"btn-redo\" title=\"Redo (Ctrl/Cmd+Shift+Z)\">Redo</button>\n    <button id=\"btn-new\">New</button>\n    <button id=\"btn-import\">Import</button>\n    <button class=\"primary\" id=\"btn-export\">Export</button>\n    <input type=\"file\" id=\"file-input\" accept=\"application/json,.json\" style=\"display:none;\">",
    content: "<nav class=\"tabs\">\n    <button class=\"tab\" data-panel=\"palettes\">Palettes</button>\n    <button class=\"tab\" data-panel=\"tiles\">Tiles</button>\n    <button class=\"tab\" data-panel=\"metasprites\">Metasprites</button>\n    <button class=\"tab\" data-panel=\"animations\">Animations</button>\n  </nav>\n\n  <main id=\"panel\"></main>",
    currentPage: "gb-sprite-editor.html",
    initialize: () => import("../legacy/gb-sprite-editor.js"),
  },
});
