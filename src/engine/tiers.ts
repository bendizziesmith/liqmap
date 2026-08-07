import type { Interval, Mode } from './types';

/**
 * Traders on fast charts run hot leverage; swing traders on 4h/1d do not. Splitting the
 * ladder by interval is what keeps liquidation bands at a plausible distance from price
 * instead of smeared across the whole grid.
 */
const SCALPING_TIERS = [10, 25, 50, 100];
const SWING_TIERS = [3, 5, 10, 25];

/**
 * Share of notional assigned to each tier at SEED time, lowest leverage first.
 *
 * Kept as the legacy constant: under decay, standing mass is seedWeight x halfLife (each
 * tier converges on deposit/(1-f) — see decay.test.ts), so these seed weights produce an
 * EFFECTIVE standing split of ~61/26/8/2 toward 3x, which concentrates the book 20-33%
 * away from price. `seedSplit` below derives seed weights from a declared standing split
 * instead, so the knob says what it means.
 */
export const CAPITAL_SPLIT = [0.35, 0.3, 0.2, 0.15] as const;

/**
 * Intended share of the LIVE (standing) book per tier, lowest leverage first.
 *
 * 'current' is the standing split today's CAPITAL_SPLIT accidentally produces, kept as the
 * like-for-like baseline. 'flat' gives each tier an equal standing footprint. 'highLeverage'
 * matches how crypto perp open interest actually skews — most standing risk sits in the
 * high-leverage brackets near price, which is also what the reference tool's near-price
 * walls show.
 */
export const STANDING_SHARES = {
  current: [0.625, 0.268, 0.084, 0.023],
  flat: [0.25, 0.25, 0.25, 0.25],
  highLeverage: [0.15, 0.2, 0.3, 0.35],
} as const;

export type StandingShareId = keyof typeof STANDING_SHARES;

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

/**
 * Seed weights that make the standing book split as declared, given each tier's half-life.
 *
 * Standing mass converges on seedWeight / (1 - decayFactor) ~ seedWeight x halfLife, so the
 * weight that yields a target standing share is share / halfLife, renormalized to sum to 1
 * — conservation is a property of the sum, not of any particular split.
 */
export function seedSplit(
  standing: readonly number[],
  halfLives: readonly number[],
): number[] {
  const raw = standing.map((s, i) => s / halfLives[i]);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / total);
}

/** Price at which a long opened at `entry` with leverage `L` is liquidated. */
export function longLiqPrice(entry: number, leverage: number): number {
  return entry * (1 - 1 / leverage);
}

/** Price at which a short opened at `entry` with leverage `L` is liquidated. */
export function shortLiqPrice(entry: number, leverage: number): number {
  return entry * (1 + 1 / leverage);
}
