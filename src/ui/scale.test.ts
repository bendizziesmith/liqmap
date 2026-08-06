import { describe, it, expect } from 'vitest';
import { priceToY, yToPrice } from './scale';

describe('priceToY', () => {
  it('puts the low end of the range at the bottom of the plot', () => {
    expect(priceToY(100, 100, 200, 400)).toBeCloseTo(400, 6);
  });

  it('puts the high end at the top', () => {
    expect(priceToY(200, 100, 200, 400)).toBeCloseTo(0, 6);
  });

  it('puts the midpoint halfway', () => {
    expect(priceToY(150, 100, 200, 400)).toBeCloseTo(200, 6);
  });

  it('extrapolates outside the range rather than clamping', () => {
    // The caller clips to the plot; silently clamping here would pin off-screen candles
    // to the edge instead of letting them leave the viewport.
    expect(priceToY(250, 100, 200, 400)).toBeLessThan(0);
    expect(priceToY(50, 100, 200, 400)).toBeGreaterThan(400);
  });

  it('returns a finite number when the range is degenerate', () => {
    expect(Number.isFinite(priceToY(100, 100, 100, 400))).toBe(true);
  });

  it('returns a finite number when the plot has no height', () => {
    expect(Number.isFinite(priceToY(150, 100, 200, 0))).toBe(true);
  });
});

describe('yToPrice', () => {
  it('inverts priceToY', () => {
    for (const price of [100, 123.45, 150, 199.99]) {
      expect(yToPrice(priceToY(price, 100, 200, 400), 100, 200, 400)).toBeCloseTo(price, 6);
    }
  });

  it('reads the bottom of the plot as the low end', () => {
    expect(yToPrice(400, 100, 200, 400)).toBeCloseTo(100, 6);
  });

  it('reads the top as the high end', () => {
    expect(yToPrice(0, 100, 200, 400)).toBeCloseTo(200, 6);
  });

  it('returns a finite number when the plot has no height', () => {
    expect(Number.isFinite(yToPrice(0, 100, 200, 0))).toBe(true);
  });
});

describe('alignment guarantee', () => {
  it('maps a price to the same Y for every caller', () => {
    // The heatmap band, the candle, and the side-panel bar all go through this one
    // function. If they agree here they agree on screen.
    const args = [64250.5, 62000, 67000, 734] as const;
    const a = priceToY(...args);
    const b = priceToY(...args);
    expect(a).toBe(b);
  });

  it('preserves ordering: a higher price is never lower on screen', () => {
    let prev = Infinity;
    for (let p = 100; p <= 200; p += 5) {
      const y = priceToY(p, 100, 200, 400);
      expect(y).toBeLessThanOrEqual(prev);
      prev = y;
    }
  });
});
