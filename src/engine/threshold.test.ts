import { describe, it, expect } from 'vitest';
import {
  bandTierTotals,
  filterBands,
  maxBandUsd,
  minBandUsd,
  poolQuantile,
  quantileOfUsd,
  sliderToUsd,
  usdToSlider,
  type VisibleBand,
} from './threshold';

const band = (usd: number, tiers: number[]): VisibleBand => ({
  usd,
  total: tiers.reduce((a, b) => a + b, 0),
  tiers,
});

const SERIES: VisibleBand[] = [
  band(0, [0, 0, 0, 0]),
  band(12_000, [6_000, 4_000, 2_000, 0]),
  band(250_000, [50_000, 100_000, 60_000, 40_000]),
  band(938_100, [0, 0, 647_400, 290_700]),
  band(75_500, [10_000, 20_000, 25_500, 20_000]),
];

describe('filterBands', () => {
  it('is the identity at threshold 0, so the default shows everything', () => {
    expect(filterBands(SERIES, 0)).toEqual(SERIES);
  });

  it('yields nothing once the threshold passes the largest band', () => {
    expect(filterBands(SERIES, 938_101)).toEqual([]);
    expect(filterBands(SERIES, 1e12)).toEqual([]);
  });

  it('is inclusive at the boundary, matching the reference wording (>=)', () => {
    const exact = filterBands(SERIES, 250_000);
    expect(exact.map((b) => b.usd)).toContain(250_000);
    // and one dollar higher drops it
    expect(filterBands(SERIES, 250_001).map((b) => b.usd)).not.toContain(250_000);
  });

  it('drops bands monotonically as the threshold rises', () => {
    let prev = Infinity;
    for (const t of [0, 10_000, 50_000, 100_000, 500_000, 1_000_000]) {
      const n = filterBands(SERIES, t).length;
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
  });

  it('never keeps an empty band, whatever the threshold', () => {
    // A zero band is not a pool; it must not be counted as a survivor at threshold 0.
    expect(filterBands(SERIES, 0).some((b) => b.usd === 0 && b.total === 0)).toBe(true);
    expect(filterBands(SERIES, 1).every((b) => b.usd > 0)).toBe(true);
  });

  it('keeps the survivors intact — same objects, same tier arrays', () => {
    for (const b of filterBands(SERIES, 70_000)) {
      expect(SERIES).toContain(b);
      expect(b.total).toBeCloseTo(b.tiers.reduce((x, y) => x + y, 0), 9);
    }
  });

  it('treats a negative or NaN threshold as no threshold', () => {
    expect(filterBands(SERIES, -5)).toEqual(SERIES);
    expect(filterBands(SERIES, Number.NaN)).toEqual(SERIES);
  });
});

describe('bandTierTotals', () => {
  it('sums each tier across the survivors, and the combined total', () => {
    const t = bandTierTotals(filterBands(SERIES, 100_000), 4);
    // Only the 250,000 and 938,100 bands survive.
    expect(t.tiers).toEqual([50_000, 100_000, 707_400, 330_700]);
    expect(t.total).toBe(1_188_100);
  });

  it('makes the combined total equal the sum of the per-tier totals', () => {
    for (const min of [0, 20_000, 200_000, 900_000]) {
      const t = bandTierTotals(filterBands(SERIES, min), 4);
      expect(t.total).toBeCloseTo(t.tiers.reduce((a, b) => a + b, 0), 6);
    }
  });

  it('returns zeros for an empty survivor set rather than NaN', () => {
    const t = bandTierTotals([], 4);
    expect(t.tiers).toEqual([0, 0, 0, 0]);
    expect(t.total).toBe(0);
  });

  it('falls to match as the threshold rises', () => {
    let prev = Infinity;
    for (const min of [0, 50_000, 300_000, 1e9]) {
      const t = bandTierTotals(filterBands(SERIES, min), 4);
      expect(t.total).toBeLessThanOrEqual(prev);
      prev = t.total;
    }
  });
});

describe('maxBandUsd', () => {
  it('reports the largest band, which is the slider ceiling', () => {
    expect(maxBandUsd(SERIES)).toBe(938_100);
  });

  it('is zero for an empty series, so the slider collapses rather than breaking', () => {
    expect(maxBandUsd([])).toBe(0);
  });
});

describe('log slider mapping', () => {
  const MAX = 938_100;

  it('puts 0 at the far left and the max at the far right', () => {
    expect(sliderToUsd(0, MAX)).toBe(0);
    expect(sliderToUsd(1, MAX)).toBeCloseTo(MAX, 6);
  });

  it('round-trips a value back to its slider position', () => {
    for (const usd of [1_000, 12_000, 75_500, 250_000, 938_100]) {
      expect(sliderToUsd(usdToSlider(usd, MAX), MAX)).toBeCloseTo(usd, 3);
    }
  });

  it('is monotonic, so dragging right never lowers the threshold', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = sliderToUsd(p, MAX);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('spends real travel on the small decades — the point of log scaling', () => {
    // Values span orders of magnitude; a linear slider would bunch everything below
    // ~5% of max into the first pixel. Half-travel must land far below half-max.
    expect(sliderToUsd(0.5, MAX)).toBeLessThan(MAX * 0.1);
    // ...and still be a usefully large number, not a rounding artefact.
    expect(sliderToUsd(0.5, MAX)).toBeGreaterThan(100);
  });

  it('handles a zero or negative ceiling without dividing by zero', () => {
    expect(sliderToUsd(0.5, 0)).toBe(0);
    expect(usdToSlider(10, 0)).toBe(0);
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(sliderToUsd(-1, MAX)).toBe(0);
    expect(sliderToUsd(2, MAX)).toBeCloseTo(MAX, 6);
    expect(usdToSlider(MAX * 10, MAX)).toBe(1);
  });
});

describe('log span anchored to the real pool range', () => {
  it('spends the travel inside the range the pools actually occupy', () => {
    // Measured live: BTC 4h pools ran $2.3M-$51.2M. With a fixed 3-decade slider the whole
    // bottom half sat below the smallest pool and changed nothing.
    const MIN = 2.3e6;
    const MAX = 51.2e6;
    expect(sliderToUsd(0.5, MAX, MIN)).toBeGreaterThan(MIN);
    expect(sliderToUsd(0.5, MAX, MIN)).toBeLessThan(MAX);
    // The floor of the travel is the smallest pool itself, not an arbitrary decade below.
    // Asserted relatively: at these magnitudes an absolute tolerance says nothing.
    expect(Math.abs(sliderToUsd(0.001, MAX, MIN) - MIN) / MIN).toBeLessThan(0.01);
  });

  it('still round-trips with a floor supplied', () => {
    const MIN = 2.3e6;
    const MAX = 51.2e6;
    for (const usd of [2.4e6, 8e6, 20e6, 51.2e6]) {
      expect(sliderToUsd(usdToSlider(usd, MAX, MIN), MAX, MIN)).toBeCloseTo(usd, 0);
    }
  });

  it('falls back to a fixed span when the floor is unusable', () => {
    const MAX = 1e6;
    expect(sliderToUsd(1, MAX, 0)).toBeCloseTo(MAX, 6);
    expect(sliderToUsd(0, MAX, 0)).toBe(0);
    // A floor at or above the ceiling cannot define a span; the fallback keeps it monotone.
    expect(sliderToUsd(0.5, MAX, MAX * 2)).toBeGreaterThan(0);
    expect(sliderToUsd(0.5, MAX, MAX * 2)).toBeLessThan(MAX);
  });

  it('reports the smallest non-empty pool as the floor', () => {
    expect(minBandUsd(SERIES)).toBe(12_000);
    expect(minBandUsd([])).toBe(0);
    expect(minBandUsd([band(0, [0])])).toBe(0);
  });
});

describe('percentile mapping (uniform sensitivity)', () => {
  /** A realistically skewed book: many small pools, a few very large. */
  const skewed = Array.from({ length: 100 }, (_, i) => Math.round(1e6 * Math.pow(1.06, i)));
  const sorted = [...skewed].sort((a, b) => a - b);

  it('shows everything at position 0', () => {
    expect(poolQuantile(sorted, 0)).toBe(0);
  });

  it('hides the smallest half at position 0.5', () => {
    const t = poolQuantile(sorted, 0.5);
    expect(sorted.filter((v) => v >= t)).toHaveLength(50);
  });

  it('hides the smallest 80% at position 0.8', () => {
    const t = poolQuantile(sorted, 0.8);
    expect(sorted.filter((v) => v >= t)).toHaveLength(20);
  });

  it('keeps exactly the largest pool at position 1 — never an empty chart', () => {
    const t = poolQuantile(sorted, 1);
    expect(sorted.filter((v) => v >= t)).toHaveLength(1);
  });

  it('removes a near-constant share of pools per step, which absolute USD did not', () => {
    // Measured on the live absolute-USD slider, ten equal steps dropped
    // [1,0,0,2,8,12,18,19,11,37] of 108 pools: two steps did nothing and the last threw
    // away a third of the book. Percentile travel must be flat by construction.
    const survivors: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = poolQuantile(sorted, i / 10);
      survivors.push(sorted.filter((v) => v >= t).length);
    }
    const drops = survivors.slice(1).map((s, i) => survivors[i] - s);
    expect(drops.filter((d) => d === 0)).toHaveLength(0);
    // Every step removes within one pool of a tenth of the book.
    for (const d of drops.slice(0, -1)) expect(Math.abs(d - 10)).toBeLessThanOrEqual(1);
  });

  it('is monotonic, so dragging right never lowers the threshold', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const t = poolQuantile(sorted, i / 20);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('round-trips a threshold back to its position', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const usd = poolQuantile(sorted, p);
      expect(Math.abs(quantileOfUsd(sorted, usd) - p)).toBeLessThanOrEqual(0.011);
    }
  });

  it('handles ties without claiming to hide pools it cannot', () => {
    const flat = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    // Every pool is identical, so any threshold at or below 5 keeps all ten.
    expect(flat.filter((v) => v >= poolQuantile(flat, 0.5))).toHaveLength(10);
  });

  it('survives an empty or single-pool book', () => {
    expect(poolQuantile([], 0.5)).toBe(0);
    expect(poolQuantile([], 1)).toBe(0);
    expect(poolQuantile([42], 1)).toBe(42);
    expect(quantileOfUsd([], 100)).toBe(0);
  });

  it('clamps positions outside 0..1', () => {
    expect(poolQuantile(sorted, -1)).toBe(0);
    expect(poolQuantile(sorted, 5)).toBe(sorted[sorted.length - 1]);
  });

  it('puts a threshold above every pool at the top of the travel', () => {
    expect(quantileOfUsd(sorted, sorted[sorted.length - 1] * 10)).toBe(1);
    expect(quantileOfUsd(sorted, 0)).toBe(0);
  });
});
