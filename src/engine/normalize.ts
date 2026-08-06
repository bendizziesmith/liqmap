/** Gamma below 1 lifts the mid-range, which is where the readable structure lives. */
const GAMMA = 0.68;

/**
 * Percentile over the non-zero values only.
 *
 * The grid is mostly empty by construction, so including zeros would put almost any
 * percentile at 0 and blow the colour scale out. Only levels that actually exist should
 * decide what "hot" means.
 */
export function percentileNonZero(values: ArrayLike<number>, p: number): number {
  const nonZero: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) nonZero.push(values[i]);
  }
  if (nonZero.length === 0) return 0;

  nonZero.sort((a, b) => a - b);
  const idx = Math.min(nonZero.length - 1, Math.max(0, Math.ceil(p * nonZero.length) - 1));
  return nonZero[idx];
}

/**
 * The value that maps to full brightness: the 99.7th percentile of what is currently on
 * screen. Recomputed per view so zooming into a quiet region reveals its structure instead
 * of rendering it uniformly black.
 */
export function computeVmax(
  matrices: Float32Array[],
  enabled: boolean[],
  nBuckets: number,
  col0: number,
  col1: number,
  bucket0: number,
  bucket1: number,
): number {
  const samples: number[] = [];

  for (let c = col0; c < col1; c++) {
    const offset = c * nBuckets;
    for (let b = bucket0; b < bucket1; b++) {
      let sum = 0;
      for (let t = 0; t < matrices.length; t++) {
        if (enabled[t]) sum += matrices[t][offset + b];
      }
      if (sum > 0) samples.push(sum);
    }
  }

  const v = percentileNonZero(samples, 0.997);
  // Callers divide by this. An all-empty window must not produce a NaN raster.
  return v > 0 ? v : 1;
}

/** Map a raw score onto `[0, 1]` for the colour ramp. */
export function normalizeScore(score: number, vmax: number): number {
  if (score <= 0 || vmax <= 0) return 0;
  return Math.pow(Math.min(score / vmax, 1), GAMMA);
}
