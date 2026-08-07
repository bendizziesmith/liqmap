/**
 * H1 vs H0 for the missing 1.00-1.02 band on XRPUSDT 4h.
 *
 *   H0: the band is out of the swing ladder's reach (needs 45-125x from current price).
 *   H1: the ladder reaches it fine from historical entries, but full-range clearing wiped
 *       it on the wick(s) through [0.99, 1.03]; the reference retains it because it does
 *       not fully clear on a wick.
 *
 * Instruments the real walk (same clear -> seed order as buildHeatmap) and reports, for a
 * price band: (a) mass seeded into it across the whole walk, (b) mass cleared out of it and
 * by which candles — split into body-swept vs wick-only-swept — and (c) what survives.
 * If (a) is large and (b) accounts for the shortfall, H1 holds and H0 is refuted.
 *
 * Usage: npx vite-node scripts/debug-band.ts [SYMBOL] [interval] [bandLo] [bandHi]
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildGrid, N_BUCKETS, priceToBucket } from '../src/engine/grid';
import { modeForInterval, tiersForMode } from '../src/engine/tiers';
import { oiFactors } from '../src/engine/oi';
import { clearRange, seedCandle } from '../src/engine/seed';
import { applyDecay, floorSparse, tierDecayFactors } from '../src/engine/decay';
import type { Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const INTERVAL = (process.argv[3] ?? '4h') as Interval;
const LO = Number(process.argv[4] ?? 0.98);
const HI = Number(process.argv[5] ?? 1.03);

const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${(x / 1e3).toFixed(1)}K`;
const day = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');

const candles = await fetchKlines(SYMBOL, INTERVAL);
const oi = await fetchOpenInterest(SYMBOL, INTERVAL, candles.length);
const price = (await fetchTicker(SYMBOL))?.price ?? candles.at(-1)!.close;

for (const decay of [false, true]) {
  const mode = modeForInterval(INTERVAL);
  const tiers = tiersForMode(mode);
  const grid = buildGrid(candles, Math.min(...tiers));
  const factors = oiFactors(candles, oi);
  const n = candles.length;
  const decayFactorsPerTier = decay ? tierDecayFactors(mode, tiers, INTERVAL) : null;

  const bLo = priceToBucket(grid, LO);
  const bHi = priceToBucket(grid, HI);
  const inBand = (b: number) => b >= bLo && b <= bHi;

  const levels = tiers.map(() => new Float32Array(N_BUCKETS));
  const bandSum = () => {
    let s = 0;
    for (const t of levels) for (let b = bLo; b <= bHi; b++) s += t[b];
    return s;
  };

  let seededIn = 0;
  let clearedBody = 0;
  let clearedWick = 0;
  let decayLoss = 0;
  interface Sweep { i: number; removed: number; wickShare: number }
  const sweeps: Sweep[] = [];

  for (let i = 0; i < n; i++) {
    const c = candles[i];

    if (decayFactorsPerTier) {
      const before = bandSum();
      applyDecay(levels, decayFactorsPerTier);
      decayLoss += before - bandSum();
    }

    // Split the candle's clear range into body and wick spans BEFORE clearing, then apply
    // the engine's own clearRange so the walk is bit-faithful.
    const beforeClear = bandSum();
    const bodyLo = priceToBucket(grid, Math.min(c.open, c.close));
    const bodyHi = priceToBucket(grid, Math.max(c.open, c.close));
    let bodyRemoved = 0;
    let wickRemoved = 0;
    const sweepLo = priceToBucket(grid, c.low);
    const sweepHi = priceToBucket(grid, c.high);
    for (const t of levels) {
      for (let b = Math.max(sweepLo, bLo); b <= Math.min(sweepHi, bHi); b++) {
        if (b >= bodyLo && b <= bodyHi) bodyRemoved += t[b];
        else wickRemoved += t[b];
      }
    }
    clearRange(levels, grid, c.low, c.high);
    const removed = beforeClear - bandSum();
    // Consistency: removed must equal bodyRemoved + wickRemoved (same buckets).
    clearedBody += bodyRemoved;
    clearedWick += wickRemoved;
    if (removed > 0) sweeps.push({ i, removed, wickShare: removed > 0 ? wickRemoved / removed : 0 });

    const beforeSeed = bandSum();
    seedCandle(levels, grid, tiers, c, factors[i]);
    seededIn += bandSum() - beforeSeed;

    if (decayFactorsPerTier) floorSparse(levels);
  }

  const surviving = bandSum();
  let total = 0;
  for (const t of levels) for (const v of t) total += v;

  sweeps.sort((a, b) => b.removed - a.removed);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${SYMBOL} ${INTERVAL} — band [${LO}, ${HI}] — decay ${decay ? 'ON' : 'OFF'} — price now ${price}`);
  console.log('='.repeat(78));
  console.log(`  (a) seeded into band over the walk : ${usd(seededIn)}`);
  console.log(`  (b) cleared out of band            : ${usd(clearedBody + clearedWick)}`);
  console.log(`        by candle BODIES             : ${usd(clearedBody)} (${(100 * clearedBody / (clearedBody + clearedWick)).toFixed(1)}%)`);
  console.log(`        by WICKS only                : ${usd(clearedWick)} (${(100 * clearedWick / (clearedBody + clearedWick)).toFixed(1)}%)`);
  if (decay) console.log(`      lost to decay                : ${usd(decayLoss)}`);
  console.log(`  (c) surviving now                  : ${usd(surviving)}  (${(100 * surviving / Math.max(1, seededIn)).toFixed(2)}% of seeded)  = ${(100 * surviving / total).toFixed(2)}% of book`);
  console.log(`\n  top sweeps of this band (what killed it):`);
  for (const s of sweeps.slice(0, 8)) {
    const c = candles[s.i];
    console.log(
      `    ${day(c.start)}  O ${c.open.toFixed(4)} H ${c.high.toFixed(4)} L ${c.low.toFixed(4)} C ${c.close.toFixed(4)}` +
        `  removed ${usd(s.removed).padStart(9)}  wick-share ${(100 * s.wickShare).toFixed(0)}%`,
    );
  }
}
