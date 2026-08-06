import { describe, it, expect } from 'vitest';
import { buildGrid, priceToBucket, bucketToPrice, rangeToBuckets, N_BUCKETS } from './grid';
import type { Candle } from './types';

function candle(low: number, high: number): Candle {
  return { start: 0, open: low, high, low, close: high, volume: 1, turnover: 1 };
}

describe('buildGrid', () => {
  const candles = [candle(100, 150), candle(120, 200), candle(110, 180)];

  it('pads the extremes by the widest tier liquidation distance', () => {
    const g = buildGrid(candles, 3);
    expect(g.min).toBeCloseTo(100 * (1 - 1 / 3), 6);
    expect(g.max).toBeCloseTo(200 * (1 + 1 / 3), 6);
  });

  it('pads less when the lowest tier is higher leverage', () => {
    const g = buildGrid(candles, 10);
    expect(g.min).toBeCloseTo(100 * 0.9, 6);
    expect(g.max).toBeCloseTo(200 * 1.1, 6);
  });

  it('always produces 1100 buckets', () => {
    expect(buildGrid(candles, 3).nBuckets).toBe(1100);
    expect(N_BUCKETS).toBe(1100);
  });

  it('derives step from the padded span', () => {
    const g = buildGrid(candles, 3);
    expect(g.step).toBeCloseTo((g.max - g.min) / g.nBuckets, 10);
  });
});

describe('price <-> bucket mapping', () => {
  const g = buildGrid([candle(100, 200)], 3);

  it('round-trips within one bucket width', () => {
    for (const p of [80, 100, 137.5, 199.9, 240]) {
      const back = bucketToPrice(g, priceToBucket(g, p));
      expect(Math.abs(back - p)).toBeLessThanOrEqual(g.step);
    }
  });

  it('clamps prices outside the grid to the end buckets', () => {
    expect(priceToBucket(g, -999)).toBe(0);
    expect(priceToBucket(g, 1e9)).toBe(g.nBuckets - 1);
  });

  it('maps the grid minimum to bucket zero', () => {
    expect(priceToBucket(g, g.min)).toBe(0);
  });

  it('places bucket centres inside their own bucket', () => {
    for (const b of [0, 1, 550, 1099]) {
      expect(priceToBucket(g, bucketToPrice(g, b))).toBe(b);
    }
  });
});

describe('rangeToBuckets', () => {
  const g = buildGrid([candle(100, 200)], 3);

  it('is inclusive of both endpoints', () => {
    const [lo, hi] = rangeToBuckets(g, 120, 140);
    expect(lo).toBe(priceToBucket(g, 120));
    expect(hi).toBe(priceToBucket(g, 140));
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it('handles a zero-width range as a single bucket', () => {
    const [lo, hi] = rangeToBuckets(g, 150, 150);
    expect(lo).toBe(hi);
  });

  it('tolerates inverted input', () => {
    expect(rangeToBuckets(g, 140, 120)).toEqual(rangeToBuckets(g, 120, 140));
  });
});
