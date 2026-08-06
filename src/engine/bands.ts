import type { Band, Grid } from './types';
import { bucketToPrice } from './grid';

export interface NearestBand extends Band {
  /** Signed percentage from the reference price: positive above, negative below. */
  distancePct: number;
}

/**
 * Collapse one column into a ranked list of price levels.
 *
 * A single real level lands across several neighbouring buckets, so contiguous runs are
 * merged and reported at their peak. Without that, "the three strongest bands" would often
 * be three buckets of the same band.
 */
export function topBands(
  matrices: Float32Array[],
  enabled: boolean[],
  grid: Grid,
  nCols: number,
  col: number,
  limit: number,
): Band[] {
  if (nCols === 0 || col < 0 || col >= nCols) return [];

  const offset = col * grid.nBuckets;
  const bands: Band[] = [];

  let runPeak = 0;
  let runBucket = -1;

  const flushRun = () => {
    if (runBucket >= 0) {
      bands.push({ price: bucketToPrice(grid, runBucket), score: runPeak });
      runBucket = -1;
      runPeak = 0;
    }
  };

  for (let b = 0; b < grid.nBuckets; b++) {
    let sum = 0;
    for (let t = 0; t < matrices.length; t++) {
      if (enabled[t]) sum += matrices[t][offset + b];
    }

    if (sum > 0) {
      if (sum > runPeak) {
        runPeak = sum;
        runBucket = b;
      } else if (runBucket < 0) {
        runBucket = b;
      }
    } else {
      flushRun();
    }
  }
  flushRun();

  bands.sort((a, b) => b.score - a.score);
  return bands.slice(0, limit);
}

/**
 * Restrict bands to a percentage window around price.
 *
 * Levels far below a long uptrend never get swept, so they accumulate into a shelf that is
 * always the strongest thing on the grid. Scoring against that shelf would make every band
 * near price look negligible, so relative strength is judged within a neighbourhood.
 */
export function bandsWithin(bands: Band[], price: number, pct: number): Band[] {
  if (price <= 0) return bands;
  return bands.filter((b) => Math.abs((b.price - price) / price) * 100 <= pct);
}

/**
 * The closest band to `price` that is at least `minScore` strong.
 *
 * `side` restricts the search to bands above or below price, which is what the watchlist
 * needs when it wants "the magnet overhead" rather than merely "the nearest magnet".
 */
export function nearestBand(
  bands: Band[],
  price: number,
  minScore: number,
  side: 'both' | 'above' | 'below' = 'both',
): NearestBand | null {
  let best: NearestBand | null = null;

  for (const band of bands) {
    if (band.score < minScore) continue;
    if (side === 'above' && band.price <= price) continue;
    if (side === 'below' && band.price >= price) continue;

    const distancePct = price > 0 ? ((band.price - price) / price) * 100 : 0;
    if (best === null || Math.abs(distancePct) < Math.abs(best.distancePct)) {
      best = { ...band, distancePct };
    }
  }

  return best;
}
