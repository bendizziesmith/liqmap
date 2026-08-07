/**
 * Score WICK_RETENTION against the reference's cluster layout.
 *
 * For each retention in {0, 0.25, 0.5, 0.75} x decay {off, on}: rebuild the whole book with
 * the shipped engine and report (1) the [1.00, 1.02] and [0.98, 1.03] bands' share of book,
 * (2) whether the 0.90-0.95 shelf keeps its rank among below-price clusters, (3) the
 * far-above [1.16, 1.99] "EXTRA" share. The pick must recover the near-price band WITHOUT
 * inflating the extras or demoting the confirmed hit.
 *
 * Usage: npx vite-node scripts/sweep-wick.ts [SYMBOL] [interval]
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildHeatmap } from '../src/engine/build';
import { N_BUCKETS } from '../src/engine/grid';
import type { HeatmapData, Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const INTERVAL = (process.argv[3] ?? '4h') as Interval;

const candles = await fetchKlines(SYMBOL, INTERVAL);
const oi = await fetchOpenInterest(SYMBOL, INTERVAL, candles.length);
const price = (await fetchTicker(SYMBOL))?.price ?? candles.at(-1)!.close;

function analyse(map: HeatmapData) {
  const { grid } = map;
  const last = (map.nCols - 1) * N_BUCKETS;
  const perBucket = new Float64Array(N_BUCKETS);
  let total = 0;
  for (const m of map.matrices) {
    for (let b = 0; b < N_BUCKETS; b++) {
      perBucket[b] += m[last + b];
      total += m[last + b];
    }
  }

  const bucketPrice = (b: number) => grid.min + (b + 0.5) * grid.step;
  const band = (lo: number, hi: number) => {
    let s = 0;
    for (let b = 0; b < N_BUCKETS; b++) {
      const p = bucketPrice(b);
      if (p >= lo && p < hi) s += perBucket[b];
    }
    return s / total;
  };

  // Below-price cluster ranking via the same greedy expansion as the cluster table.
  const work = perBucket.slice();
  const clusters: Array<{ lo: number; hi: number; mass: number; peak: number }> = [];
  for (let k = 0; k < 12; k++) {
    let peak = 0;
    let at = -1;
    for (let b = 0; b < N_BUCKETS; b++) if (work[b] > peak) { peak = work[b]; at = b; }
    if (at < 0 || peak <= 0) break;
    let lo = at;
    let hi = at;
    while (lo > 0 && work[lo - 1] >= peak * 0.15) lo--;
    while (hi < N_BUCKETS - 1 && work[hi + 1] >= peak * 0.15) hi++;
    let mass = 0;
    for (let b = lo; b <= hi; b++) { mass += work[b]; work[b] = 0; }
    clusters.push({ lo: bucketPrice(lo), hi: bucketPrice(hi), mass, peak: bucketPrice(at) });
  }
  clusters.sort((a, b) => b.mass - a.mass);

  const below = clusters.filter((c) => c.peak < price);
  const shelfRank = below.findIndex((c) => c.peak >= 0.88 && c.peak <= 0.96) + 1;
  const nearRank = below.findIndex((c) => c.peak >= 0.98 && c.peak <= 1.03) + 1;

  return {
    band100_102: band(1.0, 1.02),
    band098_103: band(0.98, 1.03),
    extraAbove: band(1.16, 1.99),
    shelfRank: shelfRank || '—',
    nearRank: nearRank || '—',
    topBelow: below[0] ? `${below[0].lo.toFixed(3)}–${below[0].hi.toFixed(3)} pk ${below[0].peak.toFixed(3)}` : '—',
  };
}

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;

console.log(`\n${SYMBOL} ${INTERVAL} — price ${price} — retention sweep`);
console.log('='.repeat(104));
console.log('decay retain | [1.00,1.02] | [0.98,1.03] | above[1.16,1.99] | 0.90s shelf rank | near-band rank | top below-price cluster');
console.log('-'.repeat(104));
for (const decay of [false, true]) {
  for (const wickRetention of [0, 0.25, 0.5, 0.75]) {
    const m = analyse(buildHeatmap(candles, oi, INTERVAL, { decay, wickRetention }));
    console.log(
      `${decay ? 'ON ' : 'OFF'}   ${wickRetention.toFixed(2)} |  ${pct(m.band100_102).padStart(8)} |  ${pct(m.band098_103).padStart(8)} | ` +
        `${pct(m.extraAbove).padStart(15)} | ${String(m.shelfRank).padStart(16)} | ${String(m.nearRank).padStart(14)} | ${m.topBelow}`,
    );
  }
}
console.log(`\n  reference (TD, Binance, same 3/5/10/25 swing ladder): below-price wall peaks ~1.00–1.04`);
console.log(`  hugging current price; 0.95 nearly empty (tooltip 0.61M vs ~2.4M peaks); window shown 0.91–1.33.`);
