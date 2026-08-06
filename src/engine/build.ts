import type { Candle, HeatmapData, Interval, OiPoint } from './types';
import { buildGrid, N_BUCKETS } from './grid';
import { modeForInterval, tiersForMode } from './tiers';
import { oiFactors } from './oi';
import { clearRange, seedCandle } from './seed';

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
  const emptyBaseline = () => tiers.map(() => new Float32Array(N_BUCKETS));

  if (nCols === 0) {
    return {
      grid,
      mode,
      tiers,
      matrices,
      nCols,
      candles,
      baseline: emptyBaseline(),
      lastOiFactor: 1,
    };
  }

  // The live vector: one Float32Array per tier, mutated in place across the whole walk.
  const levels = tiers.map(() => new Float32Array(N_BUCKETS));
  const factors = oiFactors(candles, oi);

  // State as of the second-to-last candle. A forming candle can be re-seeded from this in
  // O(nBuckets) instead of rebuilding every column and re-allocating the whole matrix set.
  let baseline = emptyBaseline();

  for (let i = 0; i < nCols; i++) {
    const candle = candles[i];

    if (i === nCols - 1) {
      baseline = levels.map((l) => l.slice());
    }

    clearRange(levels, grid, candle.low, candle.high);
    seedCandle(levels, grid, tiers, candle, factors[i]);

    const offset = i * N_BUCKETS;
    for (let t = 0; t < tiers.length; t++) {
      matrices[t].set(levels[t], offset);
    }
  }

  return {
    grid,
    mode,
    tiers,
    matrices,
    nCols,
    candles,
    baseline,
    lastOiFactor: factors[nCols - 1],
  };
}

/**
 * Recompute only the final column, for a candle that is still forming.
 *
 * A websocket kline tick changes exactly one candle, so rebuilding all thousand columns —
 * and re-allocating ~18 MB of Float32Array — once a second would be waste. Replaying
 * clear+seed from the stored baseline touches a single column instead.
 *
 * The grid is deliberately not re-derived: a forming candle that breaks the existing price
 * range would require every column rebucketed, which is a full rebuild's job. Callers
 * refetch when a candle confirms.
 */
export function reseedLast(map: HeatmapData, candle: Candle): HeatmapData {
  if (map.nCols === 0) return map;

  const levels = map.baseline.map((l) => l.slice());
  clearRange(levels, map.grid, candle.low, candle.high);
  seedCandle(levels, map.grid, map.tiers, candle, map.lastOiFactor);

  // Written in place. Copying the matrices would allocate ~18 MB per websocket tick, which
  // at one tick a second is enough to OOM the renderer. Only the final column changes, and
  // it is fully recomputed from `baseline` each time, so this stays idempotent under
  // StrictMode's double-invoke. The returned wrapper is a new object so React re-renders.
  const offset = (map.nCols - 1) * map.grid.nBuckets;
  for (let t = 0; t < map.matrices.length; t++) {
    map.matrices[t].set(levels[t], offset);
  }

  const candles = map.candles.slice();
  candles[map.nCols - 1] = candle;

  return { ...map, candles };
}
