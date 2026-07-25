import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-world-editor.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;World&nbsp;Editor <span class=\"sub\">v1</span></span>\n    <div class=\"field\" style=\"flex-direction:row;align-items:center;gap:6px;\">\n      <label style=\"margin:0;\">Project</label>\n      <input type=\"text\" id=\"project-name\" style=\"width:180px;\">\n    </div>\n    <span class=\"target-tag\" id=\"target-tag\"></span>\n    <div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-undo\" title=\"Undo (Ctrl/Cmd+Z)\">Undo</button>\n    <button id=\"btn-redo\" title=\"Redo (Ctrl/Cmd+Shift+Z)\">Redo</button>\n    <button id=\"btn-new\">New</button>\n    <button id=\"btn-import\">Import</button>\n    <button class=\"primary\" id=\"btn-export\">Export</button>\n    <input type=\"file\" id=\"file-input\" accept=\"application/json,.json\" style=\"display:none;\">",
    content: "<nav class=\"tabs\">\n    <button class=\"tab\" data-panel=\"palettes\">Palettes</button>\n    <button class=\"tab\" data-panel=\"tiles\">Tiles</button>\n    <button class=\"tab\" data-panel=\"metatiles\">Metatiles</button>\n    <button class=\"tab\" data-panel=\"blocks\">Blocks</button>\n    <button class=\"tab\" data-panel=\"maps\">Maps</button>\n  </nav>\n\n  <main id=\"panel\"></main>",
    currentPage: "gb-world-editor.html",
    initialize: () => import("../legacy/gb-world-editor.js"),
  },
});
