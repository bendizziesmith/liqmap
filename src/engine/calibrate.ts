/**
 * Denominating the display in open interest.
 *
 * The engine seeds each candle's turnover onto the levels it implies, so a bucket's raw
 * value is cumulative notional that *flowed* through that price over the whole window —
 * months of it. Summed, that reaches billions, which is an order of magnitude more than
 * could ever actually liquidate.
 *
 * Liquidations can only come from positions that are currently open, so the correct anchor
 * is open interest. Nothing in the engine changes, and neither does any rendering
 * normalisation — the colour classes, bar lengths and percentile scales all work on the raw
 * values and are unaffected by a uniform factor.
 *
 * Each side is anchored separately. Open interest counts contracts, and every contract has
 * a long holder and a short holder, so $225M of OI means $225M of longs standing *and*
 * $225M of shorts. Scaling both sides together against a single OI figure halves them.
 */

export interface UsdScales {
  /** Applies to levels below current price, which would liquidate longs. */
  long: number;
  /** Applies to levels above current price, which would liquidate shorts. */
  short: number;
}

export interface SideTotals {
  long: number;
  short: number;
}

/** Total of the active (last-column) levels across every tier. */
export function sumActive(activeTiers: Float32Array[]): number {
  let total = 0;
  for (const tier of activeTiers) {
    for (let i = 0; i < tier.length; i++) {
      const v = tier[i];
      if (v > 0) total += v;
    }
  }
  return total;
}

/**
 * Multiplier that maps the active book onto the reported open-interest value.
 *
 * Returns 1 when either input is unusable: showing uncalibrated relative figures is far
 * better than collapsing every number on screen to zero because one request failed.
 */
export function calibrationScale(openInterestValue: number, activeTotal: number): number {
  if (!Number.isFinite(openInterestValue) || openInterestValue <= 0) return 1;
  if (!Number.isFinite(activeTotal) || activeTotal <= 0) return 1;
  return openInterestValue / activeTotal;
}

/**
 * Split the active book by side of current price.
 *
 * Levels below price would liquidate longs; levels above would liquidate shorts. A level
 * sitting exactly on the price bucket counts toward neither — price is trading through it.
 */
export function sumActiveSides(
  activeTiers: Float32Array[],
  priceBucket: number,
): SideTotals {
  let long = 0;
  let short = 0;
  for (const tier of activeTiers) {
    for (let b = 0; b < tier.length; b++) {
      const v = tier[b];
      if (v <= 0) continue;
      if (b < priceBucket) long += v;
      else if (b > priceBucket) short += v;
    }
  }
  return { long, short };
}

/**
 * Per-side multipliers, each anchoring its own side of the book to the *full* OI value.
 *
 * Dividing one OI figure across both sides at once — which is what a single combined scale
 * does — undercounts each side by roughly two.
 */
export function calibrationScales(openInterestValue: number, sides: SideTotals): UsdScales {
  return {
    long: calibrationScale(openInterestValue, sides.long),
    short: calibrationScale(openInterestValue, sides.short),
  };
}
