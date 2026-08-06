import { describe, it, expect } from 'vitest';
import { MIN_ROW_PX, displayRows, rowOfBucket, smoothSeries } from './rows';

describe('displayRows', () => {
  it('gives one row per bucket when there is room for them', () => {
    // 120 buckets across 686px is 5.7px each — no aggregation needed.
    expect(displayRows(120, 686)).toBe(120);
  });

  it('caps rows so each one is at least the minimum height', () => {
    // 1100 buckets across 686px would be 0.6px each; nearest-neighbour blitting would
    // simply discard two thirds of them.
    const rows = displayRows(1100, 686);
    expect(rows).toBe(Math.floor(686 / MIN_ROW_PX));
    expect(686 / rows).toBeGreaterThanOrEqual(MIN_ROW_PX);
  });

  it('never returns more rows than buckets, so a row never splits a bucket', () => {
    for (const [buckets, h] of [[10, 686], [1, 400], [50, 900], [281, 686]] as const) {
      expect(displayRows(buckets, h)).toBeLessThanOrEqual(buckets);
    }
  });

  it('always returns at least one row', () => {
    expect(displayRows(0, 686)).toBe(1);
    expect(displayRows(100, 0)).toBe(1);
    expect(displayRows(100, 1)).toBe(1);
  });

  it('asks for more rows as the chart gets taller', () => {
    expect(displayRows(1100, 900)).toBeGreaterThan(displayRows(1100, 400));
  });
});

describe('rowOfBucket', () => {
  const b0 = 100;
  const b1 = 199; // 100 buckets visible

  it('puts the highest bucket at row 0, because row 0 is the top of the screen', () => {
    expect(rowOfBucket(b1, b0, b1, 100)).toBe(0);
    expect(rowOfBucket(b0, b0, b1, 100)).toBe(99);
  });

  it('is one bucket per row when rows match buckets', () => {
    const seen = new Set<number>();
    for (let b = b0; b <= b1; b++) seen.add(rowOfBucket(b, b0, b1, 100));
    expect(seen.size).toBe(100);
  });

  it('groups buckets evenly when rows are fewer', () => {
    const counts = new Map<number, number>();
    for (let b = b0; b <= b1; b++) {
      const r = rowOfBucket(b, b0, b1, 25);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    expect(counts.size).toBe(25);
    for (const n of counts.values()) expect(n).toBe(4);
  });

  it('assigns every bucket to exactly one row, so summing conserves mass', () => {
    for (const rows of [1, 7, 33, 64, 100]) {
      for (let b = b0; b <= b1; b++) {
        const r = rowOfBucket(b, b0, b1, rows);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(rows);
      }
    }
  });

  it('never runs backwards: a higher bucket is never on a lower row', () => {
    let prev = Infinity;
    for (let b = b1; b >= b0; b--) {
      const r = rowOfBucket(b, b0, b1, 37);
      expect(r).toBeGreaterThanOrEqual(prev === Infinity ? 0 : prev);
      prev = r;
    }
  });

  it('handles a single visible bucket', () => {
    expect(rowOfBucket(50, 50, 50, 1)).toBe(0);
  });
});

describe('smoothSeries', () => {
  it('returns the input untouched when smoothing is off', () => {
    const v = [0, 5, 0, 3];
    expect(smoothSeries(v, false)).toEqual(v);
  });

  it('spreads a spike onto its neighbours', () => {
    const out = smoothSeries([0, 0, 8, 0, 0], true);
    expect(out[2]).toBeCloseTo(4, 6);
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[3]).toBeCloseTo(2, 6);
    expect(out[0]).toBe(0);
  });

  it('conserves the total, so a smoothed profile is not a quieter one', () => {
    const v = [1, 9, 4, 0, 0, 7, 2, 6];
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(smoothSeries(v, true))).toBeCloseTo(sum(v), 6);
  });

  it('conserves the total at the edges too, by folding rather than dropping', () => {
    const v = [10, 0, 0, 0, 10];
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(smoothSeries(v, true))).toBeCloseTo(20, 6);
  });

  it('leaves a flat series flat', () => {
    const out = smoothSeries([4, 4, 4, 4, 4], true);
    for (const v of out) expect(v).toBeCloseTo(4, 6);
  });

  it('lowers the peak and raises the trough, which is what softens an edge', () => {
    const v = [0, 0, 10, 10, 0, 0];
    const out = smoothSeries(v, true);
    expect(Math.max(...out)).toBeLessThan(10);
    expect(out[1]).toBeGreaterThan(0);
  });

  it('copes with empty and single-element input', () => {
    expect(smoothSeries([], true)).toEqual([]);
    expect(smoothSeries([5], true)).toEqual([5]);
  });
});
