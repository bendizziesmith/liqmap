import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, HeatmapData, Interval } from '../../engine/types';
import { buildHeatmap, reseedLast } from '../../engine/build';
import type { StandingShareId } from '../../engine/tiers';
import { MAX_CANDLES, mergeOlder } from '../../engine/history';
import { fetchKlines, fetchOpenInterest } from '../../data/rest';

/** Minimum gap between history pages; each one rebuilds the whole matrix set. */
const PREPEND_COOLDOWN_MS = 800;

interface State {
  map: HeatmapData | null;
  loading: boolean;
  error: string | null;
}

export interface HeatmapState extends State {
  /** Pull the next page of older candles. No-op while one is in flight or at the cap. */
  loadOlder: () => void;
  loadingOlder: boolean;
  atCap: boolean;
  /** Total candles prepended so far, so a view can shift to stay put. */
  prependedCount: number;
}

/**
 * Fold a still-forming candle into an already-built map.
 *
 * Only applies when the websocket candle is the one the map already ends on: a newer start
 * means a candle closed, which the caller handles by refetching.
 */
export function useLiveHeatmap(state: State, forming: Candle | null): State {
  const map = useMemo(() => {
    const base = state.map;
    if (!base || base.nCols === 0 || !forming) return base;
    if (forming.start !== base.candles[base.nCols - 1].start) return base;
    return reseedLast(base, forming);
  }, [state.map, forming]);

  return map === state.map ? state : { ...state, map };
}

export function useHeatmap(
  symbol: string,
  interval: Interval,
  nonce: number,
  decay = false,
  wickRetention = 0,
  standingShare: StandingShareId = 'current',
): HeatmapState {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [oi, setOi] = useState<Parameters<typeof buildHeatmap>[1]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [prependedCount, setPrependedCount] = useState(0);

  const inFlight = useRef(false);
  const exhausted = useRef(false);
  const lastPrependAt = useRef(0);
  /**
   * Mirrors `candles` so `loadOlder` can stay identity-stable.
   *
   * Closing over the state instead meant two calls could compute the same `end` bound, both
   * fetch the same page, and the second land as pure duplicates.
   */
  const candlesRef = useRef<Candle[]>([]);
  candlesRef.current = candles;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPrependedCount(0);
    exhausted.current = false;
    lastPrependAt.current = 0;

    (async () => {
      try {
        const fresh = await fetchKlines(symbol, interval);
        if (cancelled) return;

        // Open interest is a weighting refinement, never a hard dependency: fetchOpenInterest
        // resolves to [] on failure and the engine falls back to a neutral factor.
        const points = await fetchOpenInterest(symbol, interval, fresh.length);
        if (cancelled) return;

        setCandles(fresh);
        setOi(points);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setCandles([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to load market data');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, interval, nonce]);

  const loadOlder = useCallback(() => {
    const loaded = candlesRef.current;
    if (inFlight.current || exhausted.current) return;
    if (loaded.length === 0 || loaded.length >= MAX_CANDLES) return;
    // Each page is a full rebuild allocating the whole matrix set, so pace them: back to
    // back requests spike memory faster than the collector reclaims the previous build.
    if (Date.now() - lastPrependAt.current < PREPEND_COOLDOWN_MS) return;

    inFlight.current = true;
    setLoadingOlder(true);

    // `end` is inclusive, so step back one millisecond from the oldest loaded candle.
    fetchKlines(symbol, interval, loaded[0].start - 1)
      .then((older) => {
        // Only an empty response means history has actually run out. A page that overlaps
        // entirely is a harmless no-op, and treating it as the end would strand the chart
        // permanently on whatever it had already loaded.
        if (older.length === 0) {
          exhausted.current = true;
          return;
        }
        // Merged outside the updater on purpose. A state updater must be pure: StrictMode
        // invokes it twice, so bumping the prepend counter from inside counted every page
        // twice while the candles grew once, and the view drifted permanently out of step
        // with the map it describes.
        const prev = candlesRef.current;
        const merged = mergeOlder(prev, older);
        const added = merged.length - prev.length;
        if (added <= 0) return;

        candlesRef.current = merged;
        setCandles(merged);
        setPrependedCount((n) => n + added);
      })
      .catch(() => {
        // A failed page is not fatal; the user can pan again to retry.
      })
      .finally(() => {
        inFlight.current = false;
        lastPrependAt.current = Date.now();
        setLoadingOlder(false);
      });
    // Identity-stable on purpose: a callback that changed with every candle update would
    // re-fire the caller's effect and stack concurrent page requests.
  }, [symbol, interval]);

  /**
   * The clearing rule replays from the oldest candle, so a prepend cannot be patched into
   * the existing matrices — it is a full rebuild by definition.
   */
  const map = useMemo(
    () =>
      candles.length > 0
        ? buildHeatmap(candles, oi, interval, { decay, wickRetention, standingShare })
        : null,
    [candles, oi, interval, decay, wickRetention, standingShare],
  );

  return {
    map,
    loading,
    error,
    loadOlder,
    loadingOlder,
    atCap: candles.length >= MAX_CANDLES,
    prependedCount,
  };
}
