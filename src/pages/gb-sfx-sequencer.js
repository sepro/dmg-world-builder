import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-sfx.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;SFX&nbsp;Sequencer <span class=\"sub\">v1</span></span>\n    <span class=\"target-tag\">chimes &middot; DMG</span>\n    <div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-undo\">Undo</button>\n    <button id=\"btn-redo\">Redo</button>\n    <button id=\"btn-new\">New</button>\n    <button id=\"btn-import\">Import</button>\n    <button class=\"primary\" id=\"btn-export\">Export</button>",
    content: "<main id=\"panel\">\n    <div class=\"layout\">\n      <section class=\"col-left\" id=\"left-col\"></section>\n      <section class=\"col-right\" id=\"right-col\"></section>\n    </div>\n  </main>",
    currentPage: "gb-sfx-sequencer.html",
    initialize: () => import("../legacy/gb-sfx-sequencer.js"),
  },
});
