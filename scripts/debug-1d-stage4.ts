/**
 * Stage 4. Prototype the two candidate fixes and measure what each does to the numbers
 * stages 2-3 indicted, before any of it goes into the engine.
 *
 *   decay          — per-tier exponential ageing, kills the ancient off-screen shelf
 *   wick retention — a level only touched by a wick keeps a fraction instead of being erased
 *
 * Reports the near-price above:below mass ratio and the painted-area / class hierarchy,
 * swept across parameter values.
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildGrid, N_BUCKETS, priceToBucket } from '../src/engine/grid';
import { modeForInterval, tiersForMode } from '../src/engine/tiers';
import { oiFactors } from '../src/engine/oi';
import { seedCandle } from '../src/engine/seed';
import { classBreaks, classOf } from '../src/engine/classes';
import type { Candle, Grid, Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${(x / 1e3).toFixed(0)}K`;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

const MS: Record<Interval, number> = {
  '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5,
};
/** Half-lives in DAYS, keyed by leverage. */
const HALF_LIFE_D: Record<number, number> = {
  3: 60, 5: 30, 10: 14, 25: 5, 50: 1, 100: 0.5,
};
// Scalping's 10x/25x are much shorter-lived than swing's, so the ladder is per mode.
const SCALP_HL_D: Record<number, number> = { 10: 5, 25: 2, 50: 1, 100: 0.5 };

function clearWeighted(
  levels: Float32Array[], grid: Grid, c: Candle, wickRetain: number,
): void {
  const bodyLo = priceToBucket(grid, Math.min(c.open, c.close));
  const bodyHi = priceToBucket(grid, Math.max(c.open, c.close));
  const lo = priceToBucket(grid, c.low);
  const hi = priceToBucket(grid, c.high);
  for (const tier of levels) {
    tier.fill(0, bodyLo, bodyHi + 1);
    for (let b = lo; b < bodyLo; b++) tier[b] *= wickRetain;
    for (let b = bodyHi + 1; b <= hi; b++) tier[b] *= wickRetain;
  }
}

interface Params { decay: boolean; wickRetain: number }

function build(candles: Candle[], oi: Awaited<ReturnType<typeof fetchOpenInterest>>, interval: Interval, p: Params) {
  const mode = modeForInterval(interval);
  const tiers = tiersForMode(mode);
  const grid = buildGrid(candles, Math.min(...tiers));
  const factors = oiFactors(candles, oi);
  const n = candles.length;
  const table = mode === 'swing' ? HALF_LIFE_D : SCALP_HL_D;
  const perCandle = tiers.map((L) =>
    p.decay ? Math.pow(2, -(MS[interval] / 864e5) / table[L]) : 1,
  );

  const levels = tiers.map(() => new Float32Array(N_BUCKETS));
  const matrices = tiers.map(() => new Float32Array(n * N_BUCKETS));

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (p.decay) {
      for (let t = 0; t < tiers.length; t++) {
        const f = perCandle[t];
        const arr = levels[t];
        for (let b = 0; b < N_BUCKETS; b++) arr[b] *= f;
      }
    }
    clearWeighted(levels, grid, c, p.wickRetain);
    seedCandle(levels, grid, tiers, c, factors[i]);

    if (p.decay) {
      // Sparsity floor: drop anything under 1e-6 of the column's own peak.
      let max = 0;
      for (const t of levels) for (let b = 0; b < N_BUCKETS; b++) if (t[b] > max) max = t[b];
      const floor = max * 1e-6;
      for (const t of levels) for (let b = 0; b < N_BUCKETS; b++) if (t[b] < floor) t[b] = 0;
    }

    const off = i * N_BUCKETS;
    for (let t = 0; t < tiers.length; t++) matrices[t].set(levels[t], off);
  }
  return { grid, tiers, matrices, levels, n };
}

