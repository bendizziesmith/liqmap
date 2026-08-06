import type { Grid, HeatmapData } from './types';
import { N_BUCKETS } from './grid';

/** Default display resolution. 1100 raw buckets is finer than any screen needs. */
export const DEFAULT_BINS = 200;

export interface ProfileBin {
  priceFrom: number;
  priceTo: number;
  priceMid: number;
  /** Score per leverage tier, same order as `LiquidationProfile.tiers`. */
  tiers: number[];
  /** Sum of `tiers` — the stacked bar height. */
  total: number;
  /** Running sum from current price downward. Zero at or above the price bin. */
  cumLong: number;
  /** Running sum from current price upward. Zero at or below the price bin. */
  cumShort: number;
}

export interface LiquidationProfile {
  bins: ProfileBin[];
  currentPrice: number;
  /** Index of the bin containing `currentPrice`. Long side is below, short side above. */
  priceBinIndex: number;
  maxTotal: number;
  /** Largest cumulative across *both* directions, so the two sides share one axis. */
  maxCum: number;
  /** Leverage labels, e.g. [3, 5, 10, 25]. */
  tiers: number[];
}

export interface ProfileOptions {
  bins?: number;
  tierLabels?: number[];
}

/**
 * The active liquidation levels as of the most recent candle.
 *
 * This is the whole point of the Liquidation Map: the heatmap's final column already *is*
 * the set of levels still pending after the last clearing pass, so the profile reads it
 * rather than recomputing anything.
 */
export function lastColumn(map: HeatmapData): Float32Array[] {
  const { nBuckets } = map.grid;
  if (map.nCols === 0) {
    return map.matrices.map(() => new Float32Array(nBuckets));
  }

  const offset = (map.nCols - 1) * nBuckets;
  return map.matrices.map((m) => m.slice(offset, offset + nBuckets));
}

/**
 * Reshape active levels into a binned, tier-stacked profile with cumulative curves.
 *
 * Cumulative series run *outward* from the current price and never cross it: below price
 * the pending levels are long liquidations, above they are shorts, and summing across the
 * divide would add two unrelated quantities together.
 */
export function liquidationProfile(
  activeTiers: Float32Array[],
  grid: Grid,
  currentPrice: number,
  opts: ProfileOptions = {},
): LiquidationProfile {
  const nBins = Math.max(1, Math.floor(opts.bins ?? DEFAULT_BINS));
  const nTiers = activeTiers.length;
  const nBuckets = grid.nBuckets || N_BUCKETS;
  const binWidth = (grid.max - grid.min) / nBins;

  const bins: ProfileBin[] = [];
  for (let i = 0; i < nBins; i++) {
    const priceFrom = grid.min + i * binWidth;
    const priceTo = i === nBins - 1 ? grid.max : grid.min + (i + 1) * binWidth;
    bins.push({
      priceFrom,
      priceTo,
      priceMid: (priceFrom + priceTo) / 2,
      tiers: new Array<number>(nTiers).fill(0),
      total: 0,
      cumLong: 0,
      cumShort: 0,
    });
  }

  // Fold buckets into bins by index, so every bucket lands in exactly one bin and no mass
  // is lost or double counted regardless of how the two resolutions divide.
  for (let t = 0; t < nTiers; t++) {
    const src = activeTiers[t];
    for (let b = 0; b < nBuckets; b++) {
      const v = src[b];
      if (v === 0) continue;
      const bin = bins[Math.min(nBins - 1, Math.floor((b * nBins) / nBuckets))];
      bin.tiers[t] += v;
      bin.total += v;
    }
  }

  const priceBinIndex = Math.min(
    nBins - 1,
    Math.max(0, Math.floor(((currentPrice - grid.min) / (grid.max - grid.min)) * nBins)),
  );

  let running = 0;
  for (let i = priceBinIndex - 1; i >= 0; i--) {
    running += bins[i].total;
    bins[i].cumLong = running;
  }

  running = 0;
  for (let i = priceBinIndex + 1; i < nBins; i++) {
    running += bins[i].total;
    bins[i].cumShort = running;
  }

  let maxTotal = 0;
  let maxCum = 0;
  for (const b of bins) {
    if (b.total > maxTotal) maxTotal = b.total;
    if (b.cumLong > maxCum) maxCum = b.cumLong;
    if (b.cumShort > maxCum) maxCum = b.cumShort;
  }

  return {
    bins,
    currentPrice,
    priceBinIndex,
    maxTotal,
    maxCum,
    tiers: opts.tierLabels ?? activeTiers.map((_, i) => i + 1),
  };
}
