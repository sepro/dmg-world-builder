"""Generate the royalty-free sample landscape used in the pixelizer/reducer
screenshots. Output is deterministic (fixed seed), so the committed
docs/screenshots/landscape-sample.png can always be reproduced.

    python3 tools/screenshots/make_landscape.py

Needs numpy + Pillow (pip install numpy pillow).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

W, H = 900, 560
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "docs",
                   "screenshots", "landscape-sample.png")


def lerp(a, b, t):
    return a + (b - a) * t


def build():
    img = np.zeros((H, W, 3), np.float32)

    # Sky: vertical gradient from a pale high sky to a warm horizon haze.
    top = np.array([181, 205, 228])
    horizon = np.array([245, 225, 190])
    for y in range(H):
        t = min(y / (H * 0.62), 1.0)
        img[y, :, :] = lerp(top, horizon, t ** 1.4)

    # Sun with a soft glow, sitting low over the horizon.
    sun_x, sun_y, sun_r = int(W * 0.68), int(H * 0.40), 34
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.sqrt((xx - sun_x) ** 2 + (yy - sun_y) ** 2)
    glow = np.clip(1.0 - dist / 240.0, 0, 1) ** 2.2
    img += glow[..., None] * np.array([60, 45, 20])
    disc = np.clip((sun_r - dist) / 6.0, 0, 1)
    img = img * (1 - disc[..., None]) + disc[..., None] * np.array([255, 250, 235])

    horizon_y = int(H * 0.60)

    def ridge(base_y, amp, rough, colr, seed):
        """Fill one mountain silhouette from a 1-D fractal profile."""
        r = np.random.default_rng(seed)
        prof = np.zeros(W)
        for octave, scale in enumerate([1, 2, 4, 8, 16]):
            pts = r.standard_normal(scale + 1)
            xs = np.linspace(0, W - 1, scale + 1)
            prof += np.interp(np.arange(W), xs, pts) * (rough ** octave)
        prof = prof / np.max(np.abs(prof))
        line = base_y - (prof * amp).astype(int)
        for x in range(W):
            img[line[x]:, x, :] = colr

    # Distant ranges are lighter (atmospheric haze); nearer ones darker.
    ridge(horizon_y - 10, 46, 0.55, np.array([150, 168, 185]), 11)
    ridge(horizon_y + 4, 62, 0.6, np.array([110, 132, 150]), 22)
    ridge(horizon_y + 22, 80, 0.62, np.array([74, 96, 110]), 33)

    # Lake: mirror the scene above the shoreline, tint it cooler, add ripples.
    lake_top = horizon_y + 22
    reflection = img[:lake_top][::-1]
    lake_h = H - lake_top
    refl = reflection[:lake_h].copy()
    refl = refl * 0.82 + np.array([20, 35, 55]) * 0.18
    band = (np.sin(np.arange(lake_h) / 3.0) * 6)[:, None, None]
    img[lake_top:lake_top + lake_h] = np.clip(refl + band, 0, 255)

    # Foreground shoreline shadow for a little depth.
    for y in range(H - 40, H):
        t = (y - (H - 40)) / 40.0
        img[y] = img[y] * (1 - 0.35 * t)

    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    out = out.filter(ImageFilter.GaussianBlur(0.6))  # soften seams
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT)
    print("saved", os.path.normpath(OUT), out.size)


if __name__ == "__main__":
    build()
