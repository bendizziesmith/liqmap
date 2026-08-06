import type { Band } from './types';

export interface AlertCandidate extends Band {
  /** Signed percentage from current price: positive above, negative below. */
  distancePct: number;
}

/**
 * Rescale a column's bands so the strongest reads 100.
 *
 * Raw scores are arbitrary units that shift with symbol and timeframe, so a user-facing
 * "alert above strength 70" threshold only means something on a relative scale.
 */
export function scaleBandsTo100(bands: Band[]): Band[] {
  if (bands.length === 0) return [];
  const peak = Math.max(...bands.map((b) => b.score));
  if (peak <= 0) return bands.map((b) => ({ ...b, score: 0 }));
  return bands.map((b) => ({ ...b, score: (b.score / peak) * 100 }));
}

/** Bands that are both strong enough and close enough to be worth interrupting the user. */
export function alertCandidates(
  bands: Band[],
  price: number,
  maxDistancePct: number,
  minScore: number,
): AlertCandidate[] {
  if (price <= 0) return [];

  return bands
    .filter((b) => b.score >= minScore)
    .map((b) => ({ ...b, distancePct: ((b.price - price) / price) * 100 }))
    .filter((c) => Math.abs(c.distancePct) <= maxDistancePct)
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));
}

/**
 * Dedup key for a band.
 *
 * Quantised to roughly 0.1-1% of price, which is coarse enough that a level drifting by a
 * bucket between rebuilds is still recognised as the same level and does not re-notify.
 */
export function alertKey(symbol: string, price: number): string {
  const magnitude = Math.max(price, 1e-9);
  const quantum = Math.pow(10, Math.floor(Math.log10(magnitude)) - 2);
  return `${symbol}@${Math.round(price / quantum)}`;
}

/** Filter candidates down to those outside their cooldown window. */
export function dueAlerts(
  symbol: string,
  candidates: AlertCandidate[],
  lastFired: Map<string, number>,
  now: number,
  cooldownMs: number,
): AlertCandidate[] {
  return candidates.filter((c) => {
    const at = lastFired.get(alertKey(symbol, c.price));
    return at === undefined || now - at >= cooldownMs;
  });
}
