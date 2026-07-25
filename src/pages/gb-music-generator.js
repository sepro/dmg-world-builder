import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-music-generator.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;Music&nbsp;Generator <span class=\"sub\">v1</span></span>\n    <div class=\"field\" style=\"flex-direction:row;align-items:center;gap:6px;\">\n      <label style=\"margin:0;\">Tune</label>\n      <input type=\"text\" id=\"tune-name\" style=\"width:180px;\">\n    </div>\n    <span class=\"target-tag\">4 channels &middot; DMG</span>\n    <div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-new\">New</button>\n    <button id=\"btn-import\">Import</button>\n    <button class=\"primary\" id=\"btn-export\">Export</button>",
    content: "<main id=\"panel\">\n    <div class=\"layout\">\n      <section class=\"col-settings\" id=\"settings-col\"></section>\n      <section class=\"col-output\" id=\"output-col\"></section>\n    </div>\n  </main>",
    currentPage: "gb-music-generator.html",
    initialize: () => import("../legacy/gb-music-generator.js"),
  },
});
