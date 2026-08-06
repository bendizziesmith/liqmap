import { describe, it, expect } from 'vitest';
import { lastColumn, liquidationProfile } from './profile';
import { buildHeatmap, valueAt } from './build';
import { buildGrid, priceToBucket, N_BUCKETS } from './grid';
import type { Candle, Grid } from './types';

const H = 3_600_000;

function candle(i: number, o: number, h: number, l: number, c: number, turnover = 100): Candle {
  return { start: i * H, open: o, high: h, low: l, close: c, volume: 1, turnover };
}

const CANDLES = [
  candle(0, 100, 104, 96, 102),
  candle(1, 102, 108, 99, 105),
  candle(2, 105, 110, 101, 103),
];

/** A grid and a hand-built active-level set, so expectations are exact. */
function fixture() {
  const grid = buildGrid(CANDLES, 3);
  const tiers = [0, 1, 2, 3].map(() => new Float32Array(N_BUCKETS));
  return { grid, tiers };
}

describe('lastColumn', () => {
  const map = buildHeatmap(CANDLES, [], '4h');

  it('returns one vector per tier', () => {
    const cols = lastColumn(map);
    expect(cols).toHaveLength(map.tiers.length);
    expect(cols[0].length).toBe(map.grid.nBuckets);
  });

  it('reads the final column, not any earlier one', () => {
    const cols = lastColumn(map);
    for (let b = 0; b < map.grid.nBuckets; b++) {
      expect(cols[0][b]).toBe(valueAt(map, 0, map.nCols - 1, b));
    }
  });

  it('returns empty vectors for a map with no columns', () => {
    const empty = buildHeatmap([], [], '4h');
    expect(lastColumn(empty)[0].length).toBe(empty.grid.nBuckets);
    expect(lastColumn(empty)[0].every((v) => v === 0)).toBe(true);
  });
});

describe('liquidationProfile is the heatmap last column', () => {
  const map = buildHeatmap(CANDLES, [], '4h');
  const price = 103;

  it('reproduces the source column exactly at identity binning', () => {
    const p = liquidationProfile(lastColumn(map), map.grid, price, {
      bins: map.grid.nBuckets,
      tierLabels: map.tiers,
    });
    expect(p.bins).toHaveLength(map.grid.nBuckets);

    for (let b = 0; b < map.grid.nBuckets; b++) {
      for (let t = 0; t < map.tiers.length; t++) {
        expect(p.bins[b].tiers[t]).toBeCloseTo(valueAt(map, t, map.nCols - 1, b), 5);
      }
    }
  });

  it('conserves total mass when binning down', () => {
    const active = lastColumn(map);
    let source = 0;
    for (const tier of active) for (const v of tier) source += v;

    const p = liquidationProfile(active, map.grid, price, { bins: 200 });
    const binned = p.bins.reduce((a, b) => a + b.total, 0);
    expect(binned).toBeCloseTo(source, 4);
  });
});

describe('binning', () => {
  const { grid, tiers } = fixture();

  it('produces the requested number of bins', () => {
    expect(liquidationProfile(tiers, grid, 100, { bins: 200 }).bins).toHaveLength(200);
    expect(liquidationProfile(tiers, grid, 100, { bins: 50 }).bins).toHaveLength(50);
  });

  it('covers the grid contiguously with no gaps', () => {
    const p = liquidationProfile(tiers, grid, 100, { bins: 200 });
    expect(p.bins[0].priceFrom).toBeCloseTo(grid.min, 6);
    expect(p.bins[p.bins.length - 1].priceTo).toBeCloseTo(grid.max, 6);

    for (let i = 1; i < p.bins.length; i++) {
      expect(p.bins[i].priceFrom).toBeCloseTo(p.bins[i - 1].priceTo, 6);
    }
  });

  it('puts the midpoint between the bin edges', () => {
    const p = liquidationProfile(tiers, grid, 100, { bins: 200 });
    for (const b of [p.bins[0], p.bins[100], p.bins[199]]) {
      expect(b.priceMid).toBeCloseTo((b.priceFrom + b.priceTo) / 2, 6);
    }
  });

  it('sums every source bucket into exactly one bin', () => {
    const t = [new Float32Array(N_BUCKETS), new Float32Array(N_BUCKETS)];
    t[0].fill(1); // 1100 buckets of 1 => total 1100
    const p = liquidationProfile(t, grid, 100, { bins: 200 });
    expect(p.bins.reduce((a, b) => a + b.total, 0)).toBeCloseTo(N_BUCKETS, 4);
  });
});

describe('stacking', () => {
  const { grid } = fixture();

  it('makes total the sum of the tiers', () => {
    const t = [new Float32Array(N_BUCKETS), new Float32Array(N_BUCKETS)];
    const b = priceToBucket(grid, 100);
    t[0][b] = 3;
    t[1][b] = 4;

    const p = liquidationProfile(t, grid, 100, { bins: 1100 });
    for (const bin of p.bins) {
      expect(bin.total).toBeCloseTo(
        bin.tiers.reduce((a, v) => a + v, 0),
        6,
      );
    }
    expect(p.bins[b].total).toBeCloseTo(7, 6);
  });

  it('keeps one entry per tier in every bin', () => {
    const t = [new Float32Array(N_BUCKETS), new Float32Array(N_BUCKETS), new Float32Array(N_BUCKETS)];
    const p = liquidationProfile(t, grid, 100, { bins: 10 });
    for (const bin of p.bins) expect(bin.tiers).toHaveLength(3);
  });
});

