import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-tile-reducer.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;Tile&nbsp;Reducer <span class=\"sub\">v1</span></span>\n    <span class=\"target-tag\">DMG-safe &middot; no flips</span>\n    <div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-load\">Load PNG</button>\n    <button class=\"primary\" id=\"btn-download\" disabled>Download reduced PNG</button>\n    <input type=\"file\" id=\"file-input\" accept=\"image/png,image/*\" style=\"display:none;\">",
    content: "<main id=\"panel\"></main>",
    currentPage: "gb-tile-reducer.html",
    initialize: () => import("../legacy/gb-tile-reducer.js"),
  },
});
