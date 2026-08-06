import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BybitSocket } from './ws';

/** Minimal scriptable WebSocket stand-in. No network, no timers of its own. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;

  url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  die() {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];

describe('connection', () => {
  it('connects to the public linear stream', () => {
    new BybitSocket().connect(['BTCUSDT']);
    expect(last().url).toBe('wss://stream.bybit.com/v5/public/linear');
  });

  it('subscribes to tickers and liquidations for every symbol on open', () => {
    new BybitSocket().connect(['BTCUSDT', 'ETHUSDT']);
    last().open();

    const frame = JSON.parse(last().sent[0]);
    expect(frame.op).toBe('subscribe');
    expect(frame.args).toEqual([
      'tickers.BTCUSDT',
      'allLiquidation.BTCUSDT',
      'tickers.ETHUSDT',
      'allLiquidation.ETHUSDT',
    ]);
  });

  it('reports the live status only once the socket is open', () => {
    const statuses: string[] = [];
    const s = new BybitSocket({ onStatus: (x) => statuses.push(x) });
    s.connect(['BTCUSDT']);
    expect(statuses).toContain('connecting');
    last().open();
    expect(statuses).toContain('live');
  });
});

describe('heartbeat', () => {
  it('pings every 20 seconds while open', () => {
    new BybitSocket().connect(['BTCUSDT']);
    last().open();
    const before = last().sent.length;

    vi.advanceTimersByTime(20_000);
    expect(JSON.parse(last().sent[before]).op).toBe('ping');

    vi.advanceTimersByTime(20_000);
    expect(last().sent.filter((m) => m.includes('ping'))).toHaveLength(2);
  });

  it('stops pinging after close', () => {
    const s = new BybitSocket();
    s.connect(['BTCUSDT']);
    last().open();
    const sock = last();
    s.close();

    const before = sock.sent.length;
    vi.advanceTimersByTime(60_000);
    expect(sock.sent.length).toBe(before);
  });
});

describe('message handling', () => {
  it('reports ticker prices', () => {
    const ticks: Array<{ symbol: string; price: number }> = [];
    const s = new BybitSocket({ onTicker: (t) => ticks.push(t) });
    s.connect(['BTCUSDT']);
    last().open();

    last().emit({ topic: 'tickers.BTCUSDT', data: { symbol: 'BTCUSDT', lastPrice: '64000.5' } });
    expect(ticks).toEqual([{ symbol: 'BTCUSDT', price: 64000.5 }]);
  });

  it('ignores a ticker delta that carries no price', () => {
    const ticks: unknown[] = [];
    const s = new BybitSocket({ onTicker: (t) => ticks.push(t) });
    s.connect(['BTCUSDT']);
    last().open();

    last().emit({ topic: 'tickers.BTCUSDT', data: { symbol: 'BTCUSDT', fundingRate: '0.0001' } });
    expect(ticks).toEqual([]);
  });

  it('reads side Buy as a short being liquidated', () => {
    const events: Array<{ side: string }> = [];
    const s = new BybitSocket({ onLiquidation: (e) => events.push(e) });
    s.connect(['BTCUSDT']);
    last().open();

    last().emit({
      topic: 'allLiquidation.BTCUSDT',
      data: [{ T: 1, s: 'BTCUSDT', S: 'Buy', v: '2', p: '64000' }],
    });
    expect(events[0].side).toBe('short');
  });

  it('reads side Sell as a long being liquidated', () => {
    const events: Array<{ side: string; size: number; price: number }> = [];
    const s = new BybitSocket({ onLiquidation: (e) => events.push(e) });
    s.connect(['BTCUSDT']);
    last().open();

    last().emit({
      topic: 'allLiquidation.BTCUSDT',
      data: [{ T: 1, s: 'BTCUSDT', S: 'Sell', v: '2.5', p: '64000' }],
    });
    expect(events[0]).toMatchObject({ side: 'long', size: 2.5, price: 64000 });
  });

  it('survives a malformed frame without throwing', () => {
    const s = new BybitSocket();
    s.connect(['BTCUSDT']);
    last().open();
    expect(() => last().onmessage?.({ data: 'not json' })).not.toThrow();
  });
});

describe('reconnection', () => {
  it('reconnects after an unexpected close', () => {
    new BybitSocket().connect(['BTCUSDT']);
    last().open();
    expect(FakeSocket.instances).toHaveLength(1);

    last().die();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('backs off further on each successive failure', () => {
    new BybitSocket().connect(['BTCUSDT']);

    last().die();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);

    last().die();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2); // too soon, backoff has grown
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('waits for the handshake before closing a still-connecting socket', () => {
    // Closing mid-handshake makes browsers log a console warning, and React StrictMode
    // mounts twice in dev, so this path runs on every page load.
    const s = new BybitSocket();
    s.connect(['BTCUSDT']);
    const sock = last();
    expect(sock.readyState).toBe(0);

    s.close();
    expect(sock.closed).toBe(false);

    sock.open();
    expect(sock.closed).toBe(true);
  });

  it('does not reconnect after a deferred close completes', () => {
    const s = new BybitSocket();
    s.connect(['BTCUSDT']);
    const sock = last();
    s.close();
    sock.open();
    sock.die();

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after a deliberate close', () => {
    const s = new BybitSocket();
    s.connect(['BTCUSDT']);
    last().open();
    s.close();

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('resets backoff once a connection succeeds', () => {
    new BybitSocket().connect(['BTCUSDT']);
    last().die();
    vi.advanceTimersByTime(1000);
    last().open(); // success resets the counter
    last().die();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(3);
  });
});
