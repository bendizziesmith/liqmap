/**
 * Score the declared standing splits against the TD reference table.
 *
 * TD's observables (docs/reference/, same 3/5/10/25 ladder): the 0.95 zone nearly empty
 * and 25x-only (tooltip $0.61M); the dominant below-price wall at 1.00-1.04 drawn
 * overwhelmingly in the 25x colour; sizeable above-price walls within ~1.06-1.33.
 *
 * For each standing share x decay: [1.00,1.04] share of book, 0.88-0.96 shelf share and
 * rank, far-above extras, and the per-tier composition at 0.95 and 1.00-1.04.
 *
 * Usage: npx vite-node scripts/sweep-standing.ts
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildHeatmap } from '../src/engine/build';
import { N_BUCKETS, priceToBucket } from '../src/engine/grid';
import type { HeatmapData } from '../src/engine/types';

const candles = await fetchKlines('XRPUSDT', '4h');
const oi = await fetchOpenInterest('XRPUSDT', '4h', candles.length);
const price = (await fetchTicker('XRPUSDT'))?.price ?? candles.at(-1)!.close;

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
const pct0 = (x: number) => `${(100 * x).toFixed(0)}%`;

function measure(map: HeatmapData) {
  const { grid } = map;
  const last = (map.nCols - 1) * N_BUCKETS;
  const per = new Float64Array(N_BUCKETS);
  let total = 0;
  for (const m of map.matrices) for (let b = 0; b < N_BUCKETS; b++) { per[b] += m[last + b]; total += m[last + b]; }
  const bp = (b: number) => grid.min + (b + 0.5) * grid.step;

  const band = (lo: number, hi: number) => {
    let s = 0;
    for (let b = 0; b < N_BUCKETS; b++) if (bp(b) >= lo && bp(b) < hi) s += per[b];
    return s / total;
  };
  const tierComp = (lo: number, hi: number) => {
    const bLo = priceToBucket(grid, lo);
    const bHi = priceToBucket(grid, hi);
    const t4 = map.tiers.map((_, t) => {
      let s = 0;
      for (let b = bLo; b <= bHi; b++) s += map.matrices[t][last + b];
      return s;
    });
    const tt = t4.reduce((a, b) => a + b, 0);
    return t4.map((v) => v / Math.max(1e-12, tt));
  };

  // Below-price cluster ranking, same greedy method as before.
  const work = per.slice();
  const clusters: Array<{ peak: number; mass: number }> = [];
  for (let k = 0; k < 12; k++) {
    let peak = 0;
    let at = -1;
    for (let b = 0; b < N_BUCKETS; b++) if (work[b] > peak) { peak = work[b]; at = b; }
    if (at < 0) break;
    let lo = at;
    let hi = at;
    while (lo > 0 && work[lo - 1] >= peak * 0.15) lo--;
    while (hi < N_BUCKETS - 1 && work[hi + 1] >= peak * 0.15) hi++;
    let mass = 0;
    for (let b = lo; b <= hi; b++) { mass += work[b]; work[b] = 0; }
    clusters.push({ peak: bp(at), mass });
  }
  clusters.sort((a, b) => b.mass - a.mass);
  const below = clusters.filter((c) => c.peak < price);
  const shelfRank = below.findIndex((c) => c.peak >= 0.88 && c.peak <= 0.96) + 1;
  const nearRank = below.findIndex((c) => c.peak >= 0.98 && c.peak <= 1.05) + 1;

  return {
    near: band(1.0, 1.04),
    zone95: band(0.945, 0.955),
    shelf: band(0.88, 0.96),
    extra: band(1.16, 1.99),
    comp95: tierComp(0.945, 0.955),
    compNear: tierComp(1.0, 1.04),
    shelfRank: shelfRank || 99,
    nearRank: nearRank || 99,
  };
}

console.log(`\nXRPUSDT 4h — price ${price} — standing-share sweep`);
console.log(`TD targets: 0.95 nearly EMPTY and 25x-only; 1.00-1.04 the DOMINANT below-price wall, 25x-heavy.`);
console.log('='.repeat(116));
console.log('decay share   | [1.00,1.04] | 0.95 zone | shelf .88-.96 (rank) | extra 1.16-1.99 | comp@0.95 3/5/10/25 | comp@near 3/5/10/25 | near rank');
console.log('-'.repeat(116));
for (const decay of [true, false]) {
  for (const share of ['current', 'flat', 'highLeverage'] as const) {
    const m = measure(buildHeatmap(candles, oi, '4h', { decay, standingShare: share }));
    console.log(
      `${decay ? 'ON ' : 'OFF'} ${share.padEnd(12)} |   ${pct(m.near).padStart(7)} |  ${pct(m.zone95).padStart(7)} | ` +
        `${pct(m.shelf).padStart(8)} (${String(m.shelfRank === 99 ? '—' : m.shelfRank).padStart(2)}) | ${pct(m.extra).padStart(13)} | ` +
        `${m.comp95.map(pct0).join('/').padStart(15)} | ${m.compNear.map(pct0).join('/').padStart(15)} | ${m.nearRank === 99 ? '—' : m.nearRank}`,
    );
  }
}
