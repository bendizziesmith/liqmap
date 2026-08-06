import { describe, it, expect } from 'vitest';
import { alignOi, oiFactors } from './oi';
import type { Candle, OiPoint } from './types';

function candle(start: number): Candle {
  return { start, open: 1, high: 1, low: 1, close: 1, volume: 1, turnover: 1 };
}

const H = 3_600_000;

describe('alignOi', () => {
  it('matches OI samples to candles sharing a timestamp', () => {
    const candles = [candle(0), candle(H), candle(2 * H)];
    const oi: OiPoint[] = [
      { timestamp: 0, openInterest: 100 },
      { timestamp: H, openInterest: 110 },
      { timestamp: 2 * H, openInterest: 120 },
    ];
    expect(Array.from(alignOi(candles, oi))).toEqual([100, 110, 120]);
  });

  it('forward-fills a candle with no matching OI sample', () => {
    const candles = [candle(0), candle(H), candle(2 * H)];
    const oi: OiPoint[] = [
      { timestamp: 0, openInterest: 100 },
      { timestamp: 2 * H, openInterest: 120 },
    ];
    expect(Array.from(alignOi(candles, oi))).toEqual([100, 100, 120]);
  });

  it('back-fills leading candles that precede all OI samples', () => {
    const candles = [candle(0), candle(H)];
    const oi: OiPoint[] = [{ timestamp: H, openInterest: 55 }];
    expect(Array.from(alignOi(candles, oi))).toEqual([55, 55]);
  });

  it('returns zeros when there is no OI data at all', () => {
    expect(Array.from(alignOi([candle(0), candle(H)], []))).toEqual([0, 0]);
  });
});

describe('oiFactors', () => {
  const candles = [candle(0), candle(H), candle(2 * H)];

  it('amplifies when open interest is rising', () => {
    const oi: OiPoint[] = [
      { timestamp: 0, openInterest: 100 },
      { timestamp: H, openInterest: 108 },
      { timestamp: 2 * H, openInterest: 108 },
    ];
    const f = oiFactors(candles, oi);
    // delta 8 against current OI 108 => 1 + 8 * (8/108)
    expect(f[1]).toBeCloseTo(1 + 8 * (8 / 108), 8);
  });

  it('never discounts below one when open interest falls', () => {
    const oi: OiPoint[] = [
      { timestamp: 0, openInterest: 200 },
      { timestamp: H, openInterest: 100 },
      { timestamp: 2 * H, openInterest: 50 },
    ];
    const f = oiFactors(candles, oi);
    expect(f[1]).toBe(1);
    expect(f[2]).toBe(1);
  });

  it('clamps explosive open-interest growth at three', () => {
    const oi: OiPoint[] = [
      { timestamp: 0, openInterest: 1 },
      { timestamp: H, openInterest: 1000 },
      { timestamp: 2 * H, openInterest: 1000 },
    ];
    expect(oiFactors(candles, oi)[1]).toBe(3);
  });

  it('is neutral for the first candle, which has no previous sample', () => {
    const oi: OiPoint[] = [
      { timestamp: 0, openInterest: 100 },
      { timestamp: H, openInterest: 200 },
      { timestamp: 2 * H, openInterest: 200 },
    ];
    expect(oiFactors(candles, oi)[0]).toBe(1);
  });

  it('degrades to a neutral factor when OI data is missing', () => {
    expect(Array.from(oiFactors(candles, []))).toEqual([1, 1, 1]);
  });
});
