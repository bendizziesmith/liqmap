import { describe, it, expect } from 'vitest';
import {
  modeForInterval,
  tiersForMode,
  CAPITAL_SPLIT,
  ANCHOR_WEIGHTS,
  longLiqPrice,
  shortLiqPrice,
} from './tiers';

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
