import { describe, it, expect } from 'vitest';
import { clearRange, seedCandle } from './seed';
import { buildGrid, priceToBucket, N_BUCKETS } from './grid';
import { CAPITAL_SPLIT, ANCHOR_WEIGHTS, longLiqPrice, shortLiqPrice } from './tiers';
import type { Candle } from './types';

const TIERS = [3, 5, 10, 25];

function makeLevels(): Float32Array[] {
  return TIERS.map(() => new Float32Array(N_BUCKETS));
}

function candle(o: number, h: number, l: number, c: number, turnover = 1): Candle {
  return { start: 0, open: o, high: h, low: l, close: c, volume: 1, turnover };
}

describe('clearRange', () => {
  it('zeros exactly the buckets inside the range and leaves neighbours intact', () => {
    const grid = buildGrid([candle(100, 200, 100, 200)], 3);
    const levels = makeLevels();
    levels.forEach((l) => l.fill(7));

    clearRange(levels, grid, 120, 140);

    const lo = priceToBucket(grid, 120);
    const hi = priceToBucket(grid, 140);
    for (const l of levels) {
      expect(l[lo - 1]).toBe(7);
      expect(l[lo]).toBe(0);
      expect(l[hi]).toBe(0);
      expect(l[hi + 1]).toBe(7);
    }
  });

  it('clears every tier, not just the first', () => {
    const grid = buildGrid([candle(100, 200, 100, 200)], 3);
    const levels = makeLevels();
    levels.forEach((l) => l.fill(3));
    clearRange(levels, grid, 150, 150);
    const b = priceToBucket(grid, 150);
    for (const l of levels) expect(l[b]).toBe(0);
  });
});

describe('seedCandle deposits estimated USD notional', () => {
  // Anchors chosen so that no two deposits share a bucket: a collision would make the
  // per-deposit assertions below read a sum instead of the individual amount.
  const SEEDED = candle(100, 115, 90, 104, 1_000_000);
  const grid = buildGrid([SEEDED], 3);

  /**
   * A whole level, summed across the kernel it is spread over.
   *
   * Each level occupies its centre bucket and one either side, so reading the centre alone
   * reports half the deposit. These assertions are about how much notional a level carries,
   * not about how it is distributed within itself — that is the kernel's own describe block.
   */
  const levelAt = (tier: Float32Array, price: number): number => {
    // Clamped the same way the kernel clamps, and over *distinct* buckets: the grid is
    // padded to exactly the lowest tier's liquidation distance, so that tier's level from
    // the high anchor sits on the very last bucket and two kernel taps fold onto it.
    const b = priceToBucket(grid, price);
    const touched = new Set<number>();
    for (let k = -1; k <= 1; k++) {
      touched.add(Math.min(N_BUCKETS - 1, Math.max(0, b + k)));
    }
    let sum = 0;
    for (const i of touched) sum += tier[i];
    return sum;
  };

  it('splits each candle-anchor-tier amount evenly across the two liquidation sides', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, SEEDED, 1);

    TIERS.forEach((lev, ti) => {
      for (const [anchor, entry] of [
        ['close', SEEDED.close],
        ['high', SEEDED.high],
        ['low', SEEDED.low],
      ] as const) {
        // Half to the long side, half to the short: the turnover is the notional that
        // traded, and it opened both longs and shorts.
        const half = (SEEDED.turnover * ANCHOR_WEIGHTS[anchor] * CAPITAL_SPLIT[ti]) / 2;
        expect(levelAt(levels[ti], longLiqPrice(entry, lev))).toBeCloseTo(half, 2);
        expect(levelAt(levels[ti], shortLiqPrice(entry, lev))).toBeCloseTo(half, 2);
      }
    });
  });

  it('conserves the candle turnover across all buckets', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, SEEDED, 1);

    let total = 0;
    for (const tier of levels) for (const v of tier) total += v;
    expect(total).toBeCloseTo(SEEDED.turnover, 0);
  });

  it('scales linearly with turnover, with no median normalisation', () => {
    const a = makeLevels();
    const b = makeLevels();
    seedCandle(a, grid, TIERS, candle(100, 115, 90, 104, 1_000_000), 1);
    seedCandle(b, grid, TIERS, candle(100, 115, 90, 104, 3_000_000), 1);

    const bucket = priceToBucket(grid, longLiqPrice(104, TIERS[0]));
    expect(b[0][bucket]).toBeCloseTo(a[0][bucket] * 3, 2);
  });

  it('has no upper clamp: a hundredfold candle deposits a hundredfold', () => {
    const a = makeLevels();
    const b = makeLevels();
    seedCandle(a, grid, TIERS, candle(100, 115, 90, 104, 1_000_000), 1);
    seedCandle(b, grid, TIERS, candle(100, 115, 90, 104, 100_000_000), 1);

    const bucket = priceToBucket(grid, longLiqPrice(104, TIERS[0]));
    expect(b[0][bucket] / a[0][bucket]).toBeCloseTo(100, 4);
  });

  it('scales every deposit by the OI factor', () => {
    const a = makeLevels();
    const b = makeLevels();
    seedCandle(a, grid, TIERS, SEEDED, 1);
    seedCandle(b, grid, TIERS, SEEDED, 2.5);

    const bucket = priceToBucket(grid, shortLiqPrice(104, TIERS[2]));
    expect(b[2][bucket]).toBeCloseTo(a[2][bucket] * 2.5, 2);
  });

  it('gives each tier its share of the notional across both sides', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, SEEDED, 1);

    TIERS.forEach((_, ti) => {
      const total = levels[ti].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(SEEDED.turnover * CAPITAL_SPLIT[ti], 1);
    });
  });

  it('accumulates rather than overwriting when two anchors collide', () => {
    const levels = makeLevels();
    // A doji: all three anchors are the same price, so every deposit lands together.
    const c = candle(110, 110, 110, 110, 1_000_000);
    seedCandle(levels, grid, TIERS, c, 1);

    expect(levelAt(levels[0], longLiqPrice(110, TIERS[0]))).toBeCloseTo(
      (c.turnover * CAPITAL_SPLIT[0]) / 2,
      2,
    );
  });

  it('deposits nothing for a zero-turnover candle', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, candle(100, 115, 90, 104, 0), 1);
    for (const tier of levels) expect(tier.every((v) => v === 0)).toBe(true);
  });
});

