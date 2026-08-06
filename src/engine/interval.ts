import type { Interval } from './types';

/** Nominal duration of one candle. */
export const INTERVAL_MS: Record<Interval, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** The same durations in days, the unit level decay is expressed in. */
export const INTERVAL_DAYS: Record<Interval, number> = {
  '5m': INTERVAL_MS['5m'] / 864e5,
  '15m': INTERVAL_MS['15m'] / 864e5,
  '1h': INTERVAL_MS['1h'] / 864e5,
  '4h': INTERVAL_MS['4h'] / 864e5,
  '1d': 1,
};
