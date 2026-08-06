import { useEffect, useRef, useState } from 'react';
import { BybitSocket, type ConnectionStatus, type LiquidationEvent } from '../../data/ws';
import { fetchTicker } from '../../data/rest';
import { POLL_MS } from '../../config';

export interface LiveState {
  prices: Record<string, number>;
  status: ConnectionStatus;
  /** Most recent liquidations for the focused symbol, newest first. */
  tape: LiquidationEvent[];
}

const TAPE_LIMIT = 40;

/**
 * One socket for every symbol on screen, plus a REST safety net.
 *
 * The poll runs only while the socket is not live, so the normal path costs no HTTP traffic
 * at all — but a blocked WebSocket (corporate proxy, flaky mobile network) still shows
 * moving prices instead of a frozen chart.
 */
export function useLive(symbols: string[], focus: string): LiveState {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [tape, setTape] = useState<LiquidationEvent[]>([]);
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const key = symbols.join(',');

  useEffect(() => {
    const list = key.split(',').filter(Boolean);
    if (list.length === 0) return;

    setTape([]);

    const socket = new BybitSocket({
      onStatus: setStatus,
      onTicker: ({ symbol, price }) => {
        setPrices((p) => (p[symbol] === price ? p : { ...p, [symbol]: price }));
      },
      onLiquidation: (e) => {
        if (e.symbol !== focusRef.current) return;
        setTape((t) => [e, ...t].slice(0, TAPE_LIMIT));
      },
    });
    socket.connect(list);

    return () => socket.close();
  }, [key]);

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

  return { prices, status, tape };
}
