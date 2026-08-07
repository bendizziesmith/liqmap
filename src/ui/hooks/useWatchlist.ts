import { useEffect, useState } from 'react';
import type { Band, Interval } from '../../engine/types';
import { buildHeatmap } from '../../engine/build';
import { topBands, bandsWithin } from '../../engine/bands';
import { scaleBandsTo100 } from '../../engine/alerts';
import { fetchKlines, fetchOpenInterest } from '../../data/rest';
import { TtlCache } from '../../data/cache';
import { BAND_WINDOW_PCT, WATCHLIST_TTL_MS } from '../../config';

/** Shared across mounts so switching symbols does not refetch what is still fresh. */
const cache = new TtlCache<Band[]>(WATCHLIST_TTL_MS);

const ALL_TIERS = [true, true, true, true];

async function bandsFor(
  symbol: string,
  interval: Interval,
  decay: boolean,
  wickRetention: number,
): Promise<Band[]> {
  const candles = await fetchKlines(symbol, interval);
  if (candles.length === 0) return [];

  const oi = await fetchOpenInterest(symbol, interval, candles.length);
  const map = buildHeatmap(candles, oi, interval, { decay, wickRetention });

  // The latest column is the only one that describes levels still pending right now.
  const bands = topBands(map.matrices, ALL_TIERS, map.grid, map.nCols, map.nCols - 1, 60);
  const last = map.candles[map.nCols - 1].close;
  return scaleBandsTo100(bandsWithin(bands, last, BAND_WINDOW_PCT));
}

/**
 * Band profiles for every watchlist symbol.
 *
 * Each symbol gets a real engine run rather than borrowing the focused symbol's levels,
 * which is the only way "distance to the nearest magnet" means anything per row. Requests
 * are staggered so five symbols do not hit Bybit's rate limiter in the same tick.
 */
export function useWatchlist(
  symbols: string[],
  interval: Interval,
  decay = false,
  wickRetention = 0,
) {
  const [bands, setBands] = useState<Record<string, Band[]>>({});
  const key = symbols.join(',');

  useEffect(() => {
    const list = key.split(',').filter(Boolean);
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    list.forEach((symbol, i) => {
      timers.push(
        setTimeout(async () => {
          try {
            // Decay is part of the cache key: the same symbol under a different modelling
            // assumption is different data, not a cache hit.
            const result = await cache.get(`${symbol}:${interval}:${decay}:${wickRetention}`, () =>
              bandsFor(symbol, interval, decay, wickRetention),
            );
            if (!cancelled) setBands((b) => ({ ...b, [symbol]: result }));
          } catch {
            // A single failing row must not blank the whole strip.
          }
        }, i * 250),
      );
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [key, interval, decay, wickRetention]);

  return bands;
}
