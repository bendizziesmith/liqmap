import type { Candle, Grid } from './types';

/** Fixed vertical resolution. Every matrix is this tall, so tiers stay comparable. */
export const N_BUCKETS = 1100;

/**
 * Span the grid over the observed price range, padded by the liquidation distance of the
 * *lowest* tier — that is the furthest any seeded level can land from an entry, so nothing
 * ever falls off the edge of the grid.
 */
export function buildGrid(candles: Candle[], minTier: number): Grid {
  let minLow = Infinity;
  let maxHigh = -Infinity;
  for (const c of candles) {
    if (c.low < minLow) minLow = c.low;
    if (c.high > maxHigh) maxHigh = c.high;
  }
  if (!Number.isFinite(minLow) || !Number.isFinite(maxHigh)) {
    minLow = 0;
    maxHigh = 1;
  }

  const min = minLow * (1 - 1 / minTier);
  const max = maxHigh * (1 + 1 / minTier);
  const span = max - min || 1;

  return { min, max, nBuckets: N_BUCKETS, step: span / N_BUCKETS };
}

/** Bucket containing `price`, clamped to the grid. */
export function priceToBucket(grid: Grid, price: number): number {
  const raw = Math.floor((price - grid.min) / grid.step);
  if (raw < 0) return 0;
  if (raw >= grid.nBuckets) return grid.nBuckets - 1;
  return raw;
}

/** Centre price of `bucket`. */
export function bucketToPrice(grid: Grid, bucket: number): number {
  return grid.min + (bucket + 0.5) * grid.step;
}

/** Inclusive `[lo, hi]` bucket span covering a price range, in either input order. */
export function rangeToBuckets(grid: Grid, a: number, b: number): [number, number] {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return [priceToBucket(grid, low), priceToBucket(grid, high)];
}
