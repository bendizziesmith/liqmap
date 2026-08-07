import { describe, it, expect } from 'vitest';
import { MIN_ROW_PX, displayRows, rowOfBucket, sideSamples } from './rows';

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


describe('sideSamples (intra-candle ladder stability)', () => {
  /** agg layout mirrors the canvas: row-major, agg[r * cols + c]. */
  const build = (rows: number, cols: number, fill: (r: number, c: number) => number) => {
    const agg = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) agg[r * cols + c] = fill(r, c);
    return agg;
  };

  it('splits samples by the row side rule', () => {
    const agg = build(4, 2, (r) => r + 1);
    const s = sideSamples(agg, 4, 2, -1, (r) => (r < 2 ? 'above' : 'below'));
    expect(s.visible.length).toBe(8);
    expect(s.above).toEqual([1, 1, 2, 2]);
    expect(s.below).toEqual([3, 3, 4, 4]);
  });

  it('skips empty cells', () => {
    const agg = build(2, 2, (r, c) => (r === 0 && c === 0 ? 5 : 0));
    const s = sideSamples(agg, 2, 2, -1, () => 'above');
    expect(s.visible).toEqual([5]);
  });

  it('excludes the forming column, so ticks cannot move the ladder', () => {
    // THE regression for intra-candle flicker: between candle closes only the forming
    // column's values change, so with it excluded the sample set — and therefore every
    // class break — is bit-identical from tick to tick.
    const before = build(3, 4, (r, c) => r * 10 + c + 1);
    const after = before.slice();
    for (let r = 0; r < 3; r++) after[r * 4 + 3] = 999_999; // a violent forming print

    const side = (r: number): 'above' | 'below' => (r < 1 ? 'above' : 'below');
    const a = sideSamples(before, 3, 4, 3, side);
    const b = sideSamples(after, 3, 4, 3, side);
    expect(b.visible).toEqual(a.visible);
    expect(b.above).toEqual(a.above);
    expect(b.below).toEqual(a.below);
  });

  it('includes the last column when no column is excluded (historical view)', () => {
    const agg = build(2, 3, () => 7);
    expect(sideSamples(agg, 2, 3, -1, () => 'above').visible.length).toBe(6);
    expect(sideSamples(agg, 2, 3, 2, () => 'above').visible.length).toBe(4);
  });
});
