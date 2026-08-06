/**
 * Evidence gathering for "1d shows far less above-price liquidity than the reference".
 *
 * Runs the real engine functions over real Bybit data and instruments every boundary:
 * data -> seeding -> clearing -> active book -> rendering. Prints measurements only; it
 * proposes nothing. Run: npx vite-node scripts/debug-1d.ts [SYMBOL]
 */
import { fetchKlines, fetchOpenInterest, fetchTicker } from '../src/data/rest';
import { buildGrid, N_BUCKETS, priceToBucket } from '../src/engine/grid';
import { modeForInterval, tiersForMode } from '../src/engine/tiers';
import { oiFactors } from '../src/engine/oi';
import { clearRange, seedCandle } from '../src/engine/seed';
import { classBreaks, classOf } from '../src/engine/classes';
import type { Candle, Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const usd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${x.toFixed(0)}`;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Report {
  interval: Interval;
  nCandles: number;
  from: string;
  to: string;
  price: number;
  gridMin: number;
  gridMax: number;
  bucketsBelow: number;
  bucketsAbove: number;
  medRangePct: number;
  /** H-a: share of a candle's own seeds still alive after the very next candle clears. */
  survive1Above: number;
  survive1Below: number;
  /** H-b: mass seeded above the then-price, over the whole walk. */
  seededAbove: number;
  seededBelow: number;
  /** Active (final-column) book. */
  activeAbove: number;
  activeBelow: number;
  /** Age of the mass in the active book. */
  activeAboveOlderThan1y: number;
  activeBelowOlderThan1y: number;
  /** H-c: rendering, over the default 200-column window. */
  breaks: number[];
  paintedAbove: number;
  paintedBelow: number;
  topClassAbove: number;
  topClassBelow: number;
  cellsAbove: number;
  cellsBelow: number;
  classAbove: number[];
  classBelow: number[];
  topBuckets: Array<{ above: boolean; price: number; value: number; seeded: string; ageDays: number }>;
}

async function analyse(interval: Interval): Promise<Report> {
  const candles: Candle[] = await fetchKlines(SYMBOL, interval);
  const oi = await fetchOpenInterest(SYMBOL, interval, 200);
  const ticker = await fetchTicker(SYMBOL);
  const price = ticker?.price ?? candles[candles.length - 1].close;

  const tiers = tiersForMode(modeForInterval(interval));
  const grid = buildGrid(candles, Math.min(...tiers));
  const factors = oiFactors(candles, oi);
  const nCols = candles.length;
  const priceBucket = priceToBucket(grid, price);

  const levels = tiers.map(() => new Float32Array(N_BUCKETS));
  // Column-major store, same layout as the engine, so rendering can be replayed exactly.
  const matrices = tiers.map(() => new Float32Array(nCols * N_BUCKETS));
  // Parallel matrix recording the candle index that deposited each unit of mass, so the
  // active book can be split by age. Mass-weighted mean start time per bucket.
  const lastSeeded = new Float64Array(N_BUCKETS);

  let seededAbove = 0;
  let seededBelow = 0;
  let survAboveNum = 0;
  let survAboveDen = 0;
  let survBelowNum = 0;
  let survBelowDen = 0;
  const ranges: number[] = [];

  for (let i = 0; i < nCols; i++) {
    const c = candles[i];
    ranges.push((c.high - c.low) / c.close);

    clearRange(levels, grid, c.low, c.high);

    // Seed into a scratch vector as well, so this candle's own contribution can be tracked
    // through the next candle's clear without disturbing the real walk.
    const own = tiers.map(() => new Float32Array(N_BUCKETS));
    seedCandle(own, grid, tiers, c, factors[i]);

    const cBucket = priceToBucket(grid, c.close);
    let ownAbove = 0;
    let ownBelow = 0;
    for (let t = 0; t < tiers.length; t++) {
      for (let b = 0; b < N_BUCKETS; b++) {
        const v = own[t][b];
        if (v <= 0) continue;
        levels[t][b] += v;
        if (b > cBucket) ownAbove += v;
        else if (b < cBucket) ownBelow += v;
        lastSeeded[b] = c.start;
      }
    }
    seededAbove += ownAbove;
    seededBelow += ownBelow;

    // H-a: how much of what this candle just seeded survives the NEXT candle's clear?
    if (i + 1 < nCols) {
      const n = candles[i + 1];
      const [lo, hi] = [priceToBucket(grid, n.low), priceToBucket(grid, n.high)];
      let killedAbove = 0;
      let killedBelow = 0;
      for (let t = 0; t < tiers.length; t++) {
        for (let b = lo; b <= hi; b++) {
          const v = own[t][b];
          if (v <= 0) continue;
          if (b > cBucket) killedAbove += v;
          else if (b < cBucket) killedBelow += v;
        }
      }
      survAboveNum += ownAbove - killedAbove;
      survAboveDen += ownAbove;
      survBelowNum += ownBelow - killedBelow;
      survBelowDen += ownBelow;
    }

    const offset = i * N_BUCKETS;
    for (let t = 0; t < tiers.length; t++) matrices[t].set(levels[t], offset);
  }

  // ---- active book (final column) ----
  let activeAbove = 0;
  let activeBelow = 0;
  let activeAboveOld = 0;
  let activeBelowOld = 0;
  const yearAgo = candles[nCols - 1].start - 365 * 864e5;
  for (let t = 0; t < tiers.length; t++) {
    for (let b = 0; b < N_BUCKETS; b++) {
      const v = levels[t][b];
      if (v <= 0) continue;
      const old = lastSeeded[b] > 0 && lastSeeded[b] < yearAgo;
      if (b > priceBucket) {
        activeAbove += v;
        if (old) activeAboveOld += v;
      } else if (b < priceBucket) {
        activeBelow += v;
        if (old) activeBelowOld += v;
      }
    }
  }

  // ---- rendering, over what the chart actually shows on open ----
  const col0 = Math.max(0, nCols - 200);
  const enabled = tiers.map(() => true);
  // The default view fits price to the visible candles, padded — mirror fitPrice().
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = col0; i < nCols; i++) {
    lo = Math.min(lo, candles[i].low);
    hi = Math.max(hi, candles[i].high);
  }
  const pad = (hi - lo) * 0.08;
  const p0 = Math.max(grid.min, lo - pad);
  const p1 = Math.min(grid.max, hi + pad);
  const b0 = priceToBucket(grid, p0);
  const b1 = priceToBucket(grid, p1);

  const visible: number[] = [];
  for (let c = col0; c < nCols; c++) {
    const off = c * N_BUCKETS;
    for (let b = b0; b <= b1; b++) {
      let s = 0;
      for (let t = 0; t < tiers.length; t++) if (enabled[t]) s += matrices[t][off + b];
      if (s > 0) visible.push(s);
    }
  }
  const breaks = classBreaks(visible);

  let paintedAbove = 0;
  let paintedBelow = 0;
  let topAbove = 0;
  let topBelow = 0;
  let cellsAbove = 0;
  let cellsBelow = 0;
  const classAbove = [0, 0, 0, 0, 0];
  const classBelow = [0, 0, 0, 0, 0];
  for (let c = col0; c < nCols; c++) {
    const off = c * N_BUCKETS;
    for (let b = b0; b <= b1; b++) {
      let s = 0;
      for (let t = 0; t < tiers.length; t++) if (enabled[t]) s += matrices[t][off + b];
      const cls = classOf(s, breaks);
      if (b > priceBucket) {
        cellsAbove++;
        if (cls >= 0) { paintedAbove++; classAbove[cls]++; }
        if (cls >= 3) topAbove++;
      } else if (b < priceBucket) {
        cellsBelow++;
        if (cls >= 0) { paintedBelow++; classBelow[cls]++; }
        if (cls >= 3) topBelow++;
      }
    }
  }

  // Heaviest buckets in the active book, with the candle that last fed each one.
  const perBucket = new Float64Array(N_BUCKETS);
  for (let t = 0; t < tiers.length; t++)
    for (let b = 0; b < N_BUCKETS; b++) perBucket[b] += levels[t][b];
  const order = Array.from(perBucket.keys()).sort((a, b) => perBucket[b] - perBucket[a]).slice(0, 10);
  const now = candles[nCols - 1].start;
  const topBuckets = order.map((b) => ({
    above: b > priceBucket,
    price: grid.min + (b + 0.5) * grid.step,
    value: perBucket[b],
    seeded: lastSeeded[b] > 0 ? day(lastSeeded[b]) : 'never',
    ageDays: lastSeeded[b] > 0 ? Math.round((now - lastSeeded[b]) / 864e5) : -1,
  }));

  ranges.sort((a, b) => a - b);

  return {
    interval,
    nCandles: nCols,
    from: day(candles[0].start),
    to: day(candles[nCols - 1].start),
    price,
    gridMin: grid.min,
    gridMax: grid.max,
    bucketsBelow: priceBucket,
    bucketsAbove: N_BUCKETS - priceBucket,
    medRangePct: ranges[Math.floor(ranges.length / 2)],
    survive1Above: survAboveDen > 0 ? survAboveNum / survAboveDen : 0,
    survive1Below: survBelowDen > 0 ? survBelowNum / survBelowDen : 0,
    seededAbove,
    seededBelow,
    activeAbove,
    activeBelow,
    activeAboveOlderThan1y: activeAboveOld,
    activeBelowOlderThan1y: activeBelowOld,
    breaks,
    paintedAbove,
    paintedBelow,
    topClassAbove: topAbove,
    topClassBelow: topBelow,
    cellsAbove,
    cellsBelow,
    classAbove,
    classBelow,
    topBuckets,
  };
}

const reports = [await analyse('1d'), await analyse('4h')];

for (const r of reports) {
  console.log(`\n${'='.repeat(74)}\n${SYMBOL} ${r.interval}  —  ${r.nCandles} candles, ${r.from} → ${r.to}`);
  console.log(`${'='.repeat(74)}`);
  console.log(`price ${r.price}   grid [${r.gridMin.toFixed(4)}, ${r.gridMax.toFixed(4)}]`);
  console.log(`  buckets below price: ${r.bucketsBelow}   above: ${r.bucketsAbove}`);
  console.log(`  median candle range: ${pct(r.medRangePct)} of close`);

  console.log(`\n  [H-b] seeding — is the short side seeded at all?`);
  console.log(`    seeded above then-price : ${usd(r.seededAbove)}`);
  console.log(`    seeded below then-price : ${usd(r.seededBelow)}`);
  console.log(`    above/below seed ratio  : ${(r.seededAbove / r.seededBelow).toFixed(3)}`);

  console.log(`\n  [H-a] clearing — survives the very next candle?`);
  console.log(`    above-price seeds surviving 1 candle : ${pct(r.survive1Above)}`);
  console.log(`    below-price seeds surviving 1 candle : ${pct(r.survive1Below)}`);

  console.log(`\n  active book (final column), split at current price`);
  console.log(`    above : ${usd(r.activeAbove)}   of which seeded >1y ago: ${usd(r.activeAboveOlderThan1y)}`);
  console.log(`    below : ${usd(r.activeBelow)}   of which seeded >1y ago: ${usd(r.activeBelowOlderThan1y)}`);
  console.log(`    above/below mass ratio : ${(r.activeAbove / r.activeBelow).toFixed(3)}`);

  console.log(`\n  [H-c] rendering — default 200-column window`);
  console.log(`    class breaks : ${r.breaks.map((b) => usd(b)).join('  ')}`);
  console.log(`    painted cells above : ${r.paintedAbove} / ${r.cellsAbove} (${pct(r.paintedAbove / r.cellsAbove)})`);
  console.log(`    painted cells below : ${r.paintedBelow} / ${r.cellsBelow} (${pct(r.paintedBelow / r.cellsBelow)})`);
  console.log(`    ABOVE/BELOW PAINTED-AREA RATIO : ${(r.paintedAbove / Math.max(1, r.paintedBelow)).toFixed(3)}`);
  console.log(`    top-2-class cells above : ${r.topClassAbove}   below : ${r.topClassBelow}`);
  console.log(`    class histogram (share of that side's cells):`);
  for (let c = 0; c < 5; c++) {
    console.log(
      `      class ${c}: above ${pct(r.classAbove[c] / r.cellsAbove).padStart(6)}   below ${pct(r.classBelow[c] / r.cellsBelow).padStart(6)}`,
    );
  }
  console.log(`\n  heaviest buckets in the ACTIVE book (final column):`);
  for (const t of r.topBuckets) {
    console.log(
      `    ${t.above ? 'above' : 'below'}  ${t.price.toFixed(4)}  ${usd(t.value).padStart(9)}  last seeded ${t.seeded}  (${t.ageDays}d ago)`,
    );
  }
}
