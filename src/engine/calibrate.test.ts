import { describe, it, expect } from 'vitest';
import { sumActive, calibrationScale } from './calibrate';

function tiers(values: number[][]): Float32Array[] {
  return values.map((v) => Float32Array.from(v));
}

describe('sumActive', () => {
  it('totals every tier of the active column', () => {
    expect(sumActive(tiers([[1, 2, 3], [4, 5]]))).toBe(15);
  });

  it('is zero for an empty book', () => {
    expect(sumActive(tiers([[0, 0], [0]]))).toBe(0);
    expect(sumActive([])).toBe(0);
  });

  it('ignores negatives rather than letting them cancel real mass', () => {
    expect(sumActive(tiers([[5, -5]]))).toBe(5);
  });
});

describe('calibrationScale', () => {
  it('maps the active book onto the open interest', () => {
    // The whole point: scaled active total must equal OI.
    const active = 2_000_000_000;
    const oi = 229_730_518;
    const scale = calibrationScale(oi, active);
    expect(active * scale).toBeCloseTo(oi, 3);
  });

  it('is well under 1 when turnover has accumulated far above open interest', () => {
    expect(calibrationScale(230e6, 4e9)).toBeLessThan(0.1);
  });

  it('tracks a refreshed open interest', () => {
    const active = 1e9;
    const before = calibrationScale(200e6, active);
    const after = calibrationScale(400e6, active);
    expect(after).toBeCloseTo(before * 2, 10);
  });

  it('rises with open interest and falls with a larger active book', () => {
    expect(calibrationScale(2, 100)).toBeGreaterThan(calibrationScale(1, 100));
    expect(calibrationScale(1, 200)).toBeLessThan(calibrationScale(1, 100));
  });

  it('falls back to 1 when open interest is unknown, leaving raw relative units', () => {
    // Better to show uncalibrated numbers than to collapse every figure to zero.
    expect(calibrationScale(0, 1e9)).toBe(1);
    expect(calibrationScale(NaN, 1e9)).toBe(1);
  });

  it('falls back to 1 when the active book is empty', () => {
    expect(calibrationScale(230e6, 0)).toBe(1);
    expect(calibrationScale(230e6, NaN)).toBe(1);
  });

  it('is always finite and positive', () => {
    for (const [oi, active] of [[1e12, 1e-6], [1e-6, 1e12], [5, 5]]) {
      const s = calibrationScale(oi, active);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
  });
});
