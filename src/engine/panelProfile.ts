import type { Grid } from './types';
import { priceToBucket } from './grid';
import { rowOfBucket } from './rows';

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
  /** Centre price of the buckets this row owns. */
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
  /** Row holding current price. Longs accumulate below it, shorts above. */
  priceRow: number;
  /** First and last visible bucket — the span `rows` was binned over. */
  b0: number;
  b1: number;
}

/**
 * Fold the active liquidation levels onto the chart's display rows.
 *
 * Binned by BUCKET INDEX through the same `rowOfBucket` the raster uses — never by mapping
 * each bucket's price onto screen pixels. The two disagree at row boundaries whenever a row
 * spans more than one bucket, and that skew is exactly the audit failure it produced: the
 * panel bar and the heat cell at the same height described different bucket sets, so their
 * tooltips reported different dollars for the same price. One binning, one series, every
 * surface reads it.
 *
 * Cumulative totals still run over the WHOLE book at bucket resolution, outward from the
 * price bucket, and never cross it — below price the pending levels are long liquidations,
 * above they are shorts, and summing across the divide would add two unrelated quantities.
 */
export function buildPanelProfile(
  activeTiers: Float32Array[],
  enabled: boolean[],
  grid: Grid,
  p0: number,
  p1: number,
  nRowsWanted: number,
  currentPrice: number | null,
): PanelData {
  const nRows = Math.max(1, Math.ceil(nRowsWanted));
  const nTiers = activeTiers.length;

  const b0 = priceToBucket(grid, p0);
  const b1 = priceToBucket(grid, p1);

  const rows: PanelRow[] = Array.from({ length: nRows }, () => ({
    tiers: new Array<number>(nTiers).fill(0),
    total: 0,
    cumLong: 0,
    cumShort: 0,
    price: 0,
  }));

  // Track each row's bucket span while binning, so its price is the centre of what it
  // actually owns rather than a screen-space interpolation.
  const rowLo = new Int32Array(nRows).fill(-1);
  const rowHi = new Int32Array(nRows).fill(-1);

  for (let b = b0; b <= b1; b++) {
    const row = rowOfBucket(b, b0, b1, nRows);
    if (rowLo[row] < 0 || b < rowLo[row]) rowLo[row] = b;
    if (b > rowHi[row]) rowHi[row] = b;

    const target = rows[row];
    let sum = 0;
    for (let t = 0; t < nTiers; t++) {
      if (!enabled[t]) continue;
      const v = activeTiers[t][b];
      if (v === 0) continue;
      target.tiers[t] += v;
      sum += v;
    }
    target.total += sum;
  }

  for (let r = 0; r < nRows; r++) {
    // Rows beyond the bucket span (more rows than buckets never happens — rowOfBucket fills
    // every row when nRows <= span — but an empty guard keeps the price finite regardless).
    if (rowLo[r] < 0) {
      rows[r].price = grid.min + (b0 + 0.5) * grid.step;
      continue;
    }
    rows[r].price = grid.min + ((rowLo[r] + rowHi[r] + 1) / 2) * grid.step;
  }

  const priceBucket = currentPrice != null && currentPrice > 0
    ? priceToBucket(grid, currentPrice)
    : Math.floor((b0 + b1) / 2);
  const priceRow = rowOfBucket(
    Math.min(b1, Math.max(b0, priceBucket)),
    b0,
    b1,
    nRows,
  );

  /*
   * Cumulative runs over the WHOLE loaded book, not just the rows on screen.
   *
   * "How much would liquidate between price and here" is a property of the book, so zooming
   * must not change it. Bar heights stay visible-only — those are about rendering the rows
   * you can actually see — but the cumulative walks every bucket outward from the price
   * bucket and each visible row reports the running total at its own price.
   */
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

  return { rows, rowMax, maxCum, hotThreshold, priceRow, b0, b1 };
}
