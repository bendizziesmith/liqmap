import { describe, it, expect } from 'vitest';
import { topBands, nearestBand, bandsWithin } from './bands';
import type { Grid } from './types';

const grid: Grid = { min: 0, max: 110, nBuckets: 1100, step: 0.1 };

function columnOf(entries: Array<[number, number]>, nCols = 1, col = 0): Float32Array {
  const m = new Float32Array(nCols * grid.nBuckets);
  for (const [bucket, value] of entries) m[col * grid.nBuckets + bucket] = value;
  return m;
}

describe('topBands', () => {
  it('returns bands strongest-first', () => {
    const m = columnOf([
      [100, 5],
      [500, 9],
      [900, 7],
    ]);
    const bands = topBands([m], [true], grid, 1, 0, 10);
    expect(bands.map((b) => b.score)).toEqual([9, 7, 5]);
  });

  it('converts bucket indices to prices', () => {
    const bands = topBands([columnOf([[500, 9]])], [true], grid, 1, 0, 10);
    expect(bands[0].price).toBeCloseTo(grid.min + 500.5 * grid.step, 6);
  });

  it('merges adjacent buckets into a single band at its peak', () => {
    // A real level smears over a few buckets; three separate entries would be misleading.
    const m = columnOf([
      [500, 4],
      [501, 9],
      [502, 3],
    ]);
    const bands = topBands([m], [true], grid, 1, 0, 10);
    expect(bands).toHaveLength(1);
    expect(bands[0].price).toBeCloseTo(grid.min + 501.5 * grid.step, 6);
  });

  it('sums the enabled tiers only', () => {
    const a = columnOf([[500, 4]]);
    const b = columnOf([[500, 6]]);
    expect(topBands([a, b], [true, true], grid, 1, 0, 10)[0].score).toBe(10);
    expect(topBands([a, b], [true, false], grid, 1, 0, 10)[0].score).toBe(4);
  });

  it('honours the requested limit', () => {
    const m = columnOf([
      [100, 1],
      [300, 2],
      [500, 3],
      [700, 4],
    ]);
    expect(topBands([m], [true], grid, 1, 0, 2)).toHaveLength(2);
  });

  it('reads the last column when asked for it', () => {
    const m = columnOf([[500, 9]], 3, 2);
    expect(topBands([m], [true], grid, 3, 2, 10)).toHaveLength(1);
    expect(topBands([m], [true], grid, 3, 0, 10)).toHaveLength(0);
  });

  it('returns nothing for an empty column', () => {
    expect(topBands([columnOf([])], [true], grid, 1, 0, 10)).toEqual([]);
  });
});

describe('bandsWithin', () => {
  const bands = [
    { price: 50, score: 100 },
    { price: 95, score: 10 },
    { price: 100, score: 5 },
    { price: 108, score: 8 },
    { price: 200, score: 90 },
  ];

  it('keeps only bands inside the window', () => {
    expect(bandsWithin(bands, 100, 10).map((b) => b.price)).toEqual([95, 100, 108]);
  });

  it('is inclusive at the window edge', () => {
    expect(bandsWithin([{ price: 110, score: 1 }], 100, 10)).toHaveLength(1);
  });

  it('returns everything when price is unknown', () => {
    expect(bandsWithin(bands, 0, 10)).toEqual(bands);
  });

  it('returns an empty list when nothing is near', () => {
    expect(bandsWithin(bands, 1000, 1)).toEqual([]);
  });
});

describe('nearestBand', () => {
  const bands = [
    { price: 90, score: 10 },
    { price: 105, score: 8 },
    { price: 150, score: 12 },
  ];

  it('finds the closest band by absolute distance', () => {
    expect(nearestBand(bands, 100, 0)?.price).toBe(105);
  });

  it('reports distance as a signed percentage of price', () => {
    const hit = nearestBand(bands, 100, 0);
    expect(hit?.distancePct).toBeCloseTo(5, 6);
    expect(nearestBand(bands, 100, 0, 'below')?.distancePct).toBeCloseTo(-10, 6);
  });

  it('ignores bands weaker than the minimum score', () => {
    expect(nearestBand(bands, 100, 9)?.price).toBe(90);
  });

  it('returns null when nothing clears the threshold', () => {
    expect(nearestBand(bands, 100, 999)).toBeNull();
  });

  it('returns null for an empty band list', () => {
    expect(nearestBand([], 100, 0)).toBeNull();
  });
});
