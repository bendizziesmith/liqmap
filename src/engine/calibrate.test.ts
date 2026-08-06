import { describe, it, expect } from 'vitest';
import { sumActive, calibrationScale, sumActiveSides, calibrationScales } from './calibrate';

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

describe('sumActiveSides', () => {
  // Ten buckets; price sits at index 5.
  const tiers = [Float32Array.from([1, 1, 1, 1, 1, 9, 2, 2, 2, 2])];

  it('splits the book at the price bucket', () => {
    const { long, short } = sumActiveSides(tiers, 5);
    expect(long).toBe(5);
    expect(short).toBe(8);
  });

  it('excludes the price bucket itself, which is being traded through', () => {
    const { long, short } = sumActiveSides(tiers, 5);
    expect(long + short).toBe(13); // the 9 at the price bucket belongs to neither
  });

  it('sums across every tier', () => {
    const two = [Float32Array.from([1, 0, 0, 0]), Float32Array.from([3, 0, 0, 0])];
    expect(sumActiveSides(two, 2).long).toBe(4);
  });

  it('reports zero on the empty side when price sits at an edge', () => {
    expect(sumActiveSides(tiers, 0).long).toBe(0);
    expect(sumActiveSides(tiers, 9).short).toBe(0);
  });
});

describe('calibrationScales', () => {
  const OI = 225_500_000;

  it('anchors each side to the full open interest, not half of it', () => {
    // Every contract has a long holder and a short holder, so both sides total OI.
    const sides = { long: 3e9, short: 1e9 };
    const s = calibrationScales(OI, sides);
    expect(sides.long * s.long).toBeCloseTo(OI, 2);
    expect(sides.short * s.short).toBeCloseTo(OI, 2);
  });

  it('gives the thinner side the larger multiplier', () => {
    const s = calibrationScales(OI, { long: 4e9, short: 1e9 });
    expect(s.short).toBeGreaterThan(s.long);
  });

  it('roughly doubles what a single combined scale produced', () => {
    // The old maths divided OI by both sides at once, undercounting each by ~2x.
    const sides = { long: 2e9, short: 2e9 };
    const combined = calibrationScale(OI, sides.long + sides.short);
    const perSide = calibrationScales(OI, sides);
    expect(perSide.long / combined).toBeCloseTo(2, 6);
  });

  it('falls back to 1 per side when open interest is unknown', () => {
    expect(calibrationScales(0, { long: 1e9, short: 1e9 })).toEqual({ long: 1, short: 1 });
  });

  it('falls back to 1 on a side that is empty', () => {
    const s = calibrationScales(OI, { long: 1e9, short: 0 });
    expect(s.short).toBe(1);
    expect(s.long).toBeLessThan(1);
  });
});
