import { describe, it, expect } from 'vitest';
import { ANCHOR_WEIGHTS, CAPITAL_SPLIT, STANDING_SHARES, longLiqPrice, modeForInterval, seedSplit, shortLiqPrice, tiersForMode } from './tiers';

describe('mode selection', () => {
  it('treats short intervals as scalping', () => {
    expect(modeForInterval('5m')).toBe('scalping');
    expect(modeForInterval('15m')).toBe('scalping');
    expect(modeForInterval('1h')).toBe('scalping');
  });

  it('treats long intervals as swing', () => {
    expect(modeForInterval('4h')).toBe('swing');
    expect(modeForInterval('1d')).toBe('swing');
  });
});

describe('tier ladders', () => {
  it('uses high leverage for scalping and low for swing', () => {
    expect(tiersForMode('scalping')).toEqual([10, 25, 50, 100]);
    expect(tiersForMode('swing')).toEqual([3, 5, 10, 25]);
  });

  it('splits capital across four tiers summing to one', () => {
    expect(CAPITAL_SPLIT).toEqual([0.35, 0.3, 0.2, 0.15]);
    const total = CAPITAL_SPLIT.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('weights entry anchors close-heavy, summing to one', () => {
    expect(ANCHOR_WEIGHTS.close).toBe(0.45);
    expect(ANCHOR_WEIGHTS.high).toBe(0.275);
    expect(ANCHOR_WEIGHTS.low).toBe(0.275);
    const total = ANCHOR_WEIGHTS.close + ANCHOR_WEIGHTS.high + ANCHOR_WEIGHTS.low;
    expect(total).toBeCloseTo(1, 10);
  });
});

describe('liquidation price math', () => {
  it('puts a long liquidation below entry by 1/L', () => {
    expect(longLiqPrice(100, 10)).toBeCloseTo(90, 10);
    expect(longLiqPrice(100, 100)).toBeCloseTo(99, 10);
    expect(longLiqPrice(100, 3)).toBeCloseTo(66.6666667, 6);
  });

  it('puts a short liquidation above entry by 1/L', () => {
    expect(shortLiqPrice(100, 10)).toBeCloseTo(110, 10);
    expect(shortLiqPrice(100, 100)).toBeCloseTo(101, 10);
    expect(shortLiqPrice(100, 3)).toBeCloseTo(133.3333333, 6);
  });

  it('scales with entry price', () => {
    expect(longLiqPrice(64000, 25)).toBeCloseTo(64000 * 0.96, 6);
    expect(shortLiqPrice(64000, 25)).toBeCloseTo(64000 * 1.04, 6);
  });
});

describe('seedSplit — standing share to seed weights', () => {
  const HLS = [60, 30, 14, 5];

  it('sums to 1 for every declared standing split, so conservation holds', () => {
    for (const shares of Object.values(STANDING_SHARES)) {
      const w = seedSplit(shares, HLS);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });

  it("reproduces today's CAPITAL_SPLIT from the 'current' standing share", () => {
    // 'current' is defined as the standing split the legacy weights produce, so deriving
    // seed weights back from it must land on the legacy weights.
    const w = seedSplit(STANDING_SHARES.current, HLS);
    for (let t = 0; t < 4; t++) {
      expect(w[t]).toBeCloseTo(CAPITAL_SPLIT[t], 2);
    }
  });

  it('gives high-leverage tiers most of the seed under a flat standing target', () => {
    // Equal standing footprints need the fast-decaying tiers re-fed hardest.
    const w = seedSplit(STANDING_SHARES.flat, HLS);
    expect(w[3]).toBeGreaterThan(0.55); // 25x
    expect(w[0]).toBeLessThan(0.07); //   3x
  });

  it('actually produces the declared standing split at steady state', () => {
    for (const shares of Object.values(STANDING_SHARES)) {
      const w = seedSplit(shares, HLS);
      const standing = w.map((wt, t) => wt * HLS[t]); // ~ w / (1 - f) up to a shared const
      const total = standing.reduce((a, b) => a + b, 0);
      standing.forEach((st, t) => {
        expect(st / total).toBeCloseTo(shares[t] / shares.reduce((a, b) => a + b, 0), 6);
      });
    }
  });
});
