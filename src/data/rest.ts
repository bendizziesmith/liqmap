import type { Candle, Interval, OiPoint } from '../engine/types';

const BASE = 'https://api.bybit.com';

/** Bybit's kline interval codes. */
const KLINE_INTERVAL: Record<Interval, string> = {
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

/** Bybit's open-interest interval codes, which differ in spelling from the kline ones. */
const OI_INTERVAL: Record<Interval, string> = {
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

export class BybitError extends Error {
  constructor(
    message: string,
    readonly retCode: number,
    readonly retMsg: string,
  ) {
    super(message);
    this.name = 'BybitError';
  }
}

interface Envelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new BybitError(`Bybit HTTP ${res.status}`, res.status, `HTTP ${res.status}`);
  }

  const body = (await res.json()) as Envelope<T>;
  if (body.retCode !== 0) {
    throw new BybitError(`Bybit: ${body.retMsg}`, body.retCode, body.retMsg);
  }
  return body.result;
}

/**
 * Up to 1000 closed candles, returned oldest-first.
 *
 * Bybit hands back newest-first tuples of strings; the engine walks forward through time,
 * so the reversal happens here rather than being everyone else's problem.
 */
export async function fetchKlines(symbol: string, interval: Interval): Promise<Candle[]> {
  const result = await get<{ list: string[][] }>('/v5/market/kline', {
    category: 'linear',
    symbol,
    interval: KLINE_INTERVAL[interval],
    limit: '1000',
  });

  const candles = (result.list ?? []).map(
    ([start, open, high, low, close, volume, turnover]): Candle => ({
      start: Number(start),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      turnover: Number(turnover),
    }),
  );

  return candles.reverse();
}

/**
 * Open-interest history, oldest-first, paginated via `nextPageCursor`.
 *
 * OI only modulates the weighting, so a failure here degrades the map rather than breaking
 * it: callers get an empty series and the engine falls back to a neutral factor.
 */
export async function fetchOpenInterest(
  symbol: string,
  interval: Interval,
  need: number,
): Promise<OiPoint[]> {
  const points: OiPoint[] = [];
  let cursor = '';

  try {
    while (points.length < need) {
      const params: Record<string, string> = {
        category: 'linear',
        symbol,
        intervalTime: OI_INTERVAL[interval],
        limit: '200',
      };
      if (cursor) params.cursor = cursor;

      const result = await get<{
        list: Array<{ timestamp: string; openInterest: string }>;
        nextPageCursor?: string;
      }>('/v5/market/open-interest', params);

      const page = result.list ?? [];
      for (const p of page) {
        points.push({ timestamp: Number(p.timestamp), openInterest: Number(p.openInterest) });
      }

      cursor = result.nextPageCursor ?? '';
      if (!cursor || page.length === 0) break;
    }
  } catch {
    return [];
  }

  return points.sort((a, b) => a.timestamp - b.timestamp);
}

export interface Ticker {
  symbol: string;
  price: number;
  changePct: number;
}

/** Last traded price. Used for the initial paint and as the WebSocket fallback. */
export async function fetchTicker(symbol: string): Promise<Ticker | null> {
  const result = await get<{
    list: Array<{ symbol: string; lastPrice: string; price24hPcnt?: string }>;
  }>('/v5/market/tickers', { category: 'linear', symbol });

  const row = (result.list ?? [])[0];
  if (!row) return null;

  return {
    symbol: row.symbol,
    price: Number(row.lastPrice),
    changePct: Number(row.price24hPcnt ?? 0) * 100,
  };
}
