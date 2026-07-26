import { mount } from "svelte";
import LegacyToolPage from "../components/LegacyToolPage.svelte";
import "../styles/theme.css";
import "../styles/pages/gb-arena-editor.css";

mount(LegacyToolPage, {
  target: document.body,
  props: {
    beforeMenu: "<span class=\"brand\">GB&nbsp;Boss&nbsp;Arena <span class=\"sub\">single screen</span></span><span class=\"target-tag\">20 &times; 18 tiles &middot; 160 &times; 144 px</span><div class=\"spacer\"></div>",
    afterMenu: "<button id=\"btn-undo\" title=\"Undo (Ctrl/Cmd+Z)\">Undo</button><button id=\"btn-redo\" title=\"Redo (Ctrl/Cmd+Shift+Z)\">Redo</button><button id=\"btn-new\">New</button><button id=\"btn-import\">Import</button><button class=\"primary\" id=\"btn-export\">Export</button>",
    content: "<main id=\"panel\"><div class=\"arena-layout\"><aside id=\"arena-tools\"></aside><section id=\"arena-workspace\"></section><aside id=\"arena-inspector\"></aside></div></main>",
    currentPage: "gb-arena-editor.html",
    initialize: () => import("../legacy/gb-arena-editor.js"),
  },
});
