import type { Candle, Grid } from './types';
import { priceToBucket, rangeToBuckets } from './grid';
import { ANCHOR_WEIGHTS, CAPITAL_SPLIT, longLiqPrice, shortLiqPrice } from './tiers';

/** A single candle can only count for so much, however violent. */
const TURNOVER_CLAMP = 5;

/**
 * Erase every level the candle traded through.
 *
 * This is the rule that makes the whole chart honest: if price passed through a level, the
 * positions resting there are already liquidated, so the level cannot still be pending.
 * Without it the map accumulates forever and every column looks the same.
 */
export function clearRange(levels: Float32Array[], grid: Grid, low: number, high: number): void {
  const [lo, hi] = rangeToBuckets(grid, low, high);
  for (const tier of levels) {
    tier.fill(0, lo, hi + 1);
  }
}

/** Turnover relative to the median candle, clamped so one outlier cannot dominate. */
export function turnoverWeight(turnover: number, medianTurnover: number): number {
  if (medianTurnover <= 0) return 1;
  return Math.min(turnover / medianTurnover, TURNOVER_CLAMP);
}

/**
 * Deposit the liquidation levels implied by one candle.
 *
 * Three entry anchors × two sides × four tiers = 24 deposits, each sized by the candle's
 * turnover weight, its open-interest factor, the anchor's share, and the tier's share of
 * capital. Both sides receive the full tier amount — the book is assumed symmetric, and the
 * resulting global factor of two is irrelevant to a relative colour scale.
 */
export function seedCandle(
  levels: Float32Array[],
  grid: Grid,
  tiers: number[],
  candle: Candle,
  medianTurnover: number,
  oiFactor: number,
): void {
  const weight = turnoverWeight(candle.turnover, medianTurnover) * oiFactor;
  if (weight <= 0) return;

  const anchors: Array<[number, number]> = [
    [candle.close, ANCHOR_WEIGHTS.close],
    [candle.high, ANCHOR_WEIGHTS.high],
    [candle.low, ANCHOR_WEIGHTS.low],
  ];

  for (let t = 0; t < tiers.length; t++) {
    const leverage = tiers[t];
    const tierLevels = levels[t];
    const tierShare = CAPITAL_SPLIT[t] * weight;

    for (const [entry, anchorShare] of anchors) {
      if (entry <= 0) continue;
      const amount = tierShare * anchorShare;
      tierLevels[priceToBucket(grid, longLiqPrice(entry, leverage))] += amount;
      tierLevels[priceToBucket(grid, shortLiqPrice(entry, leverage))] += amount;
    }
  }
}
