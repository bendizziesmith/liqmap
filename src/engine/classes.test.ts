import { describe, it, expect } from 'vitest';
import {
  CLASS_PERCENTILES,
  N_CLASSES,
  classBreaks,
  classOf,
  classAlpha,
  COLORMAPS,
  colormapIds,
  luminance,
} from './classes';

describe('classBreaks', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

  it('produces one break fewer than there are classes', () => {
    expect(classBreaks(values).length).toBe(N_CLASSES - 1);
    expect(N_CLASSES).toBe(5);
  });

  it('returns the documented percentiles', () => {
    expect(CLASS_PERCENTILES).toEqual([0.5, 0.75, 0.9, 0.97]);
    const b = classBreaks(values);
    expect(b[0]).toBeCloseTo(50, 0);
    expect(b[1]).toBeCloseTo(75, 0);
    expect(b[2]).toBeCloseTo(90, 0);
    expect(b[3]).toBeCloseTo(97, 0);
  });

  it('is ascending', () => {
    const b = classBreaks(values);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThanOrEqual(b[i - 1]);
  });

  it('ignores zeros, which would otherwise drag every break to nothing', () => {
    const sparse = [...Array(900).fill(0), ...values];
    expect(classBreaks(sparse)[0]).toBeCloseTo(classBreaks(values)[0], 0);
  });

  it('returns zeros for an empty or all-zero input', () => {
    expect(classBreaks([])).toEqual([0, 0, 0, 0]);
    expect(classBreaks([0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it('accepts a Float32Array as well as a plain array', () => {
    expect(classBreaks(Float32Array.from(values))[0]).toBeCloseTo(50, 0);
  });
});

describe('classOf', () => {
  const breaks = [50, 75, 90, 97];

  it('paints nothing at or below zero', () => {
    expect(classOf(0, breaks)).toBe(-1);
    expect(classOf(-5, breaks)).toBe(-1);
  });

  it('assigns each band its class', () => {
    expect(classOf(1, breaks)).toBe(0);
    expect(classOf(49, breaks)).toBe(0);
    expect(classOf(60, breaks)).toBe(1);
    expect(classOf(80, breaks)).toBe(2);
    expect(classOf(95, breaks)).toBe(3);
    expect(classOf(1000, breaks)).toBe(4);
  });

  it('puts a value exactly on a break into the higher class', () => {
    expect(classOf(50, breaks)).toBe(1);
    expect(classOf(97, breaks)).toBe(4);
  });

  it('is monotone: a larger value never lands in a lower class', () => {
    let prev = -1;
    for (let v = 0.5; v < 200; v += 0.5) {
      const c = classOf(v, breaks);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('is invariant when value and breaks are rescaled together', () => {
    // The class is a rank, not an absolute magnitude — switching symbol or timeframe
    // multiplies every USD figure and must not change what reads as "hot".
    for (const k of [0.001, 7, 1e6]) {
      const scaled = breaks.map((b) => b * k);
      for (const v of [1, 49, 60, 80, 95, 1000]) {
        expect(classOf(v * k, scaled)).toBe(classOf(v, breaks));
      }
    }
  });

  it('puts everything in the top class when all breaks are zero', () => {
    expect(classOf(5, [0, 0, 0, 0])).toBe(4);
  });
});

describe('classAlpha', () => {
  it('is fully transparent for the no-paint class', () => {
    expect(classAlpha(-1)).toBe(0);
  });

  it('rises with class so the top band dominates', () => {
    let prev = -1;
    for (let c = 0; c < N_CLASSES; c++) {
      const a = classAlpha(c);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it('saturates at 255 for the heaviest class', () => {
    expect(classAlpha(N_CLASSES - 1)).toBe(255);
  });
});

describe('colormaps', () => {
  it('offers inferno as the default plus classic', () => {
    expect(colormapIds()).toEqual(['inferno', 'classic']);
  });

  it('defines every class in both ramps', () => {
    for (const id of colormapIds()) {
      expect(COLORMAPS[id].classColors).toHaveLength(N_CLASSES);
      expect(COLORMAPS[id].tierColors).toHaveLength(4);
      expect(COLORMAPS[id].hot).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('separates inferno classes by luminance so adjacent ones cannot blur', () => {
    const lums = COLORMAPS.inferno.classColors.map(luminance);
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]).toBeGreaterThan(lums[i - 1]);
      expect(lums[i] - lums[i - 1]).toBeGreaterThan(30);
    }
  });

  it('orders classic by hue, blue through red, not by luminance', () => {
    // Documented deliberate exception: traders read the blue→red ordering natively, and
    // ascending alpha carries the hierarchy instead.
    const [b, c, g, y, r] = COLORMAPS.classic.classColors;
    expect(b[2]).toBeGreaterThan(b[0]); // blue: more blue than red
    expect(g[1]).toBeGreaterThan(g[0]); // green: more green than red
    expect(y[0]).toBeGreaterThan(200); // yellow is bright
    expect(r[0]).toBeGreaterThan(r[1]); // red: more red than green
    expect(c[2]).toBeGreaterThan(c[0]); // cyan sits between blue and green
  });

  it('gives every colour channel a valid byte', () => {
    for (const id of colormapIds()) {
      for (const rgb of COLORMAPS[id].classColors) {
        for (const ch of rgb) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
