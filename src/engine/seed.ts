import type { Candle, Grid } from './types';

import { priceToBucket, rangeToBuckets } from './grid';
import { ANCHOR_WEIGHTS, CAPITAL_SPLIT, longLiqPrice, shortLiqPrice } from './tiers';
/**
 * Share of a wick-swept level that survives under partial wick clearing.
 *
 * Exchanges liquidate on mark price, not last trade, so a fast wick does not take out every
 * position resting in it; nor does it fill every stop, and traders top up margin as price
 * approaches. Clearing the full candle range treats a three-minute spike exactly like
 * settled trading, which overstates what a spike removes — measured on XRPUSDT 4h, 85% of
 * everything ever cleared out of the [0.98, 1.03] band was removed by wick, two thirds of
 * it by one candle (Jun 25 12:00, open 1.0714, low 1.0111). Bodies still clear fully:
 * price SETTLING through a level is the model's whole premise.
 */
export const WICK_RETENTION = 0.5;


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
 * How one level's notional is spread across neighbouring buckets.
 *
 * Nobody's entry sits on the exact tick the anchor names: a candle's close is one price
 * standing in for every position opened during it, and the leverage ladder is four round
 * numbers standing in for a continuum. Depositing the whole level on a single bucket claims
 * a precision the model does not have, and renders as a one-bucket needle. A small
 * triangular kernel says the same thing more honestly — most of the mass here, some either
 * side — and gives each band a bright core with softer shoulders.
 *
 * Weights sum to 1, so total notional is untouched.
 */
const KERNEL = [0.25, 0.5, 0.25] as const;

/**
 * Add `amount` to the grid around `price`, spread over the kernel.
 *
 * At the grid edges the overhanging share folds into the clamped bucket rather than falling
 * off: the grid is padded by the lowest tier's liquidation distance precisely so nothing is
 * ever out of range, and silently dropping mass would break conservation.
 */
function deposit(tierLevels: Float32Array, grid: Grid, price: number, amount: number): void {
  const centre = priceToBucket(grid, price);
  for (let k = 0; k < KERNEL.length; k++) {
    const b = centre + k - 1;
    const clamped = b < 0 ? 0 : b >= grid.nBuckets ? grid.nBuckets - 1 : b;
    tierLevels[clamped] += amount * KERNEL[k];
  }
}

/**
 * Erase what one candle traded through, at wick strength where only the wick reached.
 *
 * The candle BODY [min(open, close), max(open, close)] clears to zero exactly as
 * `clearRange` does. The wick-only spans multiply by `wickRetention` instead: 0 reproduces
 * full clearing bit-for-bit (v * 0 === 0 for every finite float), and repeated wick sweeps
 * compound, so a level wicked three times at 0.5 keeps an eighth — surviving a spike is
 * evidence, surviving many is a claim that weakens each time.
 */
export function clearCandle(
  levels: Float32Array[],
  grid: Grid,
  candle: Candle,
  wickRetention: number,
): void {
  if (!(wickRetention > 0)) {
    clearRange(levels, grid, candle.low, candle.high);
    return;
  }

  const [lo, hi] = rangeToBuckets(grid, candle.low, candle.high);
  const [bodyLo, bodyHi] = rangeToBuckets(grid, candle.open, candle.close);

  for (const tier of levels) {
    for (let b = lo; b < bodyLo; b++) tier[b] *= wickRetention;
    tier.fill(0, bodyLo, bodyHi + 1);
    for (let b = bodyHi + 1; b <= hi; b++) tier[b] *= wickRetention;
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
  split: readonly number[] = CAPITAL_SPLIT,
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
    const tierNotional = split[t] * notional;

    for (const [entry, anchorShare] of anchors) {
      if (entry <= 0) continue;
      const perSide = (tierNotional * anchorShare) / 2;
      deposit(tierLevels, grid, longLiqPrice(entry, leverage), perSide);
      deposit(tierLevels, grid, shortLiqPrice(entry, leverage), perSide);
    }
  }
}
