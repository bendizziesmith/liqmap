import type { Candle } from './types';

/**
 * Memory guard. Each candle costs one column across four tier matrices — 4 × 1100 floats,
 * about 17.6 KB — so 5000 candles is roughly 88 MB of Float32Array.
 */
export const MAX_CANDLES = 5000;

/** Fetch more history once the view is within this fraction of the left edge. */
const BACKFILL_TRIGGER = 0.15;

/**
 * Prepend an older page to the loaded candles.
 *
 * Bybit's `end` bound is inclusive, so consecutive pages can share a candle; duplicates are
 * resolved in favour of the copy already loaded, which may have been updated live. When the
 * cap is reached the *oldest* candles are dropped: price is at the newest edge, so that is
 * the end worth keeping.
 */
export function mergeOlder(existing: Candle[], older: Candle[]): Candle[] {
  if (older.length === 0) return existing;

  const seen = new Set(existing.map((c) => c.start));
  const fresh = older.filter((c) => !seen.has(c.start));

  const merged = [...fresh, ...existing].sort((a, b) => a.start - b.start);
  return merged.length > MAX_CANDLES ? merged.slice(merged.length - MAX_CANDLES) : merged;
}

/** Whether a view starting at column `c0` is close enough to the left edge to need more. */
export function needsOlder(c0: number, nCols: number): boolean {
  if (nCols <= 0) return false;
  return c0 < nCols * BACKFILL_TRIGGER;
}
