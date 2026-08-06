import { describe, it, expect } from 'vitest';
import { buildHeatmap, medianOf, valueAt } from './build';
import { priceToBucket } from './grid';
import { longLiqPrice } from './tiers';
import type { Candle } from './types';

const H = 3_600_000;

function candle(i: number, o: number, h: number, l: number, c: number, turnover = 100): Candle {
  return { start: i * H, open: o, high: h, low: l, close: c, volume: 1, turnover };
}

describe('medianOf', () => {
  it('takes the middle value of an odd-length series', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values of an even-length series', () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns zero for an empty series', () => {
    expect(medianOf([])).toBe(0);
  });
});

describe('buildHeatmap shape', () => {
  const candles = [candle(0, 100, 101, 99, 100), candle(1, 100, 102, 98, 101)];
  const map = buildHeatmap(candles, [], '4h');

  it('produces one matrix per tier', () => {
    expect(map.tiers).toEqual([3, 5, 10, 25]);
    expect(map.matrices).toHaveLength(4);
  });

  it('produces one column per candle', () => {
    expect(map.nCols).toBe(2);
    for (const m of map.matrices) {
      expect(m.length).toBe(map.nCols * map.grid.nBuckets);
    }
  });

  it('selects the tier ladder from the interval', () => {
    expect(buildHeatmap(candles, [], '15m').tiers).toEqual([10, 25, 50, 100]);
  });

  it('returns an empty map rather than throwing when given no candles', () => {
    const empty = buildHeatmap([], [], '4h');
    expect(empty.nCols).toBe(0);
    expect(empty.matrices).toHaveLength(4);
  });
});

describe('the clearing rule', () => {
  /**
   * The invariant the whole chart rests on. Candle 0 seeds a 10x long liquidation at
   * 100 * 0.9 = 90. Candles 1 and 2 stay well above it, so it must persist. Candle 3
   * trades down through 90, so from that column onward the level must be gone.
   */
  const candles = [
    candle(0, 100, 100, 100, 100), // doji at 100 -> seeds 10x long liq at exactly 90
    candle(1, 100, 101, 99, 100),
    candle(2, 100, 101, 99, 100),
    candle(3, 100, 101, 85, 95), // range [85, 101] swallows 90
  ];

  const map = buildHeatmap(candles, [], '4h');
  const tierIndex = map.tiers.indexOf(10);
  const liqPrice = longLiqPrice(100, 10);
  const bucket = priceToBucket(map.grid, liqPrice);

  it('seeds the level in the candle that created it', () => {
    expect(valueAt(map, tierIndex, 0, bucket)).toBeGreaterThan(0);
  });

  it('keeps the level alive while price stays away from it', () => {
    expect(valueAt(map, tierIndex, 1, bucket)).toBeGreaterThan(0);
    expect(valueAt(map, tierIndex, 2, bucket)).toBeGreaterThan(0);
  });

  it('zeroes the level in the column whose candle traded through it', () => {
    expect(valueAt(map, tierIndex, 3, bucket)).toBe(0);
  });

  it('leaves untouched levels above the sweep intact', () => {
    // The 10x short liquidation from candle 0 sits at 110, far above every later high.
    const shortBucket = priceToBucket(map.grid, 110);
    expect(valueAt(map, tierIndex, 3, shortBucket)).toBeGreaterThan(0);
  });

  it('clears before seeding, so a level the same candle creates inside its own range dies', () => {
    // A 100x long from a candle at close 100 lands at 99, inside that candle's own [98, 102]
    // range. Clearing happens first, so the level is seeded and survives its own candle.
    const fast = buildHeatmap([candle(0, 100, 102, 98, 100)], [], '5m');
    const ti = fast.tiers.indexOf(100);
    const b = priceToBucket(fast.grid, longLiqPrice(100, 100));
    expect(valueAt(fast, ti, 0, b)).toBeGreaterThan(0);
  });
});

describe('candle ordering', () => {
  it('processes oldest-first regardless of nothing else changing', () => {
    const rising = [
      candle(0, 100, 100, 100, 100),
      candle(1, 100, 120, 100, 120),
      candle(2, 120, 140, 120, 140),
    ];
    const map = buildHeatmap(rising, [], '4h');
    expect(map.candles[0].start).toBe(0);
    expect(map.candles[2].start).toBe(2 * H);
  });

  it('sweeps out levels as price trends up through them', () => {
    const rising = [
      candle(0, 100, 100, 100, 100), // 5x short liq at 120
      // Trades through 120, and none of its own 5x deposits (82.4, 104, 106.4, 123.6,
      // 156, 159.6) land back on it, so the level stays dead.
      candle(1, 100, 133, 103, 130),
      candle(2, 130, 150, 128, 148),
    ];
    const map = buildHeatmap(rising, [], '4h');
    const ti = map.tiers.indexOf(5);
    const b = priceToBucket(map.grid, 120);
    expect(valueAt(map, ti, 0, b)).toBeGreaterThan(0);
    expect(valueAt(map, ti, 1, b)).toBe(0);
  });

  it('re-seeds a swept level when the sweeping candle implies it again', () => {
    // Candle 1 clears 120 and then immediately re-creates it: its own low of 100 is a 5x
    // short entry liquidating at exactly 120. Clearing is not a veto on the current candle.
    const rising = [candle(0, 100, 100, 100, 100), candle(1, 100, 140, 100, 140)];
    const map = buildHeatmap(rising, [], '4h');
    const ti = map.tiers.indexOf(5);
    const b = priceToBucket(map.grid, 120);
    expect(valueAt(map, ti, 1, b)).toBeGreaterThan(0);
  });
});

describe('open interest participation', () => {
  it('weights a candle more heavily when open interest is climbing', () => {
    const candles = [candle(0, 100, 100, 100, 100), candle(1, 100, 100, 100, 100)];
    const flat = buildHeatmap(candles, [], '4h');
    const rising = buildHeatmap(
      candles,
      [
        { timestamp: 0, openInterest: 100 },
        { timestamp: H, openInterest: 150 },
      ],
      '4h',
    );

    const b = priceToBucket(flat.grid, longLiqPrice(100, 3));
    expect(valueAt(rising, 0, 1, b)).toBeGreaterThan(valueAt(flat, 0, 1, b));
  });
});
