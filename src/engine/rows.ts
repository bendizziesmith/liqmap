/**
 * Mapping price buckets onto the display rows a chart actually paints.
 *
 * The grid is a fixed 1100 buckets, but a plot is only a few hundred pixels tall. Painting
 * one source pixel per bucket and letting the blit resample means that whenever the visible
 * span exceeds the plot height, nearest-neighbour sampling keeps one bucket per output row
 * and silently discards the rest — levels blink in and out as you zoom, and what survives is
 * single-pixel aliasing debris rather than structure.
 *
 * Aggregating here instead makes the row the unit of display: each row owns a contiguous run
 * of buckets and takes their **sum**, so the visible mass is conserved exactly and the
 * percentile ladder still describes what is on screen.
 */

/**
 * Shortest a display row is allowed to be.
 *
 * One pixel: a display row exists to stop buckets being DROPPED by resampling, not to make
 * bands look chunky. A 3px floor merged neighbouring levels into one fat block and cost the
 * per-candle structure the chart is read for — the aggregation still conserves mass at 1px,
 * which was the whole reason it exists.
 */
export const MIN_ROW_PX = 1;

/**
 * How many rows to paint for `nBuckets` visible buckets across `heightPx` pixels.
 *
 * Never more rows than buckets — a row must never split a bucket, or the same value would be
 * counted twice — and never so many that a row is thinner than `minRowPx`. Zoom in far
 * enough and this returns the bucket count, so single-bucket detail comes back on its own.
 */
export function displayRows(nBuckets: number, heightPx: number, minRowPx = MIN_ROW_PX): number {
  const byHeight = Math.floor(heightPx / minRowPx);
  return Math.max(1, Math.min(nBuckets || 1, byHeight || 1));
}

/**
 * Row owning `bucket`, where row 0 is the top of the plot — the *highest* price.
 *
 * Every bucket in `[b0, b1]` maps to exactly one row, which is what makes summing into rows
 * mass-conserving.
 */
export function rowOfBucket(bucket: number, b0: number, b1: number, rows: number): number {
  const span = b1 - b0 + 1;
  if (span <= 1 || rows <= 1) return 0;
  const fromTop = b1 - bucket;
  const r = Math.floor((fromTop * rows) / span);
  return r < 0 ? 0 : r >= rows ? rows - 1 : r;
}


/**
 * Collect the class-ladder samples from an aggregated row matrix, excluding one column.
 *
 * The excluded column is the still-forming candle. Percentile breaks drawn from a sample
 * set that includes it drift on every websocket reseed, and any cell whose value sits near
 * a break then flips class — measured live as ~1,500 historical pixels recolouring within
 * one candle. With the forming column excluded, the sample set between candle closes is
 * bit-identical from tick to tick, so the ladder cannot move at all: it recomputes exactly
 * when the inputs change — candle close, symbol or timeframe, zoom or pan, tier toggle.
 * A violent forming print still paints (judged against the stable ladder, capped at the
 * top class); it just cannot re-grade history around itself.
 */
export function sideSamples(
  agg: ArrayLike<number>,
  rows: number,
  cols: number,
  excludeCol: number,
  sideOfRow: (row: number) => 'above' | 'below',
): { visible: number[]; above: number[]; below: number[] } {
  const visible: number[] = [];
  const above: number[] = [];
  const below: number[] = [];
  for (let r = 0; r < rows; r++) {
    const side = sideOfRow(r) === 'above' ? above : below;
    for (let c = 0; c < cols; c++) {
      if (c === excludeCol) continue;
      const v = agg[r * cols + c];
      if (v <= 0) continue;
      visible.push(v);
      side.push(v);
    }
  }
  return { visible, above, below };
}