describe('cumulative outward from price', () => {
  /** Deposit 1 unit in every bucket so cumulative growth is easy to reason about. */
  function flatProfile(price: number, bins = 1100) {
    const grid: Grid = { min: 0, max: 1100, nBuckets: N_BUCKETS, step: 1 };
    const t = [new Float32Array(N_BUCKETS)];
    t[0].fill(1);
    return liquidationProfile(t, grid, price, { bins });
  }

  it('accumulates downward below price', () => {
    const p = flatProfile(550);
    const i = p.priceBinIndex;
    // One step below price has 1 unit, two steps has 2, and so on.
    expect(p.bins[i - 1].cumLong).toBeCloseTo(1, 6);
    expect(p.bins[i - 2].cumLong).toBeCloseTo(2, 6);
    expect(p.bins[i - 10].cumLong).toBeCloseTo(10, 6);
  });

  it('accumulates upward above price', () => {
    const p = flatProfile(550);
    const i = p.priceBinIndex;
    expect(p.bins[i + 1].cumShort).toBeCloseTo(1, 6);
    expect(p.bins[i + 2].cumShort).toBeCloseTo(2, 6);
    expect(p.bins[i + 10].cumShort).toBeCloseTo(10, 6);
  });

  it('is monotonically non-decreasing walking down from price', () => {
    const p = flatProfile(550);
    for (let i = p.priceBinIndex - 1; i > 0; i--) {
      expect(p.bins[i - 1].cumLong).toBeGreaterThanOrEqual(p.bins[i].cumLong);
    }
  });

  it('is monotonically non-decreasing walking up from price', () => {
    const p = flatProfile(550);
    for (let i = p.priceBinIndex + 1; i < p.bins.length - 1; i++) {
      expect(p.bins[i + 1].cumShort).toBeGreaterThanOrEqual(p.bins[i].cumShort);
    }
  });

  it('never carries long cumulative above price or short cumulative below', () => {
    const p = flatProfile(550);
    for (let i = p.priceBinIndex + 1; i < p.bins.length; i++) {
      expect(p.bins[i].cumLong).toBe(0);
    }
    for (let i = 0; i < p.priceBinIndex; i++) {
      expect(p.bins[i].cumShort).toBe(0);
    }
  });

  it('reports maxCum across both directions', () => {
    const p = flatProfile(550);
    const maxLong = Math.max(...p.bins.map((b) => b.cumLong));
    const maxShort = Math.max(...p.bins.map((b) => b.cumShort));
    expect(p.maxCum).toBeCloseTo(Math.max(maxLong, maxShort), 6);
  });

  it('survives a price at the very bottom of the grid', () => {
    const p = flatProfile(0);
    expect(p.priceBinIndex).toBe(0);
    expect(p.bins.every((b) => Number.isFinite(b.cumShort))).toBe(true);
    expect(p.bins[p.bins.length - 1].cumShort).toBeGreaterThan(0);
  });

  it('survives a price at the very top of the grid', () => {
    const p = flatProfile(1e9);
    expect(p.priceBinIndex).toBe(p.bins.length - 1);
    expect(p.bins.every((b) => Number.isFinite(b.cumLong))).toBe(true);
    expect(p.bins[0].cumLong).toBeGreaterThan(0);
  });
});

describe('degenerate input', () => {
  const { grid, tiers } = fixture();

  it('returns zeroed bins for an all-zero column without dividing by zero', () => {
    const p = liquidationProfile(tiers, grid, 100, { bins: 200 });
    expect(p.bins.every((b) => b.total === 0)).toBe(true);
    expect(p.maxTotal).toBe(0);
    expect(p.maxCum).toBe(0);
    expect(Number.isFinite(p.priceBinIndex)).toBe(true);
  });

  it('handles a single bin', () => {
    const p = liquidationProfile(tiers, grid, 100, { bins: 1 });
    expect(p.bins).toHaveLength(1);
    expect(p.priceBinIndex).toBe(0);
  });

  it('carries the tier labels through for rendering', () => {
    const p = liquidationProfile(tiers, grid, 100, { tierLabels: [3, 5, 10, 25] });
    expect(p.tiers).toEqual([3, 5, 10, 25]);
  });

  it('falls back to index labels when none are given', () => {
    const p = liquidationProfile(tiers, grid, 100);
    expect(p.tiers).toHaveLength(4);
  });

  it('reports maxTotal as the tallest bin', () => {
    const t = [new Float32Array(N_BUCKETS)];
    t[0][priceToBucket(grid, 100)] = 9;
    const p = liquidationProfile(t, grid, 100, { bins: 1100 });
    expect(p.maxTotal).toBeCloseTo(9, 6);
  });
});
