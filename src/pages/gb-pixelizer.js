import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-pixelizer.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;Pixelizer <span class=\"sub\">v1</span></span>\n    <span class=\"target-tag\">image &rarr; 2bpp pixel art</span>\n    <div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-load\">Load image</button>\n    <button id=\"btn-send\" disabled title=\"Open the result in the Tile Reducer\">Send to Reducer</button>\n    <button class=\"primary\" id=\"btn-download\" disabled>Download PNG</button>\n    <input type=\"file\" id=\"file-input\" accept=\"image/*\" style=\"display:none;\">",
    content: "<main id=\"panel\"></main>",
    currentPage: "gb-pixelizer.html",
    initialize: () => import("../legacy/gb-pixelizer.js"),
  },
});
