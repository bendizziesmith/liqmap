import type { ConnectionStatus, LiquidationEvent } from '../data/ws';

interface Props {
  status: ConnectionStatus;
  symbol: string;
  candles: number;
  mode: string | null;
  error: string | null;
  tape: LiquidationEvent[];
}

const LABEL: Record<ConnectionStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  closed: 'Closed',
};

export function StatusBar({ status, symbol, candles, mode, error, tape }: Props) {
  return (
    <footer className="status">
      <span className="pill" data-state={status}>
        <span className="pill__dot" aria-hidden="true" />
        {LABEL[status]}
      </span>

      <span className="status__item">{symbol}</span>
      {mode && <span className="status__item">{mode}</span>}
      <span className="status__item">{candles} candles</span>

      {error && <span className="status__err">{error}</span>}

      <div className="tape" aria-label="Recent liquidations">
        {tape.slice(0, 6).map((e, i) => (
          <span className="tape__item" key={`${e.time}-${i}`} data-side={e.side}>
            {e.side === 'long' ? 'L' : 'S'} {e.size.toPrecision(3)} @ {e.price.toPrecision(6)}
          </span>
        ))}
      </div>
    </footer>
  );
}
