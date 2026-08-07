/**
 * Minimum-pool threshold: hide everything below a chosen est. USD so the chart thins to
 * only the pools worth reacting to.
 *
 * Filtering happens here, on the shared per-row band series, rather than inside each
 * renderer — the heatmap raster, the side panel and the Map all read that one series, so a
 * filter applied per-renderer would be three chances to disagree.
 */

export interface VisibleBand {
  /** Displayed estimated USD for the band — the number the threshold is compared against. */
  usd: number;
  /** Raw engine total for the band (sum of the enabled tiers). */
  total: number;
  /** Raw engine value per leverage tier, in tier order. */
  tiers: number[];
}

/**
 * Bands at or above `minUsd`.
 *
 * Inclusive at the boundary (`>=`), matching the reference's "equal or greater than this
 * value". A non-positive or non-finite threshold means no filtering at all, so the default
 * of 0 is the identity and the control starts out doing nothing.
 */
export function filterBands<T extends { usd: number }>(bands: T[], minUsd: number): T[] {
  if (!(minUsd > 0)) return bands;
  return bands.filter((b) => b.usd >= minUsd);
}

/** Per-tier and combined totals across whatever survived the filter. */
export function bandTierTotals(
  bands: VisibleBand[],
  nTiers: number,
): { tiers: number[]; total: number } {
  const tiers = new Array<number>(nTiers).fill(0);
  let total = 0;
  for (const b of bands) {
    for (let t = 0; t < nTiers; t++) tiers[t] += b.tiers[t] ?? 0;
    total += b.total;
  }
  return { tiers, total };
}

/** Largest band on screen — the slider's ceiling. */
export function maxBandUsd(bands: Array<{ usd: number }>): number {
  let max = 0;
  for (const b of bands) if (b.usd > max) max = b.usd;
  return max;
}

/**
 * Smallest threshold the slider can express above zero.
 *
 * Log scaling needs a floor to start from — the alternative is log(0). A thousandth of the
 * ceiling puts three decades of travel under the control, which is the range band values
 * actually span.
 */
const DECADES = 3;

/**
 * Slider position (0..1) to a USD threshold, logarithmically.
 *
 * Band values span orders of magnitude, so a linear slider would bunch every level below a
 * few percent of the ceiling into the first pixel and make the control useless exactly
 * where the interesting cut-offs live. Position 0 is pinned to a true 0 — "show all" has to
 * be reachable, not merely approached.
 */
export function sliderToUsd(position: number, maxUsd: number): number {
  if (!(maxUsd > 0)) return 0;
  const p = Math.min(1, Math.max(0, position));
  if (p <= 0) return 0;
  return maxUsd * Math.pow(10, -DECADES * (1 - p));
}

/** Inverse of `sliderToUsd`, for restoring a persisted threshold onto the control. */
export function usdToSlider(usd: number, maxUsd: number): number {
  if (!(maxUsd > 0) || !(usd > 0)) return 0;
  const p = 1 + Math.log10(Math.min(usd, maxUsd) / maxUsd) / DECADES;
  return Math.min(1, Math.max(0, p));
}
