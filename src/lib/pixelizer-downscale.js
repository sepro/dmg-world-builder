/*
 * Pure downscaling reducers used by the GB Pixelizer.
 *
 * Source samples carry fractional coverage so adjacent output pixels do not
 * both count an entire source pixel when the scale ratio is non-integer.
 */

function collectBlockSamples(src, srcAlpha, sw, sh, dx, dy, dw, dh) {
  const left = dx * sw / dw;
  const right = (dx + 1) * sw / dw;
  const top = dy * sh / dh;
  const bottom = (dy + 1) * sh / dh;
  const centerX = (left + right) * 0.5;
  const centerY = (top + bottom) * 0.5;
  const samples = [];

  const minX = Math.max(0, Math.floor(left));
  const maxX = Math.min(sw, Math.ceil(right));
  const minY = Math.max(0, Math.floor(top));
  const maxY = Math.min(sh, Math.ceil(bottom));

  for (let y = minY; y < maxY; y++) {
    const overlapY = Math.min(y + 1, bottom) - Math.max(y, top);
    if (overlapY <= 0) continue;
    for (let x = minX; x < maxX; x++) {
      const overlapX = Math.min(x + 1, right) - Math.max(x, left);
      if (overlapX <= 0) continue;
      const index = y * sw + x;
      if (srcAlpha && srcAlpha[index]) continue;
      samples.push({
        value: src[index],
        weight: overlapX * overlapY,
        distance: (x + 0.5 - centerX) ** 2 + (y + 0.5 - centerY) ** 2,
      });
    }
  }
  return samples;
}

function reduceBox(samples) {
  let sum = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    sum += sample.value * sample.weight;
    totalWeight += sample.weight;
  }
  return totalWeight > 0 ? sum / totalWeight : 0;
}

function reduceDominant(samples) {
  const bins = new Map();
  let mean = 0;
  let totalWeight = 0;

  for (const sample of samples) {
    const key = Math.round(sample.value);
    const bin = bins.get(key) || { valueSum: 0, weight: 0 };
    bin.valueSum += sample.value * sample.weight;
    bin.weight += sample.weight;
    bins.set(key, bin);
    mean += sample.value * sample.weight;
    totalWeight += sample.weight;
  }
  mean /= Math.max(totalWeight, Number.EPSILON);

  let best = null;
  for (const bin of bins.values()) {
    const value = bin.valueSum / bin.weight;
    if (
      !best ||
      bin.weight > best.weight + 1e-9 ||
      (Math.abs(bin.weight - best.weight) <= 1e-9 &&
        Math.abs(value - mean) < Math.abs(best.value - mean))
    ) {
      best = { value, weight: bin.weight };
    }
  }
  return best ? best.value : 0;
}

// Weighted 1D k-means; the centroid with the greatest covered source area wins.
function reduceKCentroid(samples, k) {
  let min = Infinity;
  let max = -Infinity;
  for (const sample of samples) {
    min = Math.min(min, sample.value);
    max = Math.max(max, sample.value);
  }
  if (max - min < 1e-6 || samples.length <= k) return reduceDominant(samples);

  const clusterCount = Math.min(k, 4);
  const centroids = [];
  for (let c = 0; c < clusterCount; c++) {
    centroids.push(min + (max - min) * (c + 0.5) / clusterCount);
  }

  const assignments = new Uint8Array(samples.length);
  assignments.fill(255);
  for (let iteration = 0; iteration < 8; iteration++) {
    let moved = false;
    const sums = new Float64Array(clusterCount);
    const weights = new Float64Array(clusterCount);

    for (let i = 0; i < samples.length; i++) {
      let closest = 0;
      let closestDistance = Infinity;
      for (let c = 0; c < clusterCount; c++) {
        const distance = Math.abs(samples[i].value - centroids[c]);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = c;
        }
      }
      if (assignments[i] !== closest) {
        assignments[i] = closest;
        moved = true;
      }
      sums[closest] += samples[i].value * samples[i].weight;
      weights[closest] += samples[i].weight;
    }

    for (let c = 0; c < clusterCount; c++) {
      if (weights[c] > 0) centroids[c] = sums[c] / weights[c];
    }
    if (!moved) break;
  }

  const weights = new Float64Array(clusterCount);
  for (let i = 0; i < samples.length; i++) {
    weights[assignments[i]] += samples[i].weight;
  }
  let biggest = 0;
  for (let c = 1; c < clusterCount; c++) {
    if (weights[c] > weights[biggest]) biggest = c;
  }
  return centroids[biggest];
}

function reduceNearest(samples) {
  let closest = samples[0];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].distance < closest.distance) closest = samples[i];
  }
  return closest.value;
}

/*
 * Dominant-luminance weighting from the proof-of-concept, made stable for
 * both 0..255 luminance and 0..3 shade-space input. A dominant histogram band
 * supplies the reference; samples farther from it contribute exponentially
 * less. Ties prefer the band nearest the block mean instead of an arbitrary
 * dark/light bias.
 */
