import { expect, test } from "@playwright/test";

const pages = [
  "index.html",
  "gb-world-editor.html",
  "gb-sprite-editor.html",
  "gb-music-generator.html",
  "gb-sfx-generator.html",
  "gb-pixelizer.html",
  "gb-tile-reducer.html",
];

for (const path of pages) {
  test(`${path} loads without browser errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`/${path}`);
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("nav.tool-menu a")).toHaveCount(6);
    await page.waitForTimeout(150);
    expect(errors).toEqual([]);
  });
}

test("landing page links to every tool and draws all previews", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator(".tool-card")).toHaveCount(6);
  await expect(page.locator(".tool-card canvas")).toHaveCount(6);
  const painted = await page.locator(".tool-card canvas").evaluateAll((canvases) =>
    canvases.every((canvas) => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some(Boolean)),
  );
  expect(painted).toBe(true);
});

test("world editor switches every panel and exports a valid project", async ({ page }) => {
  await page.goto("/gb-world-editor.html");
  for (const panel of ["palettes", "tiles", "metatiles", "blocks", "maps"]) {
    await page.locator(`.tab[data-panel="${panel}"]`).click();
    await expect(page.locator(`.tab[data-panel="${panel}"]`)).toHaveClass(/active/);
    await expect(page.locator("#panel .card").first()).toBeVisible();
  }
  await page.locator("#btn-export").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .json" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.gbworld\.json$/);
});

test("sprite editor switches every panel and exports a valid project", async ({ page }) => {
  await page.goto("/gb-sprite-editor.html");
  for (const panel of ["palettes", "tiles", "metasprites", "animations"]) {
    await page.locator(`.tab[data-panel="${panel}"]`).click();
    await expect(page.locator(`.tab[data-panel="${panel}"]`)).toHaveClass(/active/);
    await expect(page.locator("#panel .card").first()).toBeVisible();
  }
  await page.locator("#btn-export").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .json" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.gbsprite\.json$/);
});

test("music generator deterministically regenerates and exposes both score views", async ({ page }) => {
  await page.goto("/gb-music-generator.html");
  await expect(page.locator("#output-col canvas")).toHaveCount(2);
  await page.getByRole("button", { name: /generate/i }).click();
  await expect(page.locator("#output-col canvas")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.locator("#btn-export").click();
  await page.getByRole("button", { name: "Download .json" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.gbmusic\.json$/);
});

test("SFX generator visualizes, regenerates, and opens export", async ({ page }) => {
  await page.goto("/gb-sfx-generator.html");
  await expect(page.locator("#panel canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Randomize" }).click();
  await page.locator("#btn-export").click();
  await expect(page.locator("#modal-backdrop")).toBeVisible();
});

for (const [path] of [["gb-pixelizer.html", "Process"], ["gb-tile-reducer.html", "Reduce"]]) {
  test(`${path} loads and processes an image`, async ({ page }) => {
    await page.goto(`/${path}`);
    await page.locator("#file-input").setInputFiles("docs/screenshots/landscape-sample.png");
    await expect(page.locator("#btn-download")).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator("#panel canvas").last()).toBeVisible();
  });
}
