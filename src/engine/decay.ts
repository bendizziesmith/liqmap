import type { Interval, Mode } from './types';
import { INTERVAL_DAYS } from './interval';

export { INTERVAL_DAYS };

/**
 * How long a pending liquidation level stays believable, by leverage.
 *
 * The clearing rule only removes a level when price actually trades through it — but most
 * positions are closed, stopped or rolled long before that, so an unswept level is not
 * evidence of a position still standing. Without ageing, the map accumulates ghosts: dense
 * 2024 shelves at prices the market left behind two years ago, which then absorb most of the
 * open-interest budget and starve the levels that are actually live.
 *
 * Half-lives are scaled to how long each leverage can realistically be *held*: 100x cannot
 * survive ordinary intraday noise, while 3x can sit through a whole quarter. Values are in
 * days, and deliberately conservative — they are a modelling assumption, not a measurement.
 */
export const HALF_LIFE_DAYS: Record<Mode, Record<number, number>> = {
  scalping: { 10: 5, 25: 2, 50: 1, 100: 0.5 },
  swing: { 3: 60, 5: 30, 10: 14, 25: 5 },
};

/**
 * Surviving share of a level after `elapsedDays`.
 *
 * Exponential rather than linear so it composes: applying one candle's factor N times is the
 * same as one N-candle step, which is what lets the engine decay in a single forward pass
 * and still have every historical column agree with the closed form.
 */
export function decayFactor(elapsedDays: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) return 1;
  return Math.pow(2, -elapsedDays / halfLifeDays);
}

/** Per-candle survival factor for each tier, in the order `tiers` is given. */
export function tierDecayFactors(mode: Mode, tiers: number[], interval: Interval): number[] {
  const table = HALF_LIFE_DAYS[mode];
  return tiers.map((leverage) => decayFactor(INTERVAL_DAYS[interval], table[leverage]));
}

/** Age every tier vector by one candle, in place. */
export function applyDecay(levels: Float32Array[], factors: number[]): void {
  for (let t = 0; t < levels.length; t++) {
    const f = factors[t];
    if (f >= 1) continue;
    const arr = levels[t];
    for (let b = 0; b < arr.length; b++) {
      if (arr[b] !== 0) arr[b] *= f;
    }
  }
}

/**
 * Zero anything negligible next to the column's own peak.
 *
 * Decay never reaches zero, so without a floor every bucket a level ever touched would stay
 * faintly non-zero forever. That costs nothing in memory — the matrices are dense
 * Float32Arrays either way — but it does cost correctness: `classBreaks` and the USD
 * calibration both run over *non-zero* values, and a long tail of infinitesimals would drag
 * the percentiles down and inflate the scale.
 */
export function floorSparse(levels: Float32Array[], relative = 1e-6): void {
  let max = 0;
  for (const arr of levels) {
    for (let b = 0; b < arr.length; b++) if (arr[b] > max) max = arr[b];
  }
  if (max <= 0) return;

  const floor = max * relative;
  for (const arr of levels) {
    for (let b = 0; b < arr.length; b++) if (arr[b] < floor) arr[b] = 0;
  }
}