function reduceLuminanceAware(samples, sensitivity, valueRange) {
  const binCount = valueRange <= 3 ? 4 : 16;
  const bins = Array.from({ length: binCount }, () => ({
    weight: 0,
    valueSum: 0,
  }));
  const mean = reduceBox(samples);

  for (const sample of samples) {
    const normalized = Math.max(0, Math.min(1, sample.value / valueRange));
    const index = Math.min(binCount - 1, Math.floor(normalized * binCount));
    bins[index].weight += sample.weight;
    bins[index].valueSum += sample.value * sample.weight;
  }

  let dominant = null;
  for (const bin of bins) {
    if (bin.weight <= 0) continue;
    const value = bin.valueSum / bin.weight;
    if (
      !dominant ||
      bin.weight > dominant.weight + 1e-9 ||
      (Math.abs(bin.weight - dominant.weight) <= 1e-9 &&
        Math.abs(value - mean) < Math.abs(dominant.value - mean))
    ) {
      dominant = { weight: bin.weight, value };
    }
  }
  if (!dominant) return mean;

  const safeSensitivity = Math.max(1, sensitivity);
  let weightedValue = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    const normalizedDifference =
      Math.abs(sample.value - dominant.value) * 255 / Math.max(valueRange, 1e-6);
    const weight = sample.weight * Math.exp(-normalizedDifference / safeSensitivity);
    weightedValue += sample.value * weight;
    totalWeight += weight;
  }
  return totalWeight > 1e-12 ? weightedValue / totalWeight : dominant.value;
}

function boxGuidance(src, srcAlpha, sw, sh, dw, dh) {
  const values = new Float32Array(dw * dh);
  const alpha = new Uint8Array(dw * dh);

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const index = dy * dw + dx;
      const samples = collectBlockSamples(src, srcAlpha, sw, sh, dx, dy, dw, dh);
      if (samples.length === 0) {
        alpha[index] = 1;
      } else {
        values[index] = reduceBox(samples);
      }
    }
  }
  return { values, alpha };
}

// Paper's 3×3 [1 2 1; 2 4 2; 1 2 1] guide blur, renormalized at edges/alpha.
function smoothGuidance(values, alpha, w, h) {
  const result = new Float32Array(values.length);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = y * w + x;
      if (alpha[index]) continue;
      let sum = 0;
      let totalWeight = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const sy = y + ky;
        if (sy < 0 || sy >= h) continue;
        for (let kx = -1; kx <= 1; kx++) {
          const sx = x + kx;
          if (sx < 0 || sx >= w) continue;
          const sourceIndex = sy * w + sx;
          if (alpha[sourceIndex]) continue;
          const weight = kernel[(ky + 1) * 3 + kx + 1];
          sum += values[sourceIndex] * weight;
          totalWeight += weight;
        }
      }
      result[index] = totalWeight > 0 ? sum / totalWeight : values[index];
    }
  }
  return result;
}

/*
 * Detail-Preserving Image Downscaling (DPID): samples that differ from the
 * smoothed local guide receive more weight. strength=0 is a box filter;
 * strength=50 maps to the paper's conservative λ=0.5 setting, which preserves
 * thin lines with less edge fattening than λ=1.
 */
function reduceEdgePreserving(samples, guideValue, strength, valueRange) {
  const lambda = Math.max(0, Math.min(100, strength)) / 100;
  if (lambda === 0) return reduceBox(samples);

  let weightedValue = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    const distinctness =
      Math.abs(sample.value - guideValue) / Math.max(valueRange, 1e-6);
    const weight = sample.weight * Math.pow(distinctness, lambda);
    weightedValue += sample.value * weight;
    totalWeight += weight;
  }
  return totalWeight > 1e-12 ? weightedValue / totalWeight : reduceBox(samples);
}

/*
 * Returns { out, alpha }. `valueRange` is 3 for pre-quantized shades and 255
 * for tone-mapped luminance.
 */
function scaleArray(
  src,
  srcAlpha,
  sw,
  sh,
  dw,
  dh,
  {
    algorithm = "k-centroid",
    kClusters = 3,
    edgeStrength = 50,
    luminanceSensitivity = 28,
    valueRange = 255,
  } = {},
) {
  const out = new Float32Array(dw * dh);
  const alpha = new Uint8Array(dw * dh);
  let guide = null;

  if (algorithm === "edge-preserving") {
    const initial = boxGuidance(src, srcAlpha, sw, sh, dw, dh);
    guide = smoothGuidance(initial.values, initial.alpha, dw, dh);
  }

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const index = dy * dw + dx;
      const samples = collectBlockSamples(src, srcAlpha, sw, sh, dx, dy, dw, dh);
      if (samples.length === 0) {
        alpha[index] = 1;
        continue;
      }

      if (algorithm === "edge-preserving") {
        out[index] = reduceEdgePreserving(
          samples,
          guide[index],
          edgeStrength,
          valueRange,
        );
      } else if (algorithm === "luminance-aware") {
        out[index] = reduceLuminanceAware(
          samples,
          luminanceSensitivity,
          valueRange,
        );
      } else if (algorithm === "k-centroid") {
        out[index] = reduceKCentroid(samples, kClusters);
      } else if (algorithm === "dominant") {
        out[index] = reduceDominant(samples);
      } else if (algorithm === "nearest") {
        out[index] = reduceNearest(samples);
      } else {
        out[index] = reduceBox(samples);
      }
    }
  }
  return { out, alpha };
}

export {
  collectBlockSamples,
  reduceBox,
  reduceDominant,
  reduceKCentroid,
  reduceLuminanceAware,
  reduceEdgePreserving,
  scaleArray,
};
