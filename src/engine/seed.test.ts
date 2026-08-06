import { describe, it, expect } from 'vitest';
import { clearRange, seedCandle, turnoverWeight } from './seed';
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

describe('turnoverWeight', () => {
  it('is the ratio of this candle to the median', () => {
    expect(turnoverWeight(200, 100)).toBe(2);
    expect(turnoverWeight(50, 100)).toBe(0.5);
  });

  it('clamps outsized turnover at five', () => {
    expect(turnoverWeight(10_000, 100)).toBe(5);
  });

  it('falls back to one when the median is zero', () => {
    expect(turnoverWeight(100, 0)).toBe(1);
  });
});

describe('seedCandle', () => {
  // Anchors chosen so that no two deposits share a bucket: a collision would make the
  // per-deposit assertions below read a sum instead of the individual amount.
  const SEEDED = candle(100, 115, 90, 104, 100);
  const grid = buildGrid([SEEDED], 3);

  it('deposits at both liquidation sides of all three anchors for every tier', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, SEEDED, 100, 1);

    TIERS.forEach((lev, ti) => {
      for (const [anchor, entry] of [
        ['close', SEEDED.close],
        ['high', SEEDED.high],
        ['low', SEEDED.low],
      ] as const) {
        const w = ANCHOR_WEIGHTS[anchor] * CAPITAL_SPLIT[ti];
        expect(levels[ti][priceToBucket(grid, longLiqPrice(entry, lev))]).toBeCloseTo(w, 5);
        expect(levels[ti][priceToBucket(grid, shortLiqPrice(entry, lev))]).toBeCloseTo(w, 5);
      }
    });
  });

  it('deposits each tier its share of capital across both sides, whatever the anchors', () => {
    const levels = makeLevels();
    seedCandle(levels, grid, TIERS, SEEDED, 100, 1);

    // Anchor weights sum to 1 and both sides get the full amount, so a tier's total mass is
    // exactly 2x its capital share. Holds even when deposits collide into one bucket.
    TIERS.forEach((_, ti) => {
      const total = levels[ti].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(2 * CAPITAL_SPLIT[ti], 5);
    });
  });

  it('scales every deposit by the turnover weight', () => {
    const a = makeLevels();
    const b = makeLevels();
    const c = candle(100, 120, 90, 110, 100);
    seedCandle(a, grid, TIERS, c, 100, 1); // turnover == median => weight 1
    seedCandle(b, grid, TIERS, c, 50, 1); //  turnover == 2x median => weight 2

    const bucket = priceToBucket(grid, longLiqPrice(110, TIERS[0]));
    expect(b[0][bucket]).toBeCloseTo(a[0][bucket] * 2, 5);
  });

  it('scales every deposit by the OI factor', () => {
    const a = makeLevels();
    const b = makeLevels();
    const c = candle(100, 120, 90, 110, 100);
    seedCandle(a, grid, TIERS, c, 100, 1);
    seedCandle(b, grid, TIERS, c, 100, 2.5);

    const bucket = priceToBucket(grid, shortLiqPrice(110, TIERS[2]));
    expect(b[2][bucket]).toBeCloseTo(a[2][bucket] * 2.5, 5);
  });

  it('accumulates rather than overwriting when two anchors collide', () => {
    const levels = makeLevels();
    // A doji: all three anchors are the same price, so every deposit lands together.
    const c = candle(110, 110, 110, 110, 100);
    seedCandle(levels, grid, TIERS, c, 100, 1);

    const bucket = priceToBucket(grid, longLiqPrice(110, TIERS[0]));
    expect(levels[0][bucket]).toBeCloseTo(CAPITAL_SPLIT[0], 5);
  });
});
