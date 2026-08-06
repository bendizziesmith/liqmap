import { describe, it, expect } from 'vitest';
import { buildHeatmap, reseedLast, valueAt } from './build';
import { priceToBucket } from './grid';
import { longLiqPrice } from './tiers';
import { clearRange, seedCandle } from './seed';
import { oiFactors } from './oi';
import type { Candle, Interval } from './types';

const H = 3_600_000;

function candle(i: number, o: number, h: number, l: number, c: number, turnover = 100): Candle {
  return { start: i * H, open: o, high: h, low: l, close: c, volume: 1, turnover };
}

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

describe('estimated USD conservation', () => {
  it('puts exactly the candle turnover into the grid when nothing is cleared', () => {
    // One candle: the clearing pass has nothing to erase, so every dollar it seeds survives.
    const only = candle(0, 100, 115, 90, 104, 5_000_000);
    const map = buildHeatmap([only], [], '4h');

    let total = 0;
    for (const m of map.matrices) for (const v of m) total += v;
    expect(total).toBeCloseTo(only.turnover, 0);
  });

  it('sums multiple untouched candles to their combined turnover', () => {
    // Two dojis far enough apart that neither clears the other's levels.
    const a = candle(0, 100, 100, 100, 100, 1_000_000);
    const b = candle(1, 400, 400, 400, 400, 3_000_000);
    const map = buildHeatmap([a, b], [], '4h');

    let total = 0;
    const offset = (map.nCols - 1) * map.grid.nBuckets;
    for (const m of map.matrices) {
      for (let i = offset; i < offset + map.grid.nBuckets; i++) total += m[i];
    }
    expect(total).toBeCloseTo(a.turnover + b.turnover, -2);
  });

  it('scales the whole grid with the OI factor', () => {
    const only = [candle(0, 100, 100, 100, 100, 1_000_000), candle(1, 100, 100, 100, 100, 1_000_000)];
    const flat = buildHeatmap(only, [], '4h');
    const rising = buildHeatmap(
      only,
      [
        { timestamp: 0, openInterest: 100 },
        { timestamp: H, openInterest: 150 },
      ],
      '4h',
    );
    const sum = (m: typeof flat) => {
      let t = 0;
      for (const mat of m.matrices) for (const v of mat) t += v;
      return t;
    };
    expect(sum(rising)).toBeGreaterThan(sum(flat));
  });
});

describe('reseedLast', () => {
  const history = [
    candle(0, 100, 100, 100, 100, 1_000_000),
    candle(1, 100, 101, 99, 100, 1_000_000),
    candle(2, 100, 101, 99, 100, 1_000_000),
  ];

  it('reproduces a full rebuild when handed the same final candle', () => {
    const map = buildHeatmap(history, [], '4h');
    const same = reseedLast(map, history[2]);

    const offset = (map.nCols - 1) * map.grid.nBuckets;
    for (let t = 0; t < map.tiers.length; t++) {
      for (let b = 0; b < map.grid.nBuckets; b++) {
        expect(same.matrices[t][offset + b]).toBeCloseTo(map.matrices[t][offset + b], 3);
      }
    }
  });

  it('matches a rebuild when the forming candle has moved inside the existing range', () => {
    const map = buildHeatmap(history, [], '4h');
    // Stays within [99, 101], so the grid is identical and the two are comparable.
    const moved = { ...history[2], close: 100.8 };

    const incremental = reseedLast(map, moved);
    const rebuilt = buildHeatmap([history[0], history[1], moved], [], '4h');

    const offset = (map.nCols - 1) * map.grid.nBuckets;
    for (let t = 0; t < map.tiers.length; t++) {
      for (let b = 0; b < map.grid.nBuckets; b++) {
        expect(incremental.matrices[t][offset + b]).toBeCloseTo(
          rebuilt.matrices[t][offset + b],
          3,
        );
      }
    }
  });

  it('clears a level once the forming candle trades through it', () => {
    const map = buildHeatmap(history, [], '4h');
    const ti = map.tiers.indexOf(10);
    const bucket = priceToBucket(map.grid, longLiqPrice(100, 10)); // 90
    expect(valueAt(map, ti, 2, bucket)).toBeGreaterThan(0);

    // The forming candle wicks down through 90. Close moves to 96 as well, otherwise its
    // own close of 100 would re-seed a 10x long right back onto 90.
    const swept = reseedLast(map, { ...history[2], low: 85, close: 96 });
    expect(valueAt(swept, ti, 2, bucket)).toBe(0);
  });

  it('keeps the original grid when a forming candle breaks the price range', () => {
    // Documented limitation: rebucketing every column is a full rebuild's job, so callers
    // refetch on candle confirm rather than letting the axis silently shift mid-tick.
    const map = buildHeatmap(history, [], '4h');
    const breakout = reseedLast(map, { ...history[2], high: 400 });
    expect(breakout.grid).toEqual(map.grid);
  });

  it('leaves earlier columns untouched', () => {
    const map = buildHeatmap(history, [], '4h');
    const swept = reseedLast(map, { ...history[2], low: 80, high: 120 });

    for (let t = 0; t < map.tiers.length; t++) {
      for (let col = 0; col < map.nCols - 1; col++) {
        for (const b of [100, 400, 700, 1000]) {
          expect(valueAt(swept, t, col, b)).toBe(valueAt(map, t, col, b));
        }
      }
    }
  });

  it('returns a new object so React sees a change', () => {
    const map = buildHeatmap(history, [], '4h');
    expect(reseedLast(map, history[2])).not.toBe(map);
  });

  it('is a no-op on an empty map', () => {
    const empty = buildHeatmap([], [], '4h');
    expect(reseedLast(empty, history[0])).toBe(empty);
  });
});

