import type { Grid } from './types';
import { bucketToPrice } from './grid';

/** Rows at or above this percentile of non-empty mass render as hot pockets. */
const HOT_PERCENTILE = 0.92;

export interface PanelRow {
  /** Estimated USD per leverage tier, in tier order. */
  tiers: number[];
  /** Sum of `tiers` — the bar length. */
  total: number;
  /** Running total downward from current price. Zero at or above the price row. */
  cumLong: number;
  /** Running total upward from current price. Zero at or below the price row. */
  cumShort: number;
  /** Price this screen row represents. */
  price: number;
}

export interface PanelData {
  rows: PanelRow[];
  /** Largest single row total, for bar scaling. */
  rowMax: number;
  /** Largest cumulative across both directions, so the two curves share one scale. */
  maxCum: number;
  /** Rows whose total reaches this are heavy pockets worth calling out. */
  hotThreshold: number;
  /** Screen row holding current price. Longs accumulate below it, shorts above. */
  priceRow: number;
}

/**
 * Fold the active liquidation levels onto the chart's own screen rows.
 *
 * Working in screen rows rather than price buckets is what makes the side panel line up
 * with the heat: both go through the same price→Y mapping, so a bar sits at exactly the
 * height of the band it describes.
 *
 * Cumulative totals run *outward* from current price and never cross it — below price the
 * pending levels are long liquidations, above they are shorts, and summing across the
 * divide would add two unrelated quantities.
 */
export function buildPanelProfile(
  activeTiers: Float32Array[],
  enabled: boolean[],
  grid: Grid,
  p0: number,
  p1: number,
  height: number,
  currentPrice: number | null,
): PanelData {
  const nRows = Math.max(1, Math.ceil(height));
  const nTiers = activeTiers.length;
  const span = p1 - p0;

  const rows: PanelRow[] = Array.from({ length: nRows }, (_, r) => ({
    tiers: new Array<number>(nTiers).fill(0),
    total: 0,
    cumLong: 0,
    cumShort: 0,
    // Row 0 is the top of the plot, which is the high end of the price range.
    price: span > 0 ? p1 - ((r + 0.5) / nRows) * span : p0,
  }));

  /** Row for a price, or -1 when it is off screen. */
  const rowOf = (price: number): number => {
    if (span <= 0) return Math.floor(nRows / 2);
    const y = nRows - ((price - p0) / span) * nRows;
    const row = Math.floor(y);
    return row < 0 || row >= nRows ? -1 : row;
  };

  /** Same mapping, clamped — used for the price marker, which must always land somewhere. */
  const clampedRowOf = (price: number): number => {
    if (span <= 0) return Math.floor(nRows / 2);
    const y = nRows - ((price - p0) / span) * nRows;
    return Math.min(nRows - 1, Math.max(0, Math.floor(y)));
  };

  for (let b = 0; b < grid.nBuckets; b++) {
    let sum = 0;
    const price = bucketToPrice(grid, b);
    for (let t = 0; t < nTiers; t++) {
      if (!enabled[t]) continue;
      const v = activeTiers[t][b];
      if (v === 0) continue;
      sum += v;
    }
    if (sum === 0) continue;

    // Off-screen levels are excluded, not clamped: folding the far unswept shelf into the
    // edge row would set `rowMax` and reduce every visible level to a hairline.
    const row = rowOf(price);
    if (row < 0) continue;
    const target = rows[row];
    for (let t = 0; t < nTiers; t++) {
      if (enabled[t]) target.tiers[t] += activeTiers[t][b];
    }
    target.total += sum;
  }

  const priceRow = currentPrice != null && currentPrice > 0
    ? clampedRowOf(currentPrice)
    : Math.floor(nRows / 2);

  /*
   * Cumulative runs over the WHOLE loaded book, not just the rows on screen.
   *
   * "How much would liquidate between price and here" is a property of the book, so zooming
   * must not change it. Bar heights stay visible-only — those are about rendering the rows
   * you can actually see — but the cumulative walks every bucket outward from the price
   * bucket and each visible row reports the running total at its own price.
   */
  const priceBucket = currentPrice != null && currentPrice > 0
    ? Math.min(grid.nBuckets - 1, Math.max(0, Math.floor((currentPrice - grid.min) / grid.step)))
    : Math.floor(grid.nBuckets / 2);

  const bucketTotal = (b: number): number => {
    let sum = 0;
    for (let t = 0; t < nTiers; t++) {
      if (enabled[t]) sum += activeTiers[t][b];
    }
    return sum;
  };

  const cumLongAt = new Float64Array(grid.nBuckets);
  let running = 0;
  for (let b = priceBucket - 1; b >= 0; b--) {
    running += bucketTotal(b);
    cumLongAt[b] = running;
  }

  const cumShortAt = new Float64Array(grid.nBuckets);
  running = 0;
  for (let b = priceBucket + 1; b < grid.nBuckets; b++) {
    running += bucketTotal(b);
    cumShortAt[b] = running;
  }

  for (let r = 0; r < nRows; r++) {
    const b = Math.min(
      grid.nBuckets - 1,
      Math.max(0, Math.floor((rows[r].price - grid.min) / grid.step)),
    );
    if (r < priceRow) rows[r].cumShort = cumShortAt[b];
    else if (r > priceRow) rows[r].cumLong = cumLongAt[b];
  }

  let rowMax = 0;
  let maxCum = 0;
  const nonEmpty: number[] = [];
  for (const r of rows) {
    if (r.total > rowMax) rowMax = r.total;
    if (r.cumLong > maxCum) maxCum = r.cumLong;
    if (r.cumShort > maxCum) maxCum = r.cumShort;
    if (r.total > 0) nonEmpty.push(r.total);
  }

  nonEmpty.sort((a, b) => a - b);
  const hotThreshold = nonEmpty.length
    ? nonEmpty[Math.min(nonEmpty.length - 1, Math.floor(HOT_PERCENTILE * nonEmpty.length))]
    : 0;

  return { rows, rowMax, maxCum, hotThreshold, priceRow };
}
