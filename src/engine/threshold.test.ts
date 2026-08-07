import { describe, it, expect } from 'vitest';
import {
  bandTierTotals,
  filterBands,
  maxBandUsd,
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