describe('level decay', () => {
  /**
   * Candle 0 deposits a book at price 100. Every later candle sits at 200 with zero
   * turnover, so it seeds nothing and its [200, 200] range clears nothing candle 0 created.
   * Whatever happens to those levels afterwards is decay and nothing else.
   */
  const aged = (n: number, interval: Interval = '1d') => [
    candle(0, 100, 100, 100, 100, 1_000_000),
    ...Array.from({ length: n }, (_, i) => candle(i + 1, 200, 200, 200, 200, 0)),
  ].map((c, i) => ({ ...c, start: i * (interval === '1d' ? 24 * H : 4 * H) }));

  it('leaves the seeding candle at full weight — decay ages the book, not the new entry', () => {
    const map = buildHeatmap(aged(0), [], '1d', { decay: true });
    let total = 0;
    for (const m of map.matrices) for (const v of m) total += v;
    expect(total).toBeCloseTo(1_000_000, 0);
  });

  it('carries 2^-N after N half-lives, exactly', () => {
    // Swing 25x has a 5-day half-life, so on daily candles 5 columns is one half-life.
    const map = buildHeatmap(aged(10), [], '1d', { decay: true });
    const ti = map.tiers.indexOf(25);
    const b = priceToBucket(map.grid, 100 * (1 + 1 / 25));

    const seeded = valueAt(map, ti, 0, b);
    expect(seeded).toBeGreaterThan(0);
    expect(valueAt(map, ti, 5, b) / seeded).toBeCloseTo(0.5, 6);
    expect(valueAt(map, ti, 10, b) / seeded).toBeCloseTo(0.25, 6);
  });

  it('fades a level a little more in every successive column', () => {
    const map = buildHeatmap(aged(6), [], '4h', { decay: true });
    const ti = map.tiers.indexOf(10);
    const b = priceToBucket(map.grid, 100 * (1 + 1 / 10));
    for (let col = 1; col <= 6; col++) {
      expect(valueAt(map, ti, col, b)).toBeLessThan(valueAt(map, ti, col - 1, b));
    }
  });

  it('ages each tier at its own rate, highest leverage fastest', () => {
    const map = buildHeatmap(aged(8), [], '1d', { decay: true });
    const survived = map.tiers.map((t, ti) => {
      const b = priceToBucket(map.grid, 100 * (1 + 1 / t));
      return valueAt(map, ti, 8, b) / valueAt(map, ti, 0, b);
    });
    for (let i = 1; i < survived.length; i++) {
      expect(survived[i]).toBeLessThan(survived[i - 1]);
    }
  });

  it('does not resurrect a swept level — clearing still wins', () => {
    const swept = [
      candle(0, 100, 100, 100, 100, 1_000_000),
      candle(1, 100, 101, 85, 95, 1_000_000), // trades through the 10x long at 90
    ];
    const map = buildHeatmap(swept, [], '1d', { decay: true });
    const ti = map.tiers.indexOf(10);
    expect(valueAt(map, ti, 1, priceToBucket(map.grid, longLiqPrice(100, 10)))).toBe(0);
  });

  it('keeps the matrices sparse by flooring negligible values to zero', () => {
    const long = aged(120);
    const decayed = buildHeatmap(long, [], '1d', { decay: true });
    const plain = buildHeatmap(long, [], '1d');
    const nonZero = (m: typeof plain) => {
      let n = 0;
      for (const mat of m.matrices) for (const v of mat) if (v !== 0) n++;
      return n;
    };
    expect(nonZero(decayed)).toBeLessThan(nonZero(plain));
  });

  it('reproduces the undecayed walk bit-for-bit when switched off', () => {
    // The old algorithm, replayed by hand: clear, then seed, nothing else.
    const candles = [
      candle(0, 100, 103, 97, 101, 900_000),
      candle(1, 101, 108, 99, 107, 1_400_000),
      candle(2, 107, 110, 92, 94, 2_100_000),
      candle(3, 94, 99, 88, 97, 700_000),
    ];
    const map = buildHeatmap(candles, [], '1d', { decay: false });

    const levels = map.tiers.map(() => new Float32Array(map.grid.nBuckets));
    const factors = oiFactors(candles, []);
    for (let i = 0; i < candles.length; i++) {
      clearRange(levels, map.grid, candles[i].low, candles[i].high);
      seedCandle(levels, map.grid, map.tiers, candles[i], factors[i]);
      for (let t = 0; t < map.tiers.length; t++) {
        for (let b = 0; b < map.grid.nBuckets; b++) {
          expect(valueAt(map, t, i, b)).toBe(levels[t][b]);
        }
      }
    }
  });

  it('defaults to off, so the engine applies no modelling assumption unasked', () => {
    const candles = aged(4);
    const explicit = buildHeatmap(candles, [], '1d', { decay: false });
    const implicit = buildHeatmap(candles, [], '1d');
    for (let t = 0; t < explicit.tiers.length; t++) {
      expect(Array.from(implicit.matrices[t])).toEqual(Array.from(explicit.matrices[t]));
    }
  });

  it('actually changes the output when switched on', () => {
    const candles = aged(4);
    const on = buildHeatmap(candles, [], '1d', { decay: true });
    const off = buildHeatmap(candles, [], '1d', { decay: false });
    const last = (m: typeof on) => {
      let s = 0;
      const offset = (m.nCols - 1) * m.grid.nBuckets;
      for (const mat of m.matrices) for (let i = offset; i < offset + m.grid.nBuckets; i++) s += mat[i];
      return s;
    };
    expect(last(on)).toBeLessThan(last(off) * 0.99);
  });

  it('keeps reseedLast consistent with a full decayed rebuild', () => {
    const history = [
      candle(0, 100, 100, 100, 100, 1_000_000),
      candle(1, 100, 101, 99, 100, 1_000_000),
      candle(2, 100, 101, 99, 100, 1_000_000),
    ];
    const map = buildHeatmap(history, [], '1d', { decay: true });
    const moved = { ...history[2], close: 100.8 };

    const incremental = reseedLast(map, moved);
    const rebuilt = buildHeatmap([history[0], history[1], moved], [], '1d', { decay: true });

    const offset = (map.nCols - 1) * map.grid.nBuckets;
    for (let t = 0; t < map.tiers.length; t++) {
      for (let b = 0; b < map.grid.nBuckets; b++) {
        expect(incremental.matrices[t][offset + b]).toBeCloseTo(rebuilt.matrices[t][offset + b], 3);
      }
    }
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
