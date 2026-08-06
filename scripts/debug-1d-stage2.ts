/**
 * Stage 2. Stage 1 refuted H-a (clearing, symmetric at 90.9%/90.8%) and H-b (short seeding,
 * ratio 0.967). It also showed the heaviest above-price buckets sitting at ~4x current price,
 * seeded ~1 year ago. This stage asks where the above-price mass actually lives relative to
 * the screen, and how old it is — i.e. whether the deficit is "no mass" or "mass in the
 * wrong place".
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildGrid, N_BUCKETS, priceToBucket } from '../src/engine/grid';
import { modeForInterval, tiersForMode } from '../src/engine/tiers';
import { oiFactors } from '../src/engine/oi';
import { clearRange, seedCandle } from '../src/engine/seed';
import type { Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${x.toFixed(0)}`;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

async function run(interval: Interval) {
  const candles = await fetchKlines(SYMBOL, interval);
  const oi = await fetchOpenInterest(SYMBOL, interval, 200);
  const price = (await fetchTicker(SYMBOL))?.price ?? candles.at(-1)!.close;

  const tiers = tiersForMode(modeForInterval(interval));
  const grid = buildGrid(candles, Math.min(...tiers));
  const factors = oiFactors(candles, oi);
  const nCols = candles.length;
  const pb = priceToBucket(grid, price);

  const levels = tiers.map(() => new Float32Array(N_BUCKETS));
  const lastSeeded = new Float64Array(N_BUCKETS);

  for (let i = 0; i < nCols; i++) {
    const c = candles[i];
    clearRange(levels, grid, c.low, c.high);
    const before = levels.map((l) => l.slice());
    seedCandle(levels, grid, tiers, c, factors[i]);
    for (let t = 0; t < tiers.length; t++)
      for (let b = 0; b < N_BUCKETS; b++)
        if (levels[t][b] > before[t][b]) lastSeeded[b] = c.start;
  }

  const perBucket = new Float64Array(N_BUCKETS);
  for (let t = 0; t < tiers.length; t++)
    for (let b = 0; b < N_BUCKETS; b++) perBucket[b] += levels[t][b];

  // The window the chart opens on.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, nCols - 200); i < nCols; i++) {
    lo = Math.min(lo, candles[i].low);
    hi = Math.max(hi, candles[i].high);
  }
  const pad = (hi - lo) * 0.08;
  const b0 = priceToBucket(grid, Math.max(grid.min, lo - pad));
  const b1 = priceToBucket(grid, Math.min(grid.max, hi + pad));

  const bucket = (b: number) => grid.min + (b + 0.5) * grid.step;
  const now = candles.at(-1)!.start;
  const ageDays = (b: number) => (lastSeeded[b] > 0 ? (now - lastSeeded[b]) / 864e5 : Infinity);

  let onAbove = 0, offAbove = 0, onBelow = 0, offBelow = 0;
  for (let b = 0; b < N_BUCKETS; b++) {
    const v = perBucket[b];
    if (v <= 0) continue;
    const on = b >= b0 && b <= b1;
    if (b > pb) on ? (onAbove += v) : (offAbove += v);
    else if (b < pb) on ? (onBelow += v) : (offBelow += v);
  }

  console.log(`\n${'='.repeat(72)}\n${SYMBOL} ${interval} — price ${price}, window [${bucket(b0).toFixed(3)}, ${bucket(b1).toFixed(3)}]`);
  console.log(`${'='.repeat(72)}`);
  console.log(`  ACTIVE BOOK, on-screen vs off-screen`);
  console.log(`    above price, on-screen  : ${usd(onAbove).padStart(9)}  over ${b1 - pb} buckets  = ${usd(onAbove / Math.max(1, b1 - pb))}/bucket`);
  console.log(`    above price, OFF-screen : ${usd(offAbove).padStart(9)}  (${pct(offAbove / (onAbove + offAbove))} of all above-price mass)`);
  console.log(`    below price, on-screen  : ${usd(onBelow).padStart(9)}  over ${pb - b0} buckets  = ${usd(onBelow / Math.max(1, pb - b0))}/bucket`);
  console.log(`    below price, OFF-screen : ${usd(offBelow).padStart(9)}  (${pct(offBelow / (onBelow + offBelow))} of all below-price mass)`);
  console.log(`    on-screen density ratio above:below = ${((onAbove / Math.max(1, b1 - pb)) / (onBelow / Math.max(1, pb - b0))).toFixed(3)}`);

  // Age composition of the active book, both sides.
  const buckets = [30, 90, 180, 365, Infinity];
  const labels = ['<30d', '30-90d', '90-180d', '180-365d', '>365d'];
  const aboveByAge = new Array(5).fill(0);
  const belowByAge = new Array(5).fill(0);
  for (let b = 0; b < N_BUCKETS; b++) {
    const v = perBucket[b];
    if (v <= 0) continue;
    const a = ageDays(b);
    const k = buckets.findIndex((t) => a < t);
    const i = k === -1 ? 4 : k;
    if (b > pb) aboveByAge[i] += v;
    else if (b < pb) belowByAge[i] += v;
  }
  const totA = aboveByAge.reduce((x, y) => x + y, 0);
  const totB = belowByAge.reduce((x, y) => x + y, 0);
  console.log(`\n  AGE OF THE ACTIVE BOOK (how long since the level was seeded)`);
  for (let i = 0; i < 5; i++) {
    console.log(`    ${labels[i].padEnd(9)} above ${usd(aboveByAge[i]).padStart(9)} (${pct(aboveByAge[i] / totA).padStart(6)})   below ${usd(belowByAge[i]).padStart(9)} (${pct(belowByAge[i] / totB).padStart(6)})`);
  }

  // Where the mass sits as a multiple of current price.
  console.log(`\n  MASS BY DISTANCE FROM PRICE`);
  const bands: Array<[number, number, string]> = [
    [1.0, 1.05, '0-5% above'], [1.05, 1.15, '5-15% above'], [1.15, 1.35, '15-35% above'],
    [1.35, 2.0, '35-100% above'], [2.0, 99, '>100% above'],
    [0.95, 1.0, '0-5% below'], [0.85, 0.95, '5-15% below'], [0.65, 0.85, '15-35% below'],
    [0.0, 0.65, '>35% below'],
  ];
  for (const [f0, f1, label] of bands) {
    let m = 0;
    for (let b = 0; b < N_BUCKETS; b++) {
      const r = bucket(b) / price;
      if (r >= f0 && r < f1) m += perBucket[b];
    }
    console.log(`    ${label.padEnd(15)} ${usd(m).padStart(9)}`);
  }
}

await run('1d');
await run('4h');
