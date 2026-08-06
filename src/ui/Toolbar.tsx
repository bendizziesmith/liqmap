import { useState, type FormEvent } from 'react';
import type { Interval } from '../engine/types';
import type { Tab } from '../config';
import { INTERVALS, PRESET_SYMBOLS } from '../config';
import { TIER_COLORS } from '../engine/colormap';
import { PanelIcon, RefreshIcon, SettingsIcon } from './icons';

interface Props {
  symbol: string;
  interval: Interval;
  tab: Tab;
  tiers: number[];
  enabledTiers: boolean[];
  showProfile: boolean;
  profileLocked: boolean;
  onSymbol: (s: string) => void;
  onInterval: (i: Interval) => void;
  onTab: (t: Tab) => void;
  onToggleTier: (i: number) => void;
  onToggleProfile: () => void;
  onRefresh: () => void;
  onSettings: () => void;
}

export function Toolbar({
  symbol,
  interval,
  tab,
  tiers,
  enabledTiers,
  showProfile,
  profileLocked,
  onSymbol,
  onInterval,
  onTab,
  onToggleTier,
  onToggleProfile,
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

      <div className="seg seg--tabs" role="group" aria-label="View">
        <button
          type="button"
          className="seg__btn"
          aria-pressed={tab === 'heatmap'}
          onClick={() => onTab('heatmap')}
        >
          Heatmap
        </button>
        <button
          type="button"
          className="seg__btn"
          aria-pressed={tab === 'map'}
          onClick={() => onTab('map')}
        >
          Map
        </button>
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

      {tab === 'heatmap' && (
        <>
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
                className="seg__btn seg__btn--tier"
                style={{ '--tier': TIER_COLORS[i] } as React.CSSProperties}
                aria-pressed={enabledTiers[i]}
                onClick={() => onToggleTier(i)}
                title={`Toggle ${t}x liquidation levels`}
              >
                <i className="seg__swatch" aria-hidden="true" />
                {t}×
              </button>
            ))}
          </div>
        </>
      )}

      <div className="bar__actions">
        {tab === 'heatmap' && (
          <button
            type="button"
            className="btn btn--icon"
            onClick={onToggleProfile}
            aria-pressed={showProfile && !profileLocked}
            disabled={profileLocked}
            aria-label="Toggle liquidation profile panel"
            title={
              profileLocked
                ? 'Profile panel is hidden on narrow screens'
                : 'Toggle liquidation profile panel'
            }
          >
            <PanelIcon />
          </button>
        )}
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
