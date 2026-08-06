const ENDPOINT = 'wss://stream.bybit.com/v5/public/linear';

/** Bybit closes idle public sockets; 20s keeps us comfortably inside that window. */
const PING_MS = 20_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface TickerUpdate {
  symbol: string;
  price: number;
}

export interface LiquidationEvent {
  symbol: string;
  /** Which side of the book got liquidated. */
  side: 'long' | 'short';
  size: number;
  price: number;
  time: number;
}

export interface SocketHandlers {
  onTicker?: (t: TickerUpdate) => void;
  onLiquidation?: (e: LiquidationEvent) => void;
  onStatus?: (s: ConnectionStatus) => void;
}

/**
 * Bybit public linear stream: live price plus the liquidation tape.
 *
 * Reconnects with exponential backoff on unexpected close, and stays down after a
 * deliberate `close()` so switching symbols does not leave orphaned sockets racing.
 */
export class BybitSocket {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private symbols: string[] = [];
  private deliberatelyClosed = false;

  constructor(private handlers: SocketHandlers = {}) {}

  connect(symbols: string[]): void {
    this.symbols = symbols;
    this.deliberatelyClosed = false;
    this.open();
  }

  private open(): void {
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const ws = new WebSocket(ENDPOINT);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus('live');

      const args = this.symbols.flatMap((s) => [`tickers.${s}`, `allLiquidation.${s}`]);
      if (args.length > 0) ws.send(JSON.stringify({ op: 'subscribe', args }));

      this.pingTimer = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ op: 'ping' }));
      }, PING_MS);
    };

    ws.onmessage = (event) => this.handleMessage(event.data as string);
    ws.onerror = () => {};
    ws.onclose = () => {
      this.clearPing();
      if (this.deliberatelyClosed) return;
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: string): void {
    let msg: { topic?: string; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // A malformed frame is not worth tearing the socket down for.
    }
    if (!msg.topic) return;

    if (msg.topic.startsWith('tickers.')) {
      const d = msg.data as { symbol?: string; lastPrice?: string } | undefined;
      // Ticker frames are deltas: most carry no price at all.
      if (d?.lastPrice != null && d.symbol) {
        this.handlers.onTicker?.({ symbol: d.symbol, price: Number(d.lastPrice) });
      }
      return;
    }

    if (msg.topic.startsWith('allLiquidation.')) {
      const rows = (msg.data ?? []) as Array<{
        T?: number;
        s?: string;
        S?: string;
        v?: string;
        p?: string;
      }>;
      for (const r of rows) {
        if (!r.s) continue;
        this.handlers.onLiquidation?.({
          symbol: r.s,
          // Bybit reports the side of the liquidating order: a Buy order closes a short.
          side: r.S === 'Buy' ? 'short' : 'long',
          size: Number(r.v ?? 0),
          price: Number(r.p ?? 0),
          time: Number(r.T ?? 0),
        });
      }
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_MAX_MS);
    this.attempt++;
    this.setStatus('reconnecting');
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private setStatus(s: ConnectionStatus): void {
    this.handlers.onStatus?.(s);
  }

  close(): void {
    this.deliberatelyClosed = true;
    this.clearPing();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const ws = this.ws;
    this.ws = null;

    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      if (ws.readyState === 0) {
        // Closing mid-handshake makes browsers log a warning, and StrictMode's dev
        // double-mount hits this on every load. Let the handshake finish, then hang up.
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    }

    this.setStatus('closed');
  }
}
