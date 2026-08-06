import { useState, type FormEvent } from 'react';
import type { Interval } from '../engine/types';
import { INTERVALS, PRESET_SYMBOLS } from '../config';
import { RefreshIcon, SettingsIcon } from './icons';

interface Props {
  symbol: string;
  interval: Interval;
  tiers: number[];
  enabledTiers: boolean[];
  onSymbol: (s: string) => void;
  onInterval: (i: Interval) => void;
  onToggleTier: (i: number) => void;
  onRefresh: () => void;
  onSettings: () => void;
}

export function Toolbar({
  symbol,
  interval,
  tiers,
  enabledTiers,
  onSymbol,
  onInterval,
  onToggleTier,
  onRefresh,
  onSettings,
}: Props) {
  const [custom, setCustom] = useState('');

  const submitCustom = (e: FormEvent) => {
    e.preventDefault();
    const next = custom.trim().toUpperCase();
    if (next) {
      onSymbol(next);
      setCustom('');
    }
  };

  return (
    <header className="bar">
      <div className="bar__brand">
        <span className="bar__mark" aria-hidden="true" />
        <span className="bar__name">LiqMap</span>
      </div>

      <div className="seg seg--symbols" role="group" aria-label="Symbol">
        {PRESET_SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            className="seg__btn"
            aria-pressed={s === symbol}
            onClick={() => onSymbol(s)}
          >
            {s.replace('USDT', '')}
          </button>
        ))}
      </div>

      <form className="bar__custom" onSubmit={submitCustom}>
        <label className="sr-only" htmlFor="custom-symbol">
          Custom Bybit linear perpetual symbol
        </label>
        <input
          id="custom-symbol"
          className="input"
          placeholder="SOLUSDT"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn btn--ghost">
          Go
        </button>
      </form>

      <div className="seg seg--intervals" role="group" aria-label="Interval">
        {INTERVALS.map((i) => (
          <button
            key={i}
            type="button"
            className="seg__btn"
            aria-pressed={i === interval}
            onClick={() => onInterval(i)}
          >
            {i}
          </button>
        ))}
      </div>

      <div className="seg seg--tiers" role="group" aria-label="Leverage tiers">
        {tiers.map((t, i) => (
          <button
            key={t}
            type="button"
            className="seg__btn"
            aria-pressed={enabledTiers[i]}
            onClick={() => onToggleTier(i)}
            title={`Toggle ${t}x liquidation levels`}
          >
            {t}×
          </button>
        ))}
      </div>

      <div className="bar__actions">
        <button type="button" className="btn btn--icon" onClick={onRefresh} aria-label="Refresh data">
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onSettings}
          aria-label="Open settings"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