describe('the seed kernel', () => {
  /** A doji: one price, so every anchor coincides and each tier gets one clean deposit. */
  const doji = candle(100, 100, 100, 100, 1_000_000);
  const grid = buildGrid([candle(50, 200, 50, 200)], 3);

  it('spreads a level over three buckets instead of one', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, doji, 1);

    const ti = TIERS.indexOf(10);
    const b = priceToBucket(grid, longLiqPrice(100, 10));
    expect(levels[ti][b - 1]).toBeGreaterThan(0);
    expect(levels[ti][b]).toBeGreaterThan(0);
    expect(levels[ti][b + 1]).toBeGreaterThan(0);
    expect(levels[ti][b - 2]).toBe(0);
    expect(levels[ti][b + 2]).toBe(0);
  });

  it('weights the centre at twice each shoulder', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, doji, 1);

    const ti = TIERS.indexOf(10);
    const b = priceToBucket(grid, longLiqPrice(100, 10));
    expect(levels[ti][b - 1]).toBeCloseTo(levels[ti][b + 1], 4);
    expect(levels[ti][b]).toBeCloseTo(2 * levels[ti][b - 1], 4);
  });

  it('puts half the level on the centre and a quarter on each shoulder', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, doji, 1);

    const ti = TIERS.indexOf(10);
    const b = priceToBucket(grid, longLiqPrice(100, 10));
    const whole = levels[ti][b - 1] + levels[ti][b] + levels[ti][b + 1];
    expect(levels[ti][b] / whole).toBeCloseTo(0.5, 6);
    expect(levels[ti][b - 1] / whole).toBeCloseTo(0.25, 6);
    expect(levels[ti][b + 1] / whole).toBeCloseTo(0.25, 6);
  });

  it('conserves the candle turnover exactly, which is the whole point', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, candle(100, 115, 90, 104, 5_000_000), 1);

    let total = 0;
    for (const l of levels) for (const v of l) total += v;
    expect(total).toBeCloseTo(5_000_000, 0);
  });

  it('folds the overhanging share back in at the grid edges rather than losing it', () => {
    // A level landing on bucket 0 has no left neighbour; its share must not vanish.
    const tight = buildGrid([candle(100, 100, 100, 100)], 3);
    const levels = makeLevels();
    seedCandle(levels, tight, TIERS, doji, 1);

    let total = 0;
    for (const l of levels) for (const v of l) total += v;
    expect(total).toBeCloseTo(1_000_000, 0);

    // The 3x long liquidation sits exactly on the grid floor.
    const ti = TIERS.indexOf(3);
    expect(levels[ti][0]).toBeGreaterThan(0);
  });

  it('still lands the level at the liquidation price, not beside it', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, doji, 1);

    for (const t of TIERS) {
      const ti = TIERS.indexOf(t);
      for (const price of [longLiqPrice(100, t), shortLiqPrice(100, t)]) {
        const b = priceToBucket(grid, price);
        // The centre bucket is the peak of its own three.
        expect(levels[ti][b]).toBeGreaterThanOrEqual(levels[ti][b - 1]);
        expect(levels[ti][b]).toBeGreaterThanOrEqual(levels[ti][b + 1]);
      }
    }
  });

  it('keeps the tier split intact once each level is summed across its kernel', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, doji, 1);

    const totals = levels.map((l) => l.reduce((a, b) => a + b, 0));
    const grand = totals.reduce((a, b) => a + b, 0);
    for (let t = 0; t < TIERS.length; t++) {
      expect(totals[t] / grand).toBeCloseTo(CAPITAL_SPLIT[t], 5);
    }
    expect(ANCHOR_WEIGHTS.close).toBe(0.45);
  });
});