function measure(
  candles: Candle[], price: number,
  b: ReturnType<typeof build>,
) {
  const { grid, tiers, matrices, levels, n } = b;
  const pb = priceToBucket(grid, price);
  const bucketPrice = (i: number) => grid.min + (i + 0.5) * grid.step;

  const perBucket = new Float64Array(N_BUCKETS);
  for (let t = 0; t < tiers.length; t++)
    for (let i = 0; i < N_BUCKETS; i++) perBucket[i] += levels[t][i];

  const band = (f0: number, f1: number) => {
    let m = 0;
    for (let i = 0; i < N_BUCKETS; i++) {
      const r = bucketPrice(i) / price;
      if (r >= f0 && r < f1) m += perBucket[i];
    }
    return m;
  };

  // Rendering over the default window.
  const col0 = Math.max(0, n - 200);
  let lo = Infinity, hi = -Infinity;
  for (let i = col0; i < n; i++) { lo = Math.min(lo, candles[i].low); hi = Math.max(hi, candles[i].high); }
  const pad = (hi - lo) * 0.08;
  const i0 = priceToBucket(grid, Math.max(grid.min, lo - pad));
  const i1 = priceToBucket(grid, Math.min(grid.max, hi + pad));

  const vis: number[] = [];
  const visA: number[] = [];
  const visB: number[] = [];
  const cell = (c: number, i: number) => {
    let s = 0;
    for (let t = 0; t < tiers.length; t++) s += matrices[t][c * N_BUCKETS + i];
    return s;
  };
  for (let c = col0; c < n; c++) for (let i = i0; i <= i1; i++) {
    const s = cell(c, i);
    if (s <= 0) continue;
    vis.push(s);
    if (i > pb) visA.push(s); else if (i < pb) visB.push(s);
  }
  const breaks = classBreaks(vis);
  // Per-side breaks: each side's hierarchy judged against its own distribution.
  const breaksA = classBreaks(visA);
  const breaksB = classBreaks(visB);

  let pA = 0, pB = 0, cA = 0, cB = 0, hotA = 0, hotB = 0, hotA2 = 0, hotB2 = 0;
  let massA = 0, massB = 0;
  for (let c = col0; c < n; c++) {
    for (let i = i0; i <= i1; i++) {
      const v = cell(c, i);
      const cls = classOf(v, breaks);
      if (i > pb) {
        cA++; if (cls >= 0) pA++; if (cls >= 3) hotA++;
        if (classOf(v, breaksA) >= 3) hotA2++;
        if (c === n - 1) massA += v;
      } else if (i < pb) {
        cB++; if (cls >= 0) pB++; if (cls >= 3) hotB++;
        if (classOf(v, breaksB) >= 3) hotB2++;
        if (c === n - 1) massB += v;
      }
    }
  }

  return {
    near5: [band(1.0, 1.05), band(0.95, 1.0)] as [number, number],
    near15: [band(1.05, 1.15), band(0.85, 0.95)] as [number, number],
    far: [band(2.0, 99), band(0, 0.5)] as [number, number],
    onScreenMass: [massA, massB] as [number, number],
    paintedRatio: pA / Math.max(1, pB),
    hotDensityA: hotA / Math.max(1, cA),
    hotDensityB: hotB / Math.max(1, cB),
    hotPerSideA: hotA2 / Math.max(1, cA),
    hotPerSideB: hotB2 / Math.max(1, cB),
  };
}

const interval = (process.argv[3] ?? '1d') as Interval;
const candles = await fetchKlines(SYMBOL, interval);
const oi = await fetchOpenInterest(SYMBOL, interval, 200);
const price = (await fetchTicker(SYMBOL))?.price ?? candles.at(-1)!.close;

console.log(`\n${SYMBOL} ${interval}, price ${price} — sweeping the two candidate fixes\n`);
console.log('decay | on-screen mass A:B | painted A:B | SHARED-scale hot A/B | PER-SIDE hot A/B | ghost >2x above');
console.log('-'.repeat(112));

for (const decay of [false, true]) {
  for (const wickRetain of [0]) {
    const m = measure(candles, price, build(candles, oi, interval, { decay, wickRetain }));
    const r5 = m.near5[0] / Math.max(1, m.near5[1]);
    const r15 = m.near15[0] / Math.max(1, m.near15[1]);
    void r5; void r15;
    console.log(
      `${String(decay).padEnd(5)} | ${usd(m.onScreenMass[0]).padStart(8)}:${usd(m.onScreenMass[1]).padEnd(8)} | ` +
        `${m.paintedRatio.toFixed(2).padStart(11)} | ` +
        `${(pct(m.hotDensityA) + ' / ' + pct(m.hotDensityB)).padStart(20)} | ` +
        `${(pct(m.hotPerSideA) + ' / ' + pct(m.hotPerSideB)).padStart(16)} | ${usd(m.far[0]).padStart(9)}`,
    );
  }
}
