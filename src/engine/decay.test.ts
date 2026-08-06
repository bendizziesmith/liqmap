import { describe, it, expect } from 'vitest';
import {
  HALF_LIFE_DAYS,
  INTERVAL_DAYS,
  applyDecay,
  decayFactor,
  floorSparse,
  tierDecayFactors,
} from './decay';
import { tiersForMode } from './tiers';

describe('decayFactor', () => {
  it('halves the weight after exactly one half-life', () => {
    expect(decayFactor(5, 5)).toBe(0.5);
    expect(decayFactor(0.5, 0.5)).toBe(0.5);
  });

  it('carries 2^-N after N half-lives', () => {
    for (let n = 0; n <= 8; n++) {
      expect(decayFactor(n * 3, 3)).toBeCloseTo(Math.pow(2, -n), 12);
    }
  });

  it('leaves a level untouched when no time has passed', () => {
    expect(decayFactor(0, 14)).toBe(1);
  });

  it('never decays with a non-positive half-life, rather than dividing by zero', () => {
    expect(decayFactor(10, 0)).toBe(1);
    expect(decayFactor(10, -1)).toBe(1);
  });

  it('is multiplicative, so per-candle steps compose into the closed form', () => {
    // The engine applies one candle's factor at a time; N of them must equal one N-step.
    const perStep = decayFactor(1, 7);
    let acc = 1;
    for (let i = 0; i < 21; i++) acc *= perStep;
    expect(acc).toBeCloseTo(decayFactor(21, 7), 10);
  });
});

describe('tierDecayFactors', () => {
  it('gives every swing tier the documented half-life on a daily candle', () => {
    const tiers = tiersForMode('swing'); // [3, 5, 10, 25]
    const f = tierDecayFactors('swing', tiers, '1d');
    expect(f[0]).toBeCloseTo(Math.pow(2, -1 / 60), 12); // 3x, 60d
    expect(f[1]).toBeCloseTo(Math.pow(2, -1 / 30), 12); // 5x, 30d
    expect(f[2]).toBeCloseTo(Math.pow(2, -1 / 14), 12); // 10x, 14d
    expect(f[3]).toBeCloseTo(Math.pow(2, -1 / 5), 12); //  25x, 5d
  });

  it('scales the same half-life to the candle duration', () => {
    // A 4h candle is a sixth of a day, so a 5-day half-life decays a sixth as much per step.
    const daily = tierDecayFactors('swing', [25], '1d')[0];
    const fourHour = tierDecayFactors('swing', [25], '4h')[0];
    expect(Math.pow(fourHour, 6)).toBeCloseTo(daily, 10);
  });

  it('decays higher leverage faster, in every mode', () => {
    for (const mode of ['scalping', 'swing'] as const) {
      const tiers = tiersForMode(mode);
      const f = tierDecayFactors(mode, tiers, mode === 'swing' ? '1d' : '1h');
      for (let i = 1; i < f.length; i++) {
        // tiers ascend in leverage, so factors must descend (more decay per candle).
        expect(f[i]).toBeLessThan(f[i - 1]);
      }
    }
  });

  it('has a half-life for every tier the engine can build', () => {
    for (const mode of ['scalping', 'swing'] as const) {
      for (const t of tiersForMode(mode)) {
        expect(HALF_LIFE_DAYS[mode][t]).toBeGreaterThan(0);
      }
    }
  });

  it('holds a 100x scalping position for half a day', () => {
    expect(HALF_LIFE_DAYS.scalping[100]).toBe(0.5);
    expect(INTERVAL_DAYS['1h']).toBeCloseTo(1 / 24, 12);
  });
});

describe('applyDecay', () => {
  it('scales each tier by its own factor, in place', () => {
    const levels = [new Float32Array([4, 0, 8]), new Float32Array([10, 2, 0])];
    applyDecay(levels, [0.5, 0.25]);
    expect(Array.from(levels[0])).toEqual([2, 0, 4]);
    expect(Array.from(levels[1])).toEqual([2.5, 0.5, 0]);
  });

  it('leaves the vector untouched when every factor is 1', () => {
    const levels = [new Float32Array([1, 2, 3])];
    applyDecay(levels, [1]);
    expect(Array.from(levels[0])).toEqual([1, 2, 3]);
  });

  it('carries 2^-N after N applications, which is what a column N candles later shows', () => {
    const levels = [new Float32Array([1024])];
    const f = decayFactor(1, 2); // one candle, two-candle half-life
    for (let i = 0; i < 4; i++) applyDecay(levels, [f]);
    expect(levels[0][0]).toBeCloseTo(1024 * Math.pow(2, -4 / 2), 3);
  });
});

describe('floorSparse', () => {
  it('drops values below the relative floor and keeps the rest', () => {
    const levels = [new Float32Array([1e6, 0.5, 1e-3])];
    floorSparse(levels, 1e-6); // floor = 1
    expect(Array.from(levels[0])).toEqual([1e6, 0, 0]);
  });

  it('measures the floor against the largest value across all tiers, not per tier', () => {
    // A quiet tier must not have its own small values promoted just because it is quiet.
    const levels = [new Float32Array([1e6]), new Float32Array([0.5])];
    floorSparse(levels, 1e-6);
    expect(levels[1][0]).toBe(0);
  });

  it('never empties a column that has any mass at all', () => {
    const levels = [new Float32Array([3, 3, 3])];
    floorSparse(levels, 1e-6);
    expect(Array.from(levels[0])).toEqual([3, 3, 3]);
  });

  it('is a no-op on an all-zero column', () => {
    const levels = [new Float32Array(4)];
    floorSparse(levels, 1e-6);
    expect(Array.from(levels[0])).toEqual([0, 0, 0, 0]);
  });
});
