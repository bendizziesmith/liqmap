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
        expect(levels[ti][priceToBucket(grid, longLiqPrice(entry, lev))]).toBeCloseTo(half, 2);
        expect(levels[ti][priceToBucket(grid, shortLiqPrice(entry, lev))]).toBeCloseTo(half, 2);
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

    const bucket = priceToBucket(grid, longLiqPrice(110, TIERS[0]));
    expect(levels[0][bucket]).toBeCloseTo((c.turnover * CAPITAL_SPLIT[0]) / 2, 2);
  });

  it('deposits nothing for a zero-turnover candle', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, candle(100, 115, 90, 104, 0), 1);
    for (const tier of levels) expect(tier.every((v) => v === 0)).toBe(true);
  });
});
