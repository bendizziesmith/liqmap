import type { Candle, Grid } from './types';
import { priceToBucket, rangeToBuckets } from './grid';
import { ANCHOR_WEIGHTS, CAPITAL_SPLIT, longLiqPrice, shortLiqPrice } from './tiers';

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

/**
 * Deposit the estimated USD notional implied by one candle.
 *
 * The candle's turnover is quote-currency volume — the dollars that actually changed hands —
 * so bucket values come out as estimated USD at risk rather than an arbitrary score. That
 * notional is split three ways by entry anchor, four ways by leverage tier, and finally in
 * half between the long and short side: the trades that made up the turnover opened both,
 * and depositing the full amount on each side would count the same dollars twice.
 *
 * With no clearing, the sum of every bucket equals `turnover × oiFactor`.
 */
export function seedCandle(
  levels: Float32Array[],
  grid: Grid,
  tiers: number[],
  candle: Candle,
  oiFactor: number,
): void {
  const notional = candle.turnover * oiFactor;
  if (!(notional > 0)) return;

  const anchors: Array<[number, number]> = [
    [candle.close, ANCHOR_WEIGHTS.close],
    [candle.high, ANCHOR_WEIGHTS.high],
    [candle.low, ANCHOR_WEIGHTS.low],
  ];

  for (let t = 0; t < tiers.length; t++) {
    const leverage = tiers[t];
    const tierLevels = levels[t];
    const tierNotional = CAPITAL_SPLIT[t] * notional;

    for (const [entry, anchorShare] of anchors) {
      if (entry <= 0) continue;
      const perSide = (tierNotional * anchorShare) / 2;
      tierLevels[priceToBucket(grid, longLiqPrice(entry, leverage))] += perSide;
      tierLevels[priceToBucket(grid, shortLiqPrice(entry, leverage))] += perSide;
    }
  }
}
