import { useEffect, useMemo, useState } from 'react';
import type { Candle, HeatmapData, Interval } from '../../engine/types';
import { buildHeatmap, reseedLast } from '../../engine/build';
import { fetchKlines, fetchOpenInterest } from '../../data/rest';

interface State {
  map: HeatmapData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a symbol's history and build its heatmap.
 *
 * `nonce` lets the caller force a rebuild (the Refresh button) without changing symbol or
 * interval. Stale responses are dropped so fast symbol-switching cannot paint the wrong map.
 */
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

export function useHeatmap(symbol: string, interval: Interval, nonce: number): State {
  const [state, setState] = useState<State>({ map: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const candles = await fetchKlines(symbol, interval);
        if (cancelled) return;

        // Open interest is a weighting refinement, never a hard dependency: fetchOpenInterest
        // resolves to [] on failure and the engine falls back to a neutral factor.
        const oi = await fetchOpenInterest(symbol, interval, candles.length);
        if (cancelled) return;

        setState({ map: buildHeatmap(candles, oi, interval), loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          map: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load market data',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, interval, nonce]);

  return state;
}
