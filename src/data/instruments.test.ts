import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTickSize, __resetInstrumentCache } from './instruments';

function ok(tickSize: string) {
  return {
    ok: true,
    json: async () => ({
      retCode: 0,
      retMsg: 'OK',
      result: { list: [{ symbol: 'XRPUSDT', priceFilter: { tickSize } }] },
    }),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetInstrumentCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('fetchTickSize', () => {
  it('reads priceFilter.tickSize', async () => {
    fetchMock.mockResolvedValue(ok('0.0001'));
    expect(await fetchTickSize('XRPUSDT')).toBe('0.0001');
  });

  it('requests the linear instrument for that symbol', async () => {
    fetchMock.mockResolvedValue(ok('0.0001'));
    await fetchTickSize('XRPUSDT');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v5/market/instruments-info');
    expect(url).toContain('category=linear');
    expect(url).toContain('symbol=XRPUSDT');
  });

  it('caches per symbol — instrument specs do not change intraday', async () => {
    fetchMock.mockResolvedValue(ok('0.0001'));
    await fetchTickSize('XRPUSDT');
    await fetchTickSize('XRPUSDT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches separately for a different symbol', async () => {
    fetchMock.mockResolvedValue(ok('0.10'));
    await fetchTickSize('XRPUSDT');
    await fetchTickSize('BTCUSDT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the symbol is unknown', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ retCode: 0, retMsg: 'OK', result: { list: [] } }),
    } as Response);
    expect(await fetchTickSize('NOPEUSDT')).toBeNull();
  });

  it('returns null rather than throwing when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await fetchTickSize('XRPUSDT')).toBeNull();
  });

  it('returns null on a Bybit error code', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ retCode: 10001, retMsg: 'params error', result: {} }),
    } as Response);
    expect(await fetchTickSize('XRPUSDT')).toBeNull();
  });

  it('does not cache a failure, so a transient outage can recover', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(ok('0.0001'));
    expect(await fetchTickSize('XRPUSDT')).toBeNull();
    expect(await fetchTickSize('XRPUSDT')).toBe('0.0001');
  });
});
