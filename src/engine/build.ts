import type { Candle, HeatmapData, Interval, OiPoint } from './types';
import { buildGrid, N_BUCKETS } from './grid';
import { modeForInterval, tiersForMode } from './tiers';
import { oiFactors } from './oi';
import { clearRange, seedCandle } from './seed';

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Read one cell out of a tier matrix. */
export function valueAt(map: HeatmapData, tier: number, col: number, bucket: number): number {
  return map.matrices[tier][col * map.grid.nBuckets + bucket];
}

/**
 * Walk the candles oldest-first, maintaining a live vector of pending liquidation levels
 * per tier, and photograph that vector into a column after each candle.
 *
 * The per-candle order is deliberate and load-bearing:
 *   1. clear  — price traded through [low, high], so anything resting there is gone
 *   2. seed   — this candle's own entries create new pending levels
 *   3. snapshot — the column records what is still pending as of this candle
 *
 * `candles` must be oldest-first; the Bybit client reverses the API's newest-first list.
 */
export function buildHeatmap(
  candles: Candle[],
  oi: OiPoint[],
  interval: Interval,
): HeatmapData {
  const mode = modeForInterval(interval);
  const tiers = tiersForMode(mode);
  const minTier = Math.min(...tiers);
  const grid = buildGrid(candles, minTier);
  const nCols = candles.length;

  const matrices = tiers.map(() => new Float32Array(nCols * N_BUCKETS));
  if (nCols === 0) {
    return { grid, mode, tiers, matrices, nCols, candles };
  }

  // The live vector: one Float32Array per tier, mutated in place across the whole walk.
  const levels = tiers.map(() => new Float32Array(N_BUCKETS));
  const medianTurnover = medianOf(candles.map((c) => c.turnover));
  const factors = oiFactors(candles, oi);

  for (let i = 0; i < nCols; i++) {
    const candle = candles[i];

    clearRange(levels, grid, candle.low, candle.high);
    seedCandle(levels, grid, tiers, candle, medianTurnover, factors[i]);

    const offset = i * N_BUCKETS;
    for (let t = 0; t < tiers.length; t++) {
      matrices[t].set(levels[t], offset);
    }
  }

  return { grid, mode, tiers, matrices, nCols, candles };
}
