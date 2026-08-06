/**
 * Stage 3. Stage 2 localised the deficit: near price, above holds 1/145th of below at 0-5%
 * and 1/23rd at 5-15%, while 76% of all above-price mass is ancient and off-screen. This
 * stage asks WHY the near-price above band is starved: which tier feeds it, how long its
 * levels live, and whether the sweep that kills them is directional.
 */
import { fetchKlines, fetchOpenInterest } from '../src/data/rest';
import { buildGrid, N_BUCKETS, priceToBucket } from '../src/engine/grid';
import { modeForInterval, tiersForMode } from '../src/engine/tiers';
import { oiFactors } from '../src/engine/oi';
import { clearRange, seedCandle } from '../src/engine/seed';
import type { Interval } from '../src/engine/types';

const SYMBOL = process.argv[2] ?? 'XRPUSDT';
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

async function run(interval: Interval) {
  const candles = await fetchKlines(SYMBOL, interval);
  const oi = await fetchOpenInterest(SYMBOL, interval, 200);
  const tiers = tiersForMode(modeForInterval(interval));
  const grid = buildGrid(candles, Math.min(...tiers));
  const factors = oiFactors(candles, oi);
  const n = candles.length;

  // Per-tier: how long does a freshly seeded level survive, and does the side matter?
  const lifeAbove = tiers.map(() => [] as number[]);
  const lifeBelow = tiers.map(() => [] as number[]);
  // Wick geometry: how much of the cleared range is wick rather than body?
  let wickShare = 0;
  let bodyShare = 0;

  const levels = tiers.map(() => new Float32Array(N_BUCKETS));

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    clearRange(levels, grid, c.low, c.high);
    seedCandle(levels, grid, tiers, c, factors[i]);

    const bodyLo = Math.min(c.open, c.close);
    const bodyHi = Math.max(c.open, c.close);
    const range = c.high - c.low;
    if (range > 0) {
      bodyShare += (bodyHi - bodyLo) / range;
      wickShare += 1 - (bodyHi - bodyLo) / range;
    }

    // Track this candle's own fresh levels forward until a later candle sweeps them.
    if (i % 20 !== 0 || i > n - 60) continue; // sample, this is O(n^2) otherwise
    for (let t = 0; t < tiers.length; t++) {
      const L = tiers[t];
      const longB = priceToBucket(grid, c.close * (1 - 1 / L));
      const shortB = priceToBucket(grid, c.close * (1 + 1 / L));
      let longLife = -1;
      let shortLife = -1;
      for (let j = i + 1; j < n; j++) {
        const [lo, hi] = [priceToBucket(grid, candles[j].low), priceToBucket(grid, candles[j].high)];
        if (longLife < 0 && longB >= lo && longB <= hi) longLife = j - i;
        if (shortLife < 0 && shortB >= lo && shortB <= hi) shortLife = j - i;
        if (longLife >= 0 && shortLife >= 0) break;
      }
      lifeBelow[t].push(longLife < 0 ? n - i : longLife);
      lifeAbove[t].push(shortLife < 0 ? n - i : shortLife);
    }
  }

  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  const ranges = candles.map((c) => (c.high - c.low) / c.close).sort((a, b) => a - b);

  console.log(`\n${'='.repeat(72)}\n${SYMBOL} ${interval}`);
  console.log(`${'='.repeat(72)}`);
  console.log(`  median candle range ${pct(ranges[Math.floor(ranges.length / 2)])} of close`);
  console.log(`  candle range is wick ${pct(wickShare / n)} / body ${pct(bodyShare / n)}`);
  console.log(`\n  MEDIAN LIFETIME of a freshly seeded level, in candles`);
  console.log(`  tier   liq distance   short side (above)   long side (below)`);
  for (let t = 0; t < tiers.length; t++) {
    console.log(
      `  ${String(tiers[t]).padStart(4)}x  ${pct(1 / tiers[t]).padStart(10)}   ` +
        `${String(med(lifeAbove[t])).padStart(14)}   ${String(med(lifeBelow[t])).padStart(17)}`,
    );
  }

  // How often is the nearest tier's liquidation distance inside a single candle's range?
  for (const t of tiers) {
    const inside = candles.filter((c) => (c.high - c.low) / c.close > 1 / t).length;
    console.log(`  candles whose own range exceeds the ${t}x liq distance (${pct(1 / t)}): ${pct(inside / n)}`);
  }
}

await run('1d');
await run('4h');
