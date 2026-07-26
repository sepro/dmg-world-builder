/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

const pages = [
  "index.html",
  "gb-world-editor.html",
  "gb-arena-editor.html",
  "gb-sprite-editor.html",
  "gb-music-generator.html",
  "gb-sfx-generator.html",
  "gb-pixelizer.html",
  "gb-tile-reducer.html",
];

export default defineConfig({
  plugins: [svelte()],
  base: "./",
  build: {
    outDir: "docs",
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((page) => [page.replace(/\.html$/, ""), resolve(page)]),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.js"],
  },
});
