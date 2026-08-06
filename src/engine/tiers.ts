import type { Interval, Mode } from './types';

/**
 * Traders on fast charts run hot leverage; swing traders on 4h/1d do not. Splitting the
 * ladder by interval is what keeps liquidation bands at a plausible distance from price
 * instead of smeared across the whole grid.
 */
const SCALPING_TIERS = [10, 25, 50, 100];
const SWING_TIERS = [3, 5, 10, 25];

/** Share of notional assigned to each tier, most-leveraged first. */
export const CAPITAL_SPLIT = [0.35, 0.3, 0.2, 0.15] as const;

/**
 * Where positions are assumed to have been opened within a candle. Close carries the most
 * weight because it is the only price every participant in the candle actually saw settle.
 */
export const ANCHOR_WEIGHTS = { close: 0.45, high: 0.275, low: 0.275 } as const;

export function modeForInterval(interval: Interval): Mode {
  return interval === '4h' || interval === '1d' ? 'swing' : 'scalping';
}

export function tiersForMode(mode: Mode): number[] {
  return mode === 'swing' ? [...SWING_TIERS] : [...SCALPING_TIERS];
}

/** Price at which a long opened at `entry` with leverage `L` is liquidated. */
export function longLiqPrice(entry: number, leverage: number): number {
  return entry * (1 - 1 / leverage);
}

/** Price at which a short opened at `entry` with leverage `L` is liquidated. */
export function shortLiqPrice(entry: number, leverage: number): number {
  return entry * (1 + 1 / leverage);
}
