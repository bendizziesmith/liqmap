import { describe, it, expect } from 'vitest';
import { profileToCsv, CSV_HEADER } from './profileCsv';
import { liquidationProfile } from './profile';
import { N_BUCKETS } from './grid';
import type { Grid } from './types';

const grid: Grid = { min: 0, max: 1100, nBuckets: N_BUCKETS, step: 1 };

function profile(bins = 10) {
  const tiers = [0, 1, 2, 3].map(() => new Float32Array(N_BUCKETS));
  tiers[0].fill(1);
  tiers[1].fill(2);
  return liquidationProfile(tiers, grid, 550, { bins, tierLabels: [3, 5, 10, 25] });
}

describe('profileToCsv', () => {
  it('emits the documented header', () => {
    expect(CSV_HEADER).toBe('price_from,price_to,L1,L2,L3,L4,cumulative');
    expect(profileToCsv(profile()).split('\n')[0]).toBe(CSV_HEADER);
  });

  it('emits one row per bin plus the header', () => {
    expect(profileToCsv(profile(10)).trim().split('\n')).toHaveLength(11);
    expect(profileToCsv(profile(200)).trim().split('\n')).toHaveLength(201);
  });

  it('puts seven comma-separated fields on every row', () => {
    for (const line of profileToCsv(profile()).trim().split('\n').slice(1)) {
      expect(line.split(',')).toHaveLength(7);
    }
  });

  it('carries the long cumulative below price and the short cumulative above', () => {
    const p = profile(10);
    const rows = profileToCsv(p).trim().split('\n').slice(1);

    const below = rows[p.priceBinIndex - 1].split(',');
    const above = rows[p.priceBinIndex + 1].split(',');
    expect(Number(below[6])).toBeCloseTo(p.bins[p.priceBinIndex - 1].cumLong, 4);
    expect(Number(above[6])).toBeCloseTo(p.bins[p.priceBinIndex + 1].cumShort, 4);
  });

  it('writes plain parseable numbers with no separators or currency', () => {
    for (const line of profileToCsv(profile()).trim().split('\n').slice(1)) {
      for (const field of line.split(',')) {
        expect(Number.isFinite(Number(field))).toBe(true);
      }
    }
  });

  it('writes the bin price bounds in the first two columns', () => {
    const p = profile(10);
    const first = profileToCsv(p).trim().split('\n')[1].split(',');
    expect(Number(first[0])).toBeCloseTo(p.bins[0].priceFrom, 4);
    expect(Number(first[1])).toBeCloseTo(p.bins[0].priceTo, 4);
  });

  it('pads the tier columns when a profile has fewer than four tiers', () => {
    const tiers = [new Float32Array(N_BUCKETS), new Float32Array(N_BUCKETS)];
    const p = liquidationProfile(tiers, grid, 550, { bins: 3 });
    for (const line of profileToCsv(p).trim().split('\n').slice(1)) {
      expect(line.split(',')).toHaveLength(7);
    }
  });

  it('formats prices with the supplied per-symbol formatter', () => {
    // The CSV must carry the same precision the chart shows, and stay parseable.
    const rows = profileToCsv(profile(3), (p) => p.toFixed(4)).trim().split('\n').slice(1);
    for (const line of rows) {
      const [from, to] = line.split(',');
      expect(from.split('.')[1]).toHaveLength(4);
      expect(to.split('.')[1]).toHaveLength(4);
      expect(Number.isFinite(Number(from))).toBe(true);
    }
  });

  it('applies the open-interest calibration to every USD column', () => {
    const plain = profileToCsv(profile(5)).trim().split('\n').slice(1);
    const scaled = profileToCsv(profile(5), undefined, { long: 0.25, short: 0.25 }).trim().split('\n').slice(1);
    for (let i = 0; i < plain.length; i++) {
      const a = plain[i].split(','), b = scaled[i].split(',');
      // Prices are untouched; the four tier columns and the cumulative are scaled.
      expect(b[0]).toBe(a[0]);
      for (const col of [2, 3, 4, 5, 6]) {
        if (Number(a[col]) > 0) expect(Number(b[col])).toBeCloseTo(Number(a[col]) * 0.25, 4);
      }
    }
  });

  it('produces only a header for an empty profile', () => {
    const p = liquidationProfile([], grid, 550, { bins: 0 });
    const lines = profileToCsv({ ...p, bins: [] }).trim().split('\n');
    expect(lines).toEqual([CSV_HEADER]);
  });
});
