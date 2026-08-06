import type { Band } from '../engine/types';
import { nearestBand } from '../engine/bands';

interface Props {
  symbols: string[];
  active: string;
  prices: Record<string, number>;
  bands: Record<string, Band[]>;
  minScore: number;
  onSelect: (s: string) => void;
}

function fmtPrice(p: number | undefined): string {
  if (p === undefined) return '—';
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(3);
  return p.toFixed(5);
}

export function Watchlist({ symbols, active, prices, bands, minScore, onSelect }: Props) {
  return (
    <nav className="watch" aria-label="Watchlist">
      {symbols.map((s) => {
        const price = prices[s];
        const near = price ? nearestBand(bands[s] ?? [], price, minScore) : null;
        const dist = near?.distancePct;
        // Under 0.5% away is close enough that it is about to matter.
        const hot = dist !== undefined && Math.abs(dist) < 0.5;

        return (
          <button
            key={s}
            type="button"
            className="watch__item"
            aria-current={s === active}
            onClick={() => onSelect(s)}
          >
            <span className="watch__sym">{s.replace('USDT', '')}</span>
            <span className="watch__price">{fmtPrice(price)}</span>
            <span className="watch__dist" data-hot={hot || undefined} data-none={!near || undefined}>
              {dist === undefined
                ? '—'
                : `${dist >= 0 ? '▲' : '▼'} ${Math.abs(dist).toFixed(2)}%`}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
