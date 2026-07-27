import { describe, expect, it } from "vitest";
import {
  collectBlockSamples,
  reduceBox,
  scaleArray,
} from "./pixelizer-downscale.js";

describe("pixelizer downscaling", () => {
  it("uses fractional pixel coverage at non-integer scale ratios", () => {
    const source = Float32Array.from([0, 90, 0]);
    const left = collectBlockSamples(source, null, 3, 1, 0, 0, 2, 1);
    const right = collectBlockSamples(source, null, 3, 1, 1, 0, 2, 1);

    expect(reduceBox(left)).toBeCloseTo(30);
    expect(reduceBox(right)).toBeCloseTo(30);
  });

  it("luminance-aware mode favors the dominant luminance band", () => {
    const source = Float32Array.from([
      220, 220, 220,
      220, 20, 220,
      220, 20, 220,
    ]);
    const box = scaleArray(source, null, 3, 3, 1, 1, {
      algorithm: "box",
      valueRange: 255,
    });
    const aware = scaleArray(source, null, 3, 3, 1, 1, {
      algorithm: "luminance-aware",
      luminanceSensitivity: 28,
      valueRange: 255,
    });

    expect(aware.out[0]).toBeGreaterThan(box.out[0]);
    expect(aware.out[0]).toBeGreaterThan(215);
  });

  it("edge-preserving mode retains a thin high-contrast line", () => {
    const source = new Float32Array(9 * 9).fill(220);
    for (let y = 0; y < 9; y++) source[y * 9 + 4] = 10;

    const box = scaleArray(source, null, 9, 9, 3, 3, {
      algorithm: "box",
      valueRange: 255,
    });
    const edge = scaleArray(source, null, 9, 9, 3, 3, {
      algorithm: "edge-preserving",
      edgeStrength: 50,
      valueRange: 255,
    });

    expect(edge.out[4]).toBeLessThan(box.out[4] - 25);
    expect(edge.out[3]).toBeGreaterThan(210);
    expect(edge.out[5]).toBeGreaterThan(210);
  });

  it("edge-preserving mode stays finite on uniform input", () => {
    const source = new Float32Array(16).fill(123);
    const result = scaleArray(source, null, 4, 4, 2, 2, {
      algorithm: "edge-preserving",
      edgeStrength: 50,
      valueRange: 255,
    });

    expect(Array.from(result.out)).toEqual([123, 123, 123, 123]);
  });

  it("keeps fully transparent blocks transparent", () => {
    const source = new Float32Array(16).fill(80);
    const alpha = new Uint8Array(16).fill(1);
    const result = scaleArray(source, alpha, 4, 4, 2, 2, {
      algorithm: "edge-preserving",
      valueRange: 255,
    });

    expect(Array.from(result.alpha)).toEqual([1, 1, 1, 1]);
  });

  it("keeps every scale algorithm finite after the shared reducer refactor", () => {
    const source = Float32Array.from([0, 32, 96, 160, 224, 255, 80, 200, 20]);
    for (const algorithm of [
      "edge-preserving",
      "luminance-aware",
      "k-centroid",
      "dominant",
      "box",
      "nearest",
    ]) {
      const result = scaleArray(source, null, 3, 3, 2, 2, {
        algorithm,
        valueRange: 255,
      });
      expect(Array.from(result.out).every(Number.isFinite)).toBe(true);
      expect(result.out).toHaveLength(4);
    }
  });
});
