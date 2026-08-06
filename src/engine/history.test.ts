import { describe, it, expect } from 'vitest';
import { MAX_CANDLES, mergeOlder, needsOlder } from './history';
import type { Candle } from './types';

const H = 3_600_000;

function candle(start: number): Candle {
  return { start, open: 1, high: 1, low: 1, close: 1, volume: 1, turnover: 1 };
}

/** `count` candles ending just before `endExclusive`, oldest-first. */
function run(endExclusive: number, count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => candle(endExclusive - (count - i) * H));
}

describe('mergeOlder', () => {
  const existing = run(1000 * H, 100); // starts 900H .. 999H

  it('prepends older candles ahead of what is loaded', () => {
    const older = run(900 * H, 50); // 850H .. 899H
    const merged = mergeOlder(existing, older);

    expect(merged).toHaveLength(150);
    expect(merged[0].start).toBe(850 * H);
    expect(merged[merged.length - 1].start).toBe(999 * H);
  });

  it('keeps the result oldest-first', () => {
    const merged = mergeOlder(existing, run(900 * H, 50));
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i].start).toBeGreaterThan(merged[i - 1].start);
    }
  });

  it('drops duplicates where the pages overlap', () => {
    // Bybit's `end` is inclusive at the boundary, so pages can share candles.
    const overlapping = run(910 * H, 50); // 860H .. 909H, last 10 already loaded
    const merged = mergeOlder(existing, overlapping);

    expect(merged).toHaveLength(140);
    const starts = merged.map((c) => c.start);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('prefers the already-loaded copy of a duplicate', () => {
    const existingOne = [{ ...candle(5 * H), close: 42 }];
    const older = [{ ...candle(5 * H), close: 7 }];
    expect(mergeOlder(existingOne, older)[0].close).toBe(42);
  });

  it('is a no-op when the older page is empty', () => {
    expect(mergeOlder(existing, [])).toEqual(existing);
  });

  it('returns the older page when nothing is loaded yet', () => {
    expect(mergeOlder([], run(100 * H, 10))).toHaveLength(10);
  });

  it('truncates to the cap, keeping the newest candles', () => {
    const many = run(10_000 * H, MAX_CANDLES);
    const older = run(10_000 * H - MAX_CANDLES * H, 500);
    const merged = mergeOlder(many, older);

    expect(merged).toHaveLength(MAX_CANDLES);
    // The newest edge is where price is, so that is the end worth keeping.
    expect(merged[merged.length - 1].start).toBe(many[many.length - 1].start);
  });

  it('respects the cap when a partial page would exceed it', () => {
    const near = run(10_000 * H, MAX_CANDLES - 100);
    const merged = mergeOlder(near, run(10_000 * H - (MAX_CANDLES - 100) * H, 400));
    expect(merged).toHaveLength(MAX_CANDLES);
  });
});

describe('needsOlder', () => {
  it('asks for more once the view nears the left edge', () => {
    // c0 of 100 against 1000 columns is 10% in — inside the 15% trigger.
    expect(needsOlder(100, 1000)).toBe(true);
  });

  it('stays quiet while the view is well inside the data', () => {
    expect(needsOlder(600, 1000)).toBe(false);
  });

  it('fires when the view has been panned past the start', () => {
    expect(needsOlder(-50, 1000)).toBe(true);
  });

  it('does not fire on an empty dataset', () => {
    expect(needsOlder(0, 0)).toBe(false);
  });

  it('uses a proportional threshold, not a fixed column count', () => {
    // 15% of 5000 is 750, so 700 triggers while the same index would not at 1000 columns.
    expect(needsOlder(700, 5000)).toBe(true);
    expect(needsOlder(700, 1000)).toBe(false);
  });
});
