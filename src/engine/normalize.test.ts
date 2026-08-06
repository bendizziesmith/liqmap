import { describe, it, expect } from 'vitest';
import { percentileNonZero, computeVmax, normalizeScore } from './normalize';

describe('percentileNonZero', () => {
  it('picks the top value at the 99.7th percentile of 1..100', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileNonZero(values, 0.997)).toBe(100);
  });

  it('picks the median at the 50th percentile', () => {
    expect(percentileNonZero([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('ignores zeros, which would otherwise drag a sparse grid to nothing', () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
    expect(percentileNonZero(values, 0.5)).toBe(10);
  });

  it('returns zero when every value is zero', () => {
    expect(percentileNonZero([0, 0, 0], 0.997)).toBe(0);
  });

  it('returns zero for an empty input', () => {
    expect(percentileNonZero([], 0.997)).toBe(0);
  });
});

describe('computeVmax', () => {
  it('reads the 99.7th percentile of the visible window', () => {
    const m = new Float32Array(200);
    for (let i = 0; i < 200; i++) m[i] = i + 1;
    // Whole window, one column of 200 buckets.
    const v = computeVmax([m], [true], 200, 0, 1, 0, 200);
    expect(v).toBeCloseTo(200, 5);
  });

  it('sums only the enabled tiers', () => {
    const a = new Float32Array([1, 1, 1, 1]);
    const b = new Float32Array([9, 9, 9, 9]);
    const both = computeVmax([a, b], [true, true], 4, 0, 1, 0, 4);
    const onlyA = computeVmax([a, b], [true, false], 4, 0, 1, 0, 4);
    expect(both).toBeCloseTo(10, 5);
    expect(onlyA).toBeCloseTo(1, 5);
  });

  it('restricts itself to the visible column and bucket window', () => {
    // Two columns of four buckets. Column 0 is hot, column 1 is cold.
    const m = new Float32Array([100, 100, 100, 100, 1, 1, 1, 1]);
    expect(computeVmax([m], [true], 4, 1, 2, 0, 4)).toBeCloseTo(1, 5);
  });

  it('never returns zero, so callers can divide by it safely', () => {
    const m = new Float32Array(16);
    expect(computeVmax([m], [true], 4, 0, 4, 0, 4)).toBeGreaterThan(0);
  });
});

describe('normalizeScore', () => {
  it('is zero at zero and one at vmax', () => {
    expect(normalizeScore(0, 10)).toBe(0);
    expect(normalizeScore(10, 10)).toBeCloseTo(1, 10);
  });

  it('applies the 0.68 gamma that lifts mid-range detail', () => {
    expect(normalizeScore(5, 10)).toBeCloseTo(Math.pow(0.5, 0.68), 10);
  });

  it('clamps above vmax rather than running off the colour scale', () => {
    expect(normalizeScore(1000, 10)).toBe(1);
  });
});
