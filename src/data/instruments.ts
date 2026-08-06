const BASE = 'https://api.bybit.com';

/**
 * Tick sizes, cached for the session.
 *
 * An instrument's price increment does not change while someone has the chart open, so this
 * is fetched once per symbol and kept. Failures are not cached, so a transient outage during
 * startup does not pin the symbol to the fallback heuristic for the whole session.
 */
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

/** Exposed for tests; the app never needs to clear this. */
export function __resetInstrumentCache(): void {
  cache.clear();
  inFlight.clear();
}

async function load(symbol: string): Promise<string | null> {
  try {
    const url = `${BASE}/v5/market/instruments-info?${new URLSearchParams({
      category: 'linear',
      symbol,
    })}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const body = (await res.json()) as {
      retCode: number;
      result?: { list?: Array<{ priceFilter?: { tickSize?: string } }> };
    };
    if (body.retCode !== 0) return null;

    const tick = body.result?.list?.[0]?.priceFilter?.tickSize;
    if (!tick) return null;

    cache.set(symbol, tick);
    return tick;
  } catch {
    return null;
  }
}

/** Tick size for a linear perpetual, or null if it cannot be determined. */
export function fetchTickSize(symbol: string): Promise<string | null> {
  const hit = cache.get(symbol);
  if (hit !== undefined) return Promise.resolve(hit);

  const pending = inFlight.get(symbol);
  if (pending) return pending;

  // Share one request between concurrent callers, and drop it once settled so a failure
  // does not become sticky.
  const promise = load(symbol).finally(() => inFlight.delete(symbol));
  inFlight.set(symbol, promise);
  return promise;
}
