import { useCallback, useEffect, useMemo, useState } from 'react';
import { decimalsFromTickSize, makePriceFormatter } from '../../engine/price';
import { fetchTickSize } from '../../data/instruments';

export type PriceFormatter = (price: number) => string;

/**
 * Tick-size-derived decimals for a set of symbols.
 *
 * Returns a lookup rather than a single formatter because the watchlist renders five
 * instruments side by side, and each has its own increment — formatting them all at the
 * focused symbol's precision would print BTC as `64662.4000`.
 *
 * Renders immediately with the magnitude fallback and upgrades as lookups land, so nothing
 * blocks on the network.
 */
export function usePriceFormats(symbols: string[]): (symbol: string) => PriceFormatter {
  const [decimals, setDecimals] = useState<Record<string, number | null>>({});
  const key = symbols.join(',');

  useEffect(() => {
    let cancelled = false;
    const list = key.split(',').filter(Boolean);

    for (const symbol of list) {
      fetchTickSize(symbol).then((tick) => {
        if (cancelled) return;
        const d = tick ? decimalsFromTickSize(tick) : null;
        setDecimals((prev) => (prev[symbol] === d ? prev : { ...prev, [symbol]: d }));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [key]);

  const formatters = useMemo(() => {
    const out: Record<string, PriceFormatter> = {};
    for (const symbol of Object.keys(decimals)) {
      out[symbol] = makePriceFormatter(decimals[symbol]);
    }
    return out;
  }, [decimals]);

  const fallback = useMemo(() => makePriceFormatter(null), []);

  return useCallback(
    (symbol: string) => formatters[symbol] ?? fallback,
    [formatters, fallback],
  );
}

/** Convenience wrapper for the single focused symbol. */
export function usePriceFormat(symbol: string): PriceFormatter {
  const formats = usePriceFormats(useMemo(() => [symbol], [symbol]));
  return formats(symbol);
}
