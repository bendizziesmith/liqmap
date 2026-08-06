/**
 * Before/after numbers for the decay + per-side-normalisation change, computed with the
 * shipped engine rather than a prototype.
 *
 * Usage: npx vite-node scripts/verify-decay.ts [SYMBOL] [interval...]
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildHeatmap } from '../src/engine/build';
import { N_BUCKETS, priceToBucket } from '../src/engine/grid';
import { classBreaks, classOf } from '../src/engine/classes';
import type { HeatmapData, Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const INTERVALS = (process.argv.slice(3).length ? process.argv.slice(3) : ['1d', '4h']) as Interval[];
const MIN_SIDE_SAMPLES = 64;

const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${(x / 1e3).toFixed(0)}K`;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** Mirrors HeatmapCanvas: default window, per-side class breaks, class assignment. */
function render(map: HeatmapData, price: number) {
  const { grid, nCols, candles } = map;
  const col0 = Math.max(0, nCols - 220);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = col0; i < nCols; i++) {
    lo = Math.min(lo, candles[i].low);
    hi = Math.max(hi, candles[i].high);
  }
  const pad = (hi - lo) * 0.15;
  const b0 = priceToBucket(grid, Math.max(grid.min, lo - pad));
  const b1 = priceToBucket(grid, Math.min(grid.max, hi + pad));
  const pb = priceToBucket(grid, price);

  const cell = (c: number, b: number) => {
    let s = 0;
    for (const m of map.matrices) s += m[c * N_BUCKETS + b];
    return s;
  };

  const all: number[] = [];
  const above: number[] = [];
  const below: number[] = [];
  for (let c = col0; c < nCols; c++) {
    for (let b = b0; b <= b1; b++) {
      const v = cell(c, b);
      if (v <= 0) continue;
      all.push(v);
      if (b > pb) above.push(v);
      else if (b < pb) below.push(v);
    }
  }
  const shared = classBreaks(all);
  const split = above.length >= MIN_SIDE_SAMPLES && below.length >= MIN_SIDE_SAMPLES;
  const bA = split ? classBreaks(above) : shared;
  const bB = split ? classBreaks(below) : shared;

  const tally = (breaksA: number[], breaksB: number[]) => {
    let paintedA = 0, paintedB = 0, cellsA = 0, cellsB = 0, hotA = 0, hotB = 0;
    for (let c = col0; c < nCols; c++) {
      for (let b = b0; b <= b1; b++) {
        const v = cell(c, b);
        if (b > pb) {
          cellsA++;
          const k = classOf(v, breaksA);
          if (k >= 0) paintedA++;
          if (k >= 3) hotA++;
        } else if (b < pb) {
          cellsB++;
          const k = classOf(v, breaksB);
          if (k >= 0) paintedB++;
          if (k >= 3) hotB++;
        }
      }
    }
    return { paintedRatio: paintedA / Math.max(1, paintedB), hotA: hotA / cellsA, hotB: hotB / cellsB };
  };

  // Active book, by distance from price.
  let ghost = 0, nearAbove = 0, nearBelow = 0;
  const lastCol = nCols - 1;
  for (let b = 0; b < N_BUCKETS; b++) {
    const v = cell(lastCol, b);
    if (v <= 0) continue;
    const r = (grid.min + (b + 0.5) * grid.step) / price;
    if (r >= 2) ghost += v;
    if (r > 1 && r < 1.15) nearAbove += v;
    if (r < 1 && r > 0.85) nearBelow += v;
  }

  return { shared: tally(shared, shared), perSide: tally(bA, bB), ghost, nearAbove, nearBelow };
}

for (const interval of INTERVALS) {
  const candles = await fetchKlines(SYMBOL, interval);
  const oi = await fetchOpenInterest(SYMBOL, interval, candles.length);
  const price = (await fetchTicker(SYMBOL))?.price ?? candles.at(-1)!.close;

  const before = render(buildHeatmap(candles, oi, interval, { decay: false }), price);
  const after = render(buildHeatmap(candles, oi, interval, { decay: true }), price);

  console.log(`\n${'='.repeat(78)}\n${SYMBOL} ${interval} — price ${price}\n${'='.repeat(78)}`);
  console.log('                                     BEFORE (no decay,     AFTER (decay +');
  console.log('                                      shared scale)         per-side scale)');
  console.log(`  above/below painted-area ratio     ${before.shared.paintedRatio.toFixed(2).padStart(14)}${after.perSide.paintedRatio.toFixed(2).padStart(23)}`);
  console.log(`  hot-cell density  above            ${pct(before.shared.hotA).padStart(14)}${pct(after.perSide.hotA).padStart(23)}`);
  console.log(`  hot-cell density  below            ${pct(before.shared.hotB).padStart(14)}${pct(after.perSide.hotB).padStart(23)}`);
  console.log(`  above:below hot-density gap        ${(before.shared.hotB / before.shared.hotA).toFixed(1).padStart(13)}x${(after.perSide.hotB / after.perSide.hotA).toFixed(1).padStart(22)}x`);
  console.log(`  ghost mass beyond 2x price         ${usd(before.ghost).padStart(14)}${usd(after.ghost).padStart(23)}`);
  console.log(`  active book within 15% above       ${usd(before.nearAbove).padStart(14)}${usd(after.nearAbove).padStart(23)}`);
  console.log(`  active book within 15% below       ${usd(before.nearBelow).padStart(14)}${usd(after.nearBelow).padStart(23)}`);
  console.log(`  near-price above:below             ${(before.nearAbove / before.nearBelow).toFixed(3).padStart(14)}${(after.nearAbove / after.nearBelow).toFixed(3).padStart(23)}`);
}
