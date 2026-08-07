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

/** Widest span the slider will cover when the caller gives no floor, in decades. */
const FALLBACK_DECADES = 3;

/**
 * Log span the control actually covers, from the smallest pool on screen to the largest.
 *
 * A fixed decade count wastes travel: measured on BTCUSDT 4h the pools ran $2.3M-$51.2M,
 * barely 1.3 decades, so a fixed 3-decade slider did nothing at all across its bottom half.
 * Anchoring the floor to the smallest pool present puts the whole travel inside the range
 * where cut-offs change what you see.
 */
function decades(minUsd: number, maxUsd: number): number {
  if (!(minUsd > 0) || minUsd >= maxUsd) return FALLBACK_DECADES;
  return Math.max(0.5, Math.log10(maxUsd / minUsd));
}

/**
 * Slider position (0..1) to a USD threshold, logarithmically.
 *
 * Band values span orders of magnitude, so a linear slider would bunch every level below a
 * few percent of the ceiling into the first pixel and make the control useless exactly
 * where the interesting cut-offs live. Position 0 is pinned to a true 0 — "show all" has to
 * be reachable, not merely approached.
 */
export function sliderToUsd(position: number, maxUsd: number, minBandUsd = 0): number {
  if (!(maxUsd > 0)) return 0;
  const p = Math.min(1, Math.max(0, position));
  if (p <= 0) return 0;
  return maxUsd * Math.pow(10, -decades(minBandUsd, maxUsd) * (1 - p));
}

/** Inverse of `sliderToUsd`, for restoring a persisted threshold onto the control. */
export function usdToSlider(usd: number, maxUsd: number, minBandUsd = 0): number {
  if (!(maxUsd > 0) || !(usd > 0)) return 0;
  const p = 1 + Math.log10(Math.min(usd, maxUsd) / maxUsd) / decades(minBandUsd, maxUsd);
  return Math.min(1, Math.max(0, p));
}

/** Smallest non-empty pool — the slider's floor, so its travel spans real values only. */
export function minBandUsd(bands: Array<{ usd: number }>): number {
  let min = Infinity;
  for (const b of bands) if (b.usd > 0 && b.usd < min) min = b.usd;
  return Number.isFinite(min) ? min : 0;
}

/**
 * Threshold that hides the smallest `p` share of pools.
 *
 * Pool values are heavily skewed — a handful of very large levels and a long tail of small
 * ones — so mapping slider travel to an absolute USD amount, even logarithmically, spends
 * most of the control in a region where nothing visibly changes. Measured live on BTCUSDT
 * 4h, ten equal steps of the USD slider removed [1,0,0,2,8,12,18,19,11,37] of 108 pools:
 * two steps did nothing at all and the last discarded a third of the book in one nudge.
 *
 * Mapping travel to the PERCENTILE of pool values makes sensitivity uniform by
 * construction: half-travel hides the smallest half, whatever shape the distribution has.
 * The resulting USD figure is still shown as text, so the number stays legible.
 *
 * `sorted` must be the non-empty pool values, ascending.
 */
export function poolQuantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0 || !(p > 0)) return 0;
  if (p >= 1) return sorted[n - 1];
  return sorted[Math.min(n - 1, Math.floor(p * n))];
}

/** Inverse of `poolQuantile`: the share of pools a given threshold hides. */
export function quantileOfUsd(sorted: number[], usd: number): number {
  const n = sorted.length;
  if (n === 0 || !(usd > 0)) return 0;
  // First index whose value survives the threshold; everything before it is hidden.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] >= usd) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(1, lo / n);
}
