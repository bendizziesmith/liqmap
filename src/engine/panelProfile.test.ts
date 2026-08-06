import { describe, it, expect } from 'vitest';
import { buildPanelProfile } from './panelProfile';
import { N_BUCKETS } from './grid';
import type { Grid } from './types';

/** Prices 0..1100, one unit per bucket, so a row index maps to a predictable price. */
const grid: Grid = { min: 0, max: 1100, nBuckets: N_BUCKETS, step: 1 };

function flatTiers(value = 1, tiers = 2): Float32Array[] {
  return Array.from({ length: tiers }, () => new Float32Array(N_BUCKETS).fill(value));
}

const ALL = [true, true, true, true];

describe('buildPanelProfile shape', () => {
  const p = buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, 550);

  it('produces one row per screen pixel', () => {
    expect(p.rows).toHaveLength(100);
  });

  it('makes each row total the sum of its tiers', () => {
    for (const r of p.rows) {
      expect(r.total).toBeCloseTo(r.tiers.reduce((a, b) => a + b, 0), 6);
    }
  });

  it('conserves the seeded mass across all rows', () => {
    // Two tiers of 1100 buckets at 1.0 each.
    const total = p.rows.reduce((a, r) => a + r.total, 0);
    expect(total).toBeCloseTo(2 * N_BUCKETS, 4);
  });

  it('counts only the enabled tiers', () => {
    const one = buildPanelProfile(flatTiers(1, 2), [true, false], grid, 0, 1100, 100, 550);
    const both = buildPanelProfile(flatTiers(1, 2), [true, true], grid, 0, 1100, 100, 550);
    const sum = (x: typeof one) => x.rows.reduce((a, r) => a + r.total, 0);
    expect(sum(both)).toBeCloseTo(sum(one) * 2, 4);
  });
});

describe('visible window', () => {
  it('ignores buckets outside the visible price range instead of piling them on the edges', () => {
    const tiers = [new Float32Array(N_BUCKETS)];
    tiers[0][50] = 1_000_000; // price ~50, far below the window
    tiers[0][600] = 10; //        price ~600, inside the window

    const p = buildPanelProfile(tiers, ALL, grid, 500, 700, 100, 550);
    const total = p.rows.reduce((a, r) => a + r.total, 0);

    // Clamping the off-screen mass into the bottom row would make rowMax 1,000,000 and
    // render every real level as a hairline.
    expect(total).toBeCloseTo(10, 6);
    expect(p.rowMax).toBeCloseTo(10, 6);
  });

  it('never reaches mass lying beyond the far edge of the window', () => {
    // Cumulative counts the book between price and each visible row's own price. A level at
    // bucket 50 sits below every row in a 500-700 window, so no visible row reaches it —
    // that is different from clipping the sum to the viewport.
    const tiers = [new Float32Array(N_BUCKETS)];
    tiers[0][50] = 1_000_000;
    tiers[0][600] = 10;
    const p = buildPanelProfile(tiers, ALL, grid, 500, 700, 100, 550);
    expect(Math.max(...p.rows.map((r) => r.cumLong))).toBeLessThanOrEqual(10);
  });
});

describe('price row', () => {
  it('places the current price at the row the screen would draw it on', () => {
    // Screen Y grows downward, so a price at the top of the range is row 0.
    expect(buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, 1100).priceRow).toBe(0);
    // Not exactly 0: a price of zero means "not loaded yet", not "bottom of the range".
    expect(buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, 0.5).priceRow).toBe(99);
  });

  it('treats a zero or missing price as unknown rather than as the grid floor', () => {
    expect(buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, 0).priceRow).toBe(50);
    expect(buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, null).priceRow).toBe(50);
  });

  it('puts a mid-range price mid-panel', () => {
    expect(buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, 550).priceRow).toBe(50);
  });

  it('falls back to the middle when there is no price', () => {
    expect(buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, null).priceRow).toBe(50);
  });
});

describe('cumulative curves', () => {
  const p = buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 100, 550);

  it('accumulates shorts upward from current price', () => {
    // Rows above the price row are higher prices: shorts liquidate there.
    const above = p.priceRow - 1;
    expect(p.rows[above].cumShort).toBeGreaterThan(0);
    expect(p.rows[above - 1].cumShort).toBeGreaterThan(p.rows[above].cumShort);
  });

  it('accumulates longs downward from current price', () => {
    const below = p.priceRow + 1;
    expect(p.rows[below].cumLong).toBeGreaterThan(0);
    expect(p.rows[below + 1].cumLong).toBeGreaterThan(p.rows[below].cumLong);
  });

  it('is monotonically non-decreasing walking up from price', () => {
    for (let r = p.priceRow - 1; r > 0; r--) {
      expect(p.rows[r - 1].cumShort).toBeGreaterThanOrEqual(p.rows[r].cumShort);
    }
  });

  it('is monotonically non-decreasing walking down from price', () => {
    for (let r = p.priceRow + 1; r < p.rows.length - 1; r++) {
      expect(p.rows[r + 1].cumLong).toBeGreaterThanOrEqual(p.rows[r].cumLong);
    }
  });

  it('never carries short cumulative below price or long cumulative above', () => {
    for (let r = p.priceRow; r < p.rows.length; r++) expect(p.rows[r].cumShort).toBe(0);
    for (let r = 0; r <= p.priceRow; r++) expect(p.rows[r].cumLong).toBe(0);
  });

  it('reports maxCum across both directions', () => {
    const maxL = Math.max(...p.rows.map((r) => r.cumLong));
    const maxS = Math.max(...p.rows.map((r) => r.cumShort));
    expect(p.maxCum).toBeCloseTo(Math.max(maxL, maxS), 6);
  });
});

