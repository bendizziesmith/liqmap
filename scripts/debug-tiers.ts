/**
 * H3 live measurement: per-tier standing split on XRPUSDT 4h vs the steady-state
 * prediction seedWeight x halfLife (~61/26/8/2 toward 3x), plus per-tier values at the
 * prices TD's tooltips quote, for the apples-to-apples table.
 *
 * Usage: npx vite-node scripts/debug-tiers.ts
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildHeatmap } from '../src/engine/build';
import { HALF_LIFE_DAYS, tierDecayFactors } from '../src/engine/decay';
import { N_BUCKETS, priceToBucket } from '../src/engine/grid';
import type { HeatmapData } from '../src/engine/types';

const candles = await fetchKlines('XRPUSDT', '4h');
const oi = await fetchOpenInterest('XRPUSDT', '4h', candles.length);
const price = (await fetchTicker('XRPUSDT'))?.price ?? candles.at(-1)!.close;

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function tierSplit(map: HeatmapData, lo?: number, hi?: number) {
  const last = (map.nCols - 1) * N_BUCKETS;
  const bLo = lo != null ? priceToBucket(map.grid, lo) : 0;
  const bHi = hi != null ? priceToBucket(map.grid, hi) : N_BUCKETS - 1;
  const per = map.tiers.map((_, t) => {
    let s = 0;
    for (let b = bLo; b <= bHi; b++) s += map.matrices[t][last + b];
    return s;
  });
  const total = per.reduce((a, b) => a + b, 0);
  return { per, total, split: per.map((v) => v / Math.max(1e-12, total)) };
}

for (const decay of [true, false]) {
  const map = buildHeatmap(candles, oi, '4h', { decay });
  const whole = tierSplit(map);

  console.log(`\n${'='.repeat(74)}\nXRPUSDT 4h — decay ${decay ? 'ON' : 'OFF'} — price ${price}`);
  console.log('='.repeat(74));
  console.log(`  tier      standing split      ${decay ? 'steady-state prediction (w x hl)' : '(no-decay baseline)'}`);
  const weights = [0.35, 0.3, 0.2, 0.15];
  const hls = map.tiers.map((t) => HALF_LIFE_DAYS.swing[t]);
  const factors = tierDecayFactors('swing', map.tiers, '4h');
  const pred = weights.map((w, t) => w / (1 - factors[t]));
  const predTotal = pred.reduce((a, b) => a + b, 0);
  map.tiers.forEach((tier, t) => {
    console.log(
      `  ${String(tier).padStart(3)}x     ${pct(whole.split[t]).padStart(8)}` +
        (decay ? `             ${pct(pred[t] / predTotal).padStart(8)}  (w ${weights[t]} x hl ${hls[t]}d)` : ''),
    );
  });

  // Per-tier at TD's quoted prices. TD tooltip at 0.9500: 3x 0M / 5x 0M / 10x 0M / 25x 0.61M.
  // Near band: their dominant below-price wall 1.00-1.04, drawn overwhelmingly 25x-dark-blue.
  for (const [lo, hi, label] of [[0.945, 0.955, '0.95 +-0.005'], [1.0, 1.04, '1.00-1.04'], [0.88, 0.96, '0.88-0.96 shelf'], [1.16, 1.99, 'far above']] as const) {
    const band = tierSplit(map, lo, hi);
    console.log(
      `  ${label.padEnd(16)} 3x ${pct(band.split[0]).padStart(6)}  5x ${pct(band.split[1]).padStart(6)}  ` +
        `10x ${pct(band.split[2]).padStart(6)}  25x ${pct(band.split[3]).padStart(6)}   (band = ${pct(band.total / whole.total)} of book)`,
    );
  }
}
