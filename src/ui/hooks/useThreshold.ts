import { useCallback, useEffect, useState } from 'react';
import type { Interval } from '../../engine/types';

/**
 * Minimum-pool threshold, remembered per symbol and timeframe.
 *
 * Kept out of the global settings object on purpose: a cut-off that makes BTC's book
 * readable is meaningless on DOGE, and one that suits 4h is wrong on 5m. Each pairing gets
 * its own memory, and an unseen pairing starts at 0 — show everything.
 */
export function useThreshold(symbol: string, interval: Interval) {
  const key = `liqmap.threshold.${symbol}:${interval}`;
  const [usd, setUsd] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw != null ? Number(raw) : 0;
      setUsd(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    } catch {
      setUsd(0);
    }
  }, [key]);

  const set = useCallback(
    (next: number) => {
      const v = Number.isFinite(next) && next > 0 ? next : 0;
      setUsd(v);
      try {
        if (v > 0) window.localStorage.setItem(key, String(v));
        else window.localStorage.removeItem(key);
      } catch {
        // A full or blocked storage quota must not break the control.
      }
    },
    [key],
  );

  return [usd, set] as const;
}
