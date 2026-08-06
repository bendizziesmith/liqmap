/**
 * Denominating the display in open interest.
 *
 * The engine seeds each candle's turnover onto the levels it implies, so a bucket's raw
 * value is cumulative notional that *flowed* through that price over the whole window —
 * months of it. Summed, that reaches billions, which is an order of magnitude more than
 * could ever actually liquidate.
 *
 * Liquidations can only come from positions that are currently open, so the correct anchor
 * is open interest: the total of all active, unswept levels should be about OI. That gives
 * one multiplier applied purely at display time. Nothing in the engine changes, and neither
 * does any rendering normalisation — the colour classes, bar lengths and percentile scales
 * all work on the raw values and are unaffected by a uniform factor.
 */

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
