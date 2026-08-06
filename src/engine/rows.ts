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
 * Two pixels is the point at which a band reads as a band rather than as a scratch, and it
 * is also the point below which a 1px row could be dropped entirely by fractional scaling.
 */
export const MIN_ROW_PX = 2;

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
 * A `0.25 / 0.5 / 0.25` pass over a series, or the series untouched when `on` is false.
 *
 * Used for bar lengths in the side panel so its bars soften in step with the heat. Render
 * only — the values a tooltip reports are never smoothed. Edge taps fold back onto the end
 * element rather than falling off, so the total is unchanged and the profile does not quietly
 * shrink each time it is smoothed.
 */
export function smoothSeries(values: number[], on: boolean): number[] {
  if (!on || values.length < 3) return values;

  const out = new Array<number>(values.length).fill(0);
  const last = values.length - 1;
  for (let i = 0; i <= last; i++) {
    const v = values[i];
    if (v === 0) continue;
    out[i] += v * 0.5;
    out[i === 0 ? 0 : i - 1] += v * 0.25;
    out[i === last ? last : i + 1] += v * 0.25;
  }
  return out;
}