describe('hot pockets', () => {
  it('marks roughly the top 8% of non-empty rows as hot', () => {
    const tiers = [new Float32Array(N_BUCKETS)];
    // 100 buckets with steadily increasing mass, spread across the grid.
    for (let i = 0; i < 100; i++) tiers[0][i * 11] = i + 1;

    const p = buildPanelProfile(tiers, ALL, grid, 0, 1100, 100, 550);
    const hot = p.rows.filter((r) => r.total > 0 && r.total >= p.hotThreshold).length;
    const nonEmpty = p.rows.filter((r) => r.total > 0).length;

    expect(hot).toBeGreaterThan(0);
    expect(hot / nonEmpty).toBeLessThan(0.25);
  });

  it('puts the threshold above the median, so most rows are not hot', () => {
    const tiers = [new Float32Array(N_BUCKETS)];
    for (let i = 0; i < 100; i++) tiers[0][i * 11] = i + 1;
    const p = buildPanelProfile(tiers, ALL, grid, 0, 1100, 100, 550);
    expect(p.hotThreshold).toBeGreaterThan(50);
  });

  it('has a zero threshold when nothing is seeded, so nothing renders hot', () => {
    const p = buildPanelProfile([new Float32Array(N_BUCKETS)], ALL, grid, 0, 1100, 100, 550);
    expect(p.rowMax).toBe(0);
    expect(p.rows.every((r) => r.total === 0)).toBe(true);
  });
});

describe('degenerate input', () => {
  it('returns a single row for a zero-height panel without dividing by zero', () => {
    const p = buildPanelProfile(flatTiers(), ALL, grid, 0, 1100, 0, 550);
    expect(p.rows.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(p.rowMax)).toBe(true);
  });

  it('handles a price outside the visible range', () => {
    const p = buildPanelProfile(flatTiers(), ALL, grid, 500, 600, 100, 5);
    expect(p.priceRow).toBeGreaterThanOrEqual(0);
    expect(p.priceRow).toBeLessThan(p.rows.length);
  });
});

describe('cumulative is a property of the book, not the viewport', () => {
  const tiers = [new Float32Array(N_BUCKETS)];
  for (let b = 0; b < N_BUCKETS; b++) tiers[0][b] = 1;

  /** Cumulative reported at a fixed price, under a given zoom window. */
  const cumAt = (p0: number, p1: number, price: number, at: number) => {
    const p = buildPanelProfile(tiers, ALL, grid, p0, p1, 200, price);
    let best = p.rows[0];
    let bestDist = Infinity;
    for (const r of p.rows) {
      const d = Math.abs(r.price - at);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return { long: best.cumLong, short: best.cumShort };
  };

  /**
   * Agreement is within a bucket or two, not exact: each zoom level gives its rows a
   * different price span, so reading a step function at the row nearest a target price
   * lands on a slightly different bucket. 1% covers that; a viewport-dependent cumulative
   * would differ by far more.
   */
  const within1Pct = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) < 0.01;

  it('reports the same cumulative at a price whether zoomed in or out', () => {
    const wide = cumAt(0, 1100, 550, 300);
    const tight = cumAt(200, 700, 550, 300);
    expect(within1Pct(tight.long, wide.long)).toBe(true);
  });

  it('holds on the short side too', () => {
    const wide = cumAt(0, 1100, 550, 800);
    const tight = cumAt(400, 900, 550, 800);
    expect(within1Pct(tight.short, wide.short)).toBe(true);
  });

  it('would fail loudly if cumulative were summed over visible rows only', () => {
    // A visible-only sum at the tight window would reach ~50 units, not ~250.
    const tight = cumAt(200, 700, 550, 300);
    expect(tight.long).toBeGreaterThan(200);
  });

  it('counts levels outside the viewport, which a visible-only sum would miss', () => {
    // Price 550, level at 300, but the window starts at 280 — the mass between 280 and 300
    // is off screen on one side yet still lies between price and the level.
    const clipped = cumAt(280, 620, 550, 300);
    expect(clipped.long).toBeGreaterThan(200);
  });

  it('reaches the whole side total at the far extreme', () => {
    const p = buildPanelProfile(tiers, ALL, grid, 0, 1100, 200, 550);
    const maxLong = Math.max(...p.rows.map((r) => r.cumLong));
    // Everything below the price bucket: 1 unit per bucket.
    expect(maxLong).toBeGreaterThan(N_BUCKETS * 0.45);
  });
});
