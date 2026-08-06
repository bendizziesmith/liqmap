import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKlines, fetchOpenInterest, fetchTicker, BybitError } from './rest';

function ok(result: unknown) {
  return {
    ok: true,
    json: async () => ({ retCode: 0, retMsg: 'OK', result }),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchKlines', () => {
  // Bybit returns newest-first tuples of strings.
  const list = [
    ['3000', '3', '3.5', '2.5', '3.2', '10', '1000'],
    ['2000', '2', '2.5', '1.5', '2.2', '20', '2000'],
    ['1000', '1', '1.5', '0.5', '1.2', '30', '3000'],
  ];

  it('parses the string tuples into numeric candles', async () => {
    fetchMock.mockResolvedValue(ok({ list }));
    const candles = await fetchKlines('BTCUSDT', '4h');
    expect(candles[0]).toEqual({
      start: 1000,
      open: 1,
      high: 1.5,
      low: 0.5,
      close: 1.2,
      volume: 30,
      turnover: 3000,
    });
  });

  it('reverses Bybit newest-first order into oldest-first', async () => {
    fetchMock.mockResolvedValue(ok({ list }));
    const candles = await fetchKlines('BTCUSDT', '4h');
    expect(candles.map((c) => c.start)).toEqual([1000, 2000, 3000]);
  });

  it('maps app intervals onto Bybit interval codes', async () => {
    fetchMock.mockResolvedValue(ok({ list: [] }));
    await fetchKlines('BTCUSDT', '4h');
    expect(fetchMock.mock.calls[0][0]).toContain('interval=240');

    await fetchKlines('BTCUSDT', '1d');
    expect(fetchMock.mock.calls[1][0]).toContain('interval=D');

    await fetchKlines('BTCUSDT', '5m');
    expect(fetchMock.mock.calls[2][0]).toContain('interval=5');
  });

  it('pages backwards with the end parameter when asked for older history', async () => {
    fetchMock.mockResolvedValue(ok({ list: [] }));
    await fetchKlines('BTCUSDT', '4h', 1771617599999);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('end=1771617599999');
  });

  it('omits end for the first page', async () => {
    fetchMock.mockResolvedValue(ok({ list: [] }));
    await fetchKlines('BTCUSDT', '4h');
    expect(fetchMock.mock.calls[0][0] as string).not.toContain('end=');
  });

  it('requests the linear category and a full 1000-candle page', async () => {
    fetchMock.mockResolvedValue(ok({ list: [] }));
    await fetchKlines('ETHUSDT', '1h');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('category=linear');
    expect(url).toContain('symbol=ETHUSDT');
    expect(url).toContain('limit=1000');
  });

  it('throws BybitError carrying the API code and message', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ retCode: 10001, retMsg: 'params error', result: {} }),
    } as Response);

    await expect(fetchKlines('NOPE', '4h')).rejects.toThrowError(BybitError);
    await expect(fetchKlines('NOPE', '4h')).rejects.toMatchObject({
      retCode: 10001,
      retMsg: 'params error',
    });
  });

  it('returns an empty array for an unknown symbol rather than throwing', async () => {
    fetchMock.mockResolvedValue(ok({ list: [] }));
    expect(await fetchKlines('FAKEUSDT', '4h')).toEqual([]);
  });

  it('surfaces a transport failure as BybitError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(fetchKlines('BTCUSDT', '4h')).rejects.toThrowError(BybitError);
  });
});

describe('fetchOpenInterest', () => {
  it('maps app intervals onto Bybit intervalTime codes', async () => {
    fetchMock.mockResolvedValue(ok({ list: [], nextPageCursor: '' }));
    await fetchOpenInterest('BTCUSDT', '5m', 10);
    expect(fetchMock.mock.calls[0][0]).toContain('intervalTime=5min');

    await fetchOpenInterest('BTCUSDT', '4h', 10);
    expect(fetchMock.mock.calls[1][0]).toContain('intervalTime=4h');

    await fetchOpenInterest('BTCUSDT', '1d', 10);
    expect(fetchMock.mock.calls[2][0]).toContain('intervalTime=1d');
  });

  it('follows nextPageCursor until the requested count is reached', async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          list: [{ timestamp: '3000', openInterest: '30' }],
          nextPageCursor: 'page2',
        }),
      )
      .mockResolvedValueOnce(
        ok({
          list: [{ timestamp: '2000', openInterest: '20' }],
          nextPageCursor: 'page3',
        }),
      )
      .mockResolvedValueOnce(
        ok({
          list: [{ timestamp: '1000', openInterest: '10' }],
          nextPageCursor: '',
        }),
      );

    const oi = await fetchOpenInterest('BTCUSDT', '4h', 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=page2');
    expect(oi).toHaveLength(3);
  });

  it('returns points oldest-first with numeric fields', async () => {
    fetchMock.mockResolvedValue(
      ok({
        list: [
          { timestamp: '2000', openInterest: '20.5' },
          { timestamp: '1000', openInterest: '10.5' },
        ],
        nextPageCursor: '',
      }),
    );
    const oi = await fetchOpenInterest('BTCUSDT', '4h', 10);
    expect(oi).toEqual([
      { timestamp: 1000, openInterest: 10.5 },
      { timestamp: 2000, openInterest: 20.5 },
    ]);
  });

  it('stops when the cursor runs out even if short of the target', async () => {
    fetchMock.mockResolvedValue(
      ok({ list: [{ timestamp: '1000', openInterest: '10' }], nextPageCursor: '' }),
    );
    const oi = await fetchOpenInterest('BTCUSDT', '4h', 500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(oi).toHaveLength(1);
  });

  it('degrades to an empty series instead of throwing, so the map still builds', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await fetchOpenInterest('BTCUSDT', '4h', 10)).toEqual([]);
  });
});

describe('fetchTicker', () => {
  it('extracts the last price and the open-interest notional', async () => {
    fetchMock.mockResolvedValue(
      ok({
        list: [
          {
            symbol: 'BTCUSDT',
            lastPrice: '64123.5',
            price24hPcnt: '0.0123',
            openInterestValue: '229730518.91',
          },
        ],
      }),
    );
    const t = await fetchTicker('BTCUSDT');
    expect(t).toEqual({
      symbol: 'BTCUSDT',
      price: 64123.5,
      changePct: 1.23,
      openInterestValue: 229730518.91,
    });
  });

  it('reports zero open interest when the field is absent, so the scale falls back to 1', () => {
    fetchMock.mockResolvedValue(ok({ list: [{ symbol: 'BTCUSDT', lastPrice: '1' }] }));
    return fetchTicker('BTCUSDT').then((t) => expect(t?.openInterestValue).toBe(0));
  });

  it('returns null when the symbol is not listed', async () => {
    fetchMock.mockResolvedValue(ok({ list: [] }));
    expect(await fetchTicker('FAKEUSDT')).toBeNull();
  });
});
