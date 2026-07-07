// Capture the README screenshots with a headless Chromium.
//
//   1. Serve the repo root:   python3 -m http.server 8000
//   2. Make the sample image: python3 tools/screenshots/make_landscape.py
//   3. Run this script:       node tools/screenshots/capture.js
//
// Set BASE to point elsewhere (default http://localhost:8000). Chromium comes
// from the @sparticuz/chromium npm package, so no separate browser download is
// needed - handy on restricted networks where the Playwright/Chrome CDNs are
// blocked. Install deps first: npm install (in this folder).
const path = require("path");
const chromium = require("@sparticuz/chromium").default;
const puppeteer = require("puppeteer-core");

const BASE = (process.env.BASE || "http://localhost:8000").replace(/\/$/, "");
const OUT = path.join(__dirname, "..", "..", "docs", "screenshots");
const SAMPLE = path.join(OUT, "landscape-sample.png");

// Default-state screenshots: one per tool plus the landing page.
const staticPages = [
  ["landing", "/docs/"],
  ["world-editor", "/docs/gb-world-editor.html"],
  ["sprite-editor", "/docs/gb-sprite-editor.html"],
  ["music-generator", "/docs/gb-music-generator.html"],
  ["sfx-generator", "/docs/gb-sfx-generator.html"],
];

(async () => {
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 950, deviceScaleFactor: 2 });

  for (const [name, urlPath] of staticPages) {
    await page.goto(BASE + urlPath, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 900)); // let canvas UIs paint
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    console.log("saved", name);
  }

  // Pixelizer: load the sample landscape so the real interface is shown, not
  // the empty upload panel. Wait until the 2-bit result enables Download.
  await page.goto(BASE + "/docs/gb-pixelizer.html", { waitUntil: "networkidle0" });
  const input = await page.$("#file-input");
  await input.uploadFile(SAMPLE);
  await page.waitForSelector("#btn-download:not([disabled])", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, "pixelizer.png"), fullPage: true });
  console.log("saved pixelizer");

  // Tile reducer: hand the pixelizer result straight over via "Send to Reducer"
  // (a same-origin sessionStorage handoff), then screenshot with real content.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click("#btn-send"),
  ]);
  await page.waitForSelector("#btn-download:not([disabled])", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(OUT, "tile-reducer.png"), fullPage: true });
  console.log("saved tile-reducer");

  await browser.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});
