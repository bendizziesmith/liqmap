import { useEffect, useRef, useState } from 'react';
import { BybitSocket, type ConnectionStatus, type LiquidationEvent } from '../../data/ws';
import { fetchTicker } from '../../data/rest';
import { POLL_MS } from '../../config';
import type { Candle } from '../../engine/types';

export interface LiveState {
  prices: Record<string, number>;
  status: ConnectionStatus;
  /** Most recent liquidations for the focused symbol, newest first. */
  tape: LiquidationEvent[];
  /** Latest still-forming candle for the focused symbol, or null. */
  formingCandle: Candle | null;
  /** Bumped whenever a candle closes, so the caller can refetch for the new one. */
  candleClosed: number;
}

const TAPE_LIMIT = 40;

/** Minimum gap between forming-candle re-seeds. Bybit pushes klines faster than this. */
const KLINE_THROTTLE_MS = 900;

/**
 * One socket for every symbol on screen, plus a REST safety net.
 *
 * The poll runs only while the socket is not live, so the normal path costs no HTTP traffic
 * at all — but a blocked WebSocket (corporate proxy, flaky mobile network) still shows
 * moving prices instead of a frozen chart.
 */
export function useLive(symbols: string[], focus: string, klineInterval?: string): LiveState {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [tape, setTape] = useState<LiquidationEvent[]>([]);
  const [formingCandle, setFormingCandle] = useState<Candle | null>(null);
  const [candleClosed, setCandleClosed] = useState(0);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const lastKlineAt = useRef(0);

  const key = symbols.join(',');

  useEffect(() => {
    const list = key.split(',').filter(Boolean);
    if (list.length === 0) return;

    setTape([]);
    setFormingCandle(null);

    const socket = new BybitSocket({
      onStatus: setStatus,
      onTicker: ({ symbol, price }) => {
        setPrices((p) => (p[symbol] === price ? p : { ...p, [symbol]: price }));
      },
      onLiquidation: (e) => {
        if (e.symbol !== focusRef.current) return;
        setTape((t) => [e, ...t].slice(0, TAPE_LIMIT));
      },
      onKline: ({ symbol, confirm, candle }) => {
        if (symbol !== focusRef.current) return;
        if (confirm) {
          // A new candle has opened. Its levels shift the grid, so refetch rather than
          // trying to extend the existing one in place.
          setCandleClosed((n) => n + 1);
          setFormingCandle(null);
          lastKlineAt.current = 0;
          return;
        }
        // Bybit pushes kline updates several times a second. Each one costs a re-seed and
        // a full repaint, so throttle to a rate a human can actually perceive.
        const now = Date.now();
        if (now - lastKlineAt.current < KLINE_THROTTLE_MS) return;
        lastKlineAt.current = now;
        setFormingCandle(candle);
      },
    });
    socket.connect(list, { klineSymbol: focus, klineInterval });

    return () => socket.close();
  }, [key, focus, klineInterval]);

  // REST fallback, active only while the socket is down.
  useEffect(() => {
    if (status === 'live') return;
    const list = key.split(',').filter(Boolean);
    if (list.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      const results = await Promise.all(list.map((s) => fetchTicker(s).catch(() => null)));
      if (cancelled) return;
      setPrices((p) => {
        const next = { ...p };
        for (const t of results) if (t) next[t.symbol] = t.price;
        return next;
      });
    };

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [key, status]);

  return { prices, status, tape, formingCandle, candleClosed };
}
