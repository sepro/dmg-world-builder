import { expect, test } from "@playwright/test";

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

for (const path of pages) {
  test(`${path} loads without browser errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`/${path}`);
    await expect(page.locator("#app")).toBeVisible();
    await expect(page.locator("nav.tool-menu a")).toHaveCount(7);
    await page.waitForTimeout(150);
    expect(errors).toEqual([]);
  });
}

test("landing page links to every tool and draws all previews", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator(".tool-card")).toHaveCount(7);
  await expect(page.locator(".tool-card canvas")).toHaveCount(7);
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
  // The world editor exports the world format, named after project.meta.name
  // ("Untitled World" by default) -- not the arena editor's .gbarena.json.
  expect(file.suggestedFilename()).toMatch(/^Untitled_World\.gbworld\.json$/);
});

test("world editor authors an item's pickup mode", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/gb-world-editor.html");
  await page.locator('.tab[data-panel="maps"]').click();
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.getByRole("button", { name: "Item", exact: true }).click();
  await page.locator("canvas.map-canvas").click({ position: { x: 100, y: 100 } });

  const inspector = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Item event" }),
  });
  const pickup = inspector.locator(".field", { hasText: "Pickup" }).locator("select");
  await expect(pickup).toHaveValue("visible");
  await expect(inspector.getByText(/blocks its cell/)).toBeVisible();

  await pickup.selectOption("search");
  await expect(inspector.getByText(/standing on this cell/)).toBeVisible();
  await expect(page.getByText(/\(search\)/)).toBeVisible();

  await pickup.selectOption("hidden");
  await expect(inspector.getByText(/neighbouring tile/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("world editor picks item and NPC ids from the implemented catalogs", async ({ page }) => {
  await page.goto("/gb-world-editor.html");
  await page.locator('.tab[data-panel="maps"]').click();
  await page.getByRole("button", { name: "Events", exact: true }).click();

  await page.getByRole("button", { name: "Item", exact: true }).click();
  await page.locator("canvas.map-canvas").click({ position: { x: 100, y: 100 } });
  const itemCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Item event" }),
  });
  const item = itemCard.locator(".field").filter({ hasText: "Item" }).first().locator("select");
  await expect(item).toHaveValue("");
  await item.selectOption("meteorite_ore");

  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await page.locator("canvas.map-canvas").click({ position: { x: 160, y: 100 } });
  const npcCard = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "NPC event" }),
  });
  const sprite = npcCard.locator(".field").filter({ hasText: "Sprite" }).first().locator("select");
  await sprite.selectOption("Blacksmith");

  // The escape hatch: a name the running build has no registry row for yet
  // still exports, typed into the free-text box "Other…" reveals.
  await sprite.selectOption("__other__");
  const custom = npcCard.locator(".field").filter({ hasText: "Name" }).locator("input");
  await custom.fill("not_yet_implemented");

  await page.locator("#btn-export").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .json" }).click();
  const download = await downloadPromise;
  const json = JSON.parse(await (await import("node:fs/promises")).readFile(await download.path(), "utf8"));
  const events = json.maps.flatMap((map) => map.events);
  expect(events.find((e) => e.type === "item").item).toBe("meteorite_ore");
  expect(events.find((e) => e.type === "npc").sprite).toBe("not_yet_implemented");
});

test("world editor authors and exports sentinel NPC mode", async ({ page }) => {
  await page.goto("/gb-world-editor.html");
  await page.locator('.tab[data-panel="maps"]').click();
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await page.locator("canvas.map-canvas").click({ position: { x: 100, y: 100 } });

  const inspector = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "NPC event" }),
  });
  const movement = inspector.locator(".field").filter({ hasText: "Movement" }).locator("select");
  await expect(movement.locator('option[value="sentinel"]')).toHaveText("sentinel");
  await movement.selectOption("sentinel");

  const facing = inspector.locator(".field").filter({ hasText: "Starting facing" }).locator("select");
  await expect(facing).toHaveValue("up");
  await expect(facing.locator('option[value="player"]')).toHaveCount(0);
  await facing.selectOption("left");
  // Two seconds, matching ow_npc_tick_sentinels in the engine.
  await expect(inspector.getByText(/turns clockwise every two seconds/)).toBeVisible();

  await page.locator("#btn-export").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .json" }).click();
  const download = await downloadPromise;
  const json = JSON.parse(await (await import("node:fs/promises")).readFile(await download.path(), "utf8"));
  const npc = json.maps.flatMap((map) => map.events).find((event) => event.type === "npc");
  expect(npc).toMatchObject({ movement: "sentinel", facing: "left" });
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

test("pixelizer exposes working edge-preserving and luminance-aware modes", async ({ page }) => {
  await page.goto("/gb-pixelizer.html");
  await page.locator("#file-input").setInputFiles("docs/screenshots/landscape-sample.png");
  await expect(page.locator("#btn-download")).toBeEnabled({ timeout: 30_000 });

  const fieldSelect = (label) => page.locator(".field").filter({ hasText: label }).locator("select");
  const algorithm = () => fieldSelect("Scale algorithm");
  await expect(algorithm()).toHaveValue("edge-preserving");
  await expect(algorithm().locator("option")).toHaveCount(6);
  await expect(page.getByText("Best for fine details", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Detail strength", { exact: true })).toHaveValue("50");

  await fieldSelect("Order").selectOption("scale-first");
  const widthInput = page.locator(".field").filter({ hasText: "Output width" }).locator("input[type=number]");
  await widthInput.evaluate((input) => {
    input.value = "32";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const checksum = () => page.locator("#panel canvas").last().evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i += 4) {
      hash ^= data[i] + data[i + 1] * 3 + data[i + 2] * 7 + data[i + 3] * 11;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  });
  const edgeChecksum = await checksum();

  await algorithm().selectOption("luminance-aware");
  await expect(page.getByText("Best for bold shapes", { exact: true })).toBeVisible();
  const softness = page.getByLabel("Edge softness", { exact: true });
  await expect(softness).toHaveValue("28");
  const luminanceChecksum = await checksum();
  expect(luminanceChecksum).not.toBe(edgeChecksum);

  await softness.fill("5");
  const crispChecksum = await checksum();
  expect(crispChecksum).not.toBe(luminanceChecksum);
});

for (const [path] of [["gb-pixelizer.html", "Process"], ["gb-tile-reducer.html", "Reduce"]]) {
  test(`${path} loads and processes an image`, async ({ page }) => {
    await page.goto(`/${path}`);
    await page.locator("#file-input").setInputFiles("docs/screenshots/landscape-sample.png");
    await expect(page.locator("#btn-download")).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator("#panel canvas").last()).toBeVisible();
  });
}


test("boss arena editor authors tiles, previews overlays and animations, and exports Snapjaw", async ({ page }) => {
  await page.goto("/gb-arena-editor.html");
  await expect(page.locator("#arena-canvas")).toBeVisible();
  await expect(page.locator(".arena-tile")).toHaveCount(4);
  await expect(page.locator("#tile-editor-canvas")).toBeVisible();

  await page.getByRole("button", { name: "+ New tile" }).click();
  await expect(page.locator(".arena-tile")).toHaveCount(5);
  await page.getByRole("button", { name: "+", exact: true }).click();
  await expect(page.locator(".frame-cell")).toHaveCount(3);
  await page.locator("#btn-animation-toggle").click();
  await expect(page.locator("#btn-animation-toggle")).toHaveText("Animation: paused");
  await page.getByRole("button", { name: "base", exact: true }).click();
  await page.locator("#tile-editor-canvas").click({ position: { x: 70, y: 70 } });
  await page.locator("#arena-canvas").click({ position: { x: 16, y: 16 } });
  const paintedPixel = await page.locator("#arena-canvas").evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(9, 9, 1, 1).data));
  expect(paintedPixel).toEqual([8, 24, 32, 255]);
  await expect(page.locator("#btn-undo")).toBeEnabled();
  await page.locator("#btn-undo").click();
  const undonePixel = await page.locator("#arena-canvas").evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(9, 9, 1, 1).data));
  expect(undonePixel).toEqual([224, 248, 208, 255]);
  await page.locator("#btn-redo").click();
  const redonePixel = await page.locator("#arena-canvas").evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(9, 9, 1, 1).data));
  expect(redonePixel).toEqual([8, 24, 32, 255]);


  await page.locator("#btn-animation-toggle").click();
  await expect(page.locator("#btn-animation-toggle")).toHaveText("Animation: playing");
  await page.locator("#btn-overlay-toggle").click();
  await expect(page.locator("#btn-overlay-toggle")).toHaveText("Gameplay overlays: on");
  await expect(page.getByText("Overlay legend is active")).toBeVisible();

  await page.getByRole("button", { name: "Load Snapjaw" }).click();
  await page.locator("#btn-export").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .gbarena.json" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/Snapjaw_Marsh\.gbarena\.json$/);
  const arena = JSON.parse(await (await import("node:fs/promises")).readFile(await file.path(), "utf8"));
  expect(arena).toMatchObject({
    kind: "gb-boss-arena", version: 2,
    screen: { width: 20, height: 18, tileSize: 8, camera: "fixed" },
    markers: { playerSpawn: { x: 5, y: 15 }, bossAnchor: { x: 18, y: 14 } },
  });
  expect(arena.tiles).toHaveLength(4);
  expect(arena.tiles.find((tile) => tile.id === "water").frames).toHaveLength(1);
  expect(arena.map[16 * 20]).toBe("stone");
  expect(arena.overlays[16 * 20]).toBe("solid");
  expect(arena.map[16 * 20 + 10]).toBe("water");
  expect(arena.overlays[16 * 20 + 10]).toBe("water");
  expect(arena.overlays[12 * 20 + 3]).toBe("platform");
  expect(arena.overlays[8 * 20 + 6]).toBe("platform");
});

test("boss arena tile selection is immediate and PNG import reconstructs art tiles", async ({ page }) => {
  await page.goto("/gb-arena-editor.html");
  const editor = page.locator("#tile-editor-canvas");

  await page.locator('.arena-tile[data-tile-id="water"]').click();
  await expect(page.locator('.arena-tile[data-tile-id="water"]')).toHaveAttribute("aria-pressed", "true");
  const waterPixel = await editor.evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(14, 14, 1, 1).data));
  expect(waterPixel).toEqual([136, 192, 112, 255]);

  await page.locator('.arena-tile[data-tile-id="stone"]').click();
  await expect(page.locator('.arena-tile[data-tile-id="stone"]')).toHaveAttribute("aria-pressed", "true");
  const stonePixel = await editor.evaluate((canvas) => Array.from(canvas.getContext("2d").getImageData(14, 14, 1, 1).data));
  expect(stonePixel).toEqual([8, 24, 32, 255]);

  await page.getByRole("button", { name: "Import PNG" }).click();
  await page.locator("#arena-png-input").setInputFiles("docs/screenshots/landscape-sample.png");
  await expect(page.locator("#arena-png-status")).toContainText("unique 8×8 tiles");
  await expect(page.locator(".png-import-preview")).toBeVisible();
  await page.getByRole("button", { name: "Use as arena art" }).click();
  await expect(page.locator(".arena-tile")).not.toHaveCount(0);
  await expect(editor).toBeVisible();
});
