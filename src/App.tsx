import { useCallback, useMemo, useState } from 'react';
import type { Interval } from './engine/types';
import { tiersForMode, modeForInterval } from './engine/tiers';
import { topBands, bandsWithin } from './engine/bands';
import { scaleBandsTo100 } from './engine/alerts';
import { BAND_WINDOW_PCT, DEFAULT_SETTINGS, DEFAULT_VIEW, PRESET_SYMBOLS } from './config';
import { HeatmapCanvas } from './ui/HeatmapCanvas';
import { Toolbar } from './ui/Toolbar';
import { Watchlist } from './ui/Watchlist';
import { Settings } from './ui/Settings';
import { StatusBar } from './ui/StatusBar';
import { usePersisted } from './ui/hooks/usePersisted';
import { useHeatmap } from './ui/hooks/useHeatmap';
import { useLive } from './ui/hooks/useLive';
import { useWatchlist } from './ui/hooks/useWatchlist';
import { useAlerts } from './ui/hooks/useAlerts';

export default function App() {
  const [view, patchView] = usePersisted('liqmap.view', DEFAULT_VIEW);
  const [settings, patchSettings] = usePersisted('liqmap.settings', DEFAULT_SETTINGS);
  const [nonce, setNonce] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { symbol, interval, enabledTiers } = view;
  const tiers = useMemo(() => tiersForMode(modeForInterval(interval)), [interval]);

  const { map, loading, error } = useHeatmap(symbol, interval, nonce);

  // A custom symbol joins the live feed and the watchlist strip alongside the presets.
  const symbols = useMemo(
    () => (PRESET_SYMBOLS.includes(symbol) ? PRESET_SYMBOLS : [...PRESET_SYMBOLS, symbol]),
    [symbol],
  );

  const { prices, status, tape } = useLive(symbols, symbol);
  const watchBands = useWatchlist(symbols, interval);
  const livePrice = prices[symbol] ?? map?.candles.at(-1)?.close ?? null;

  /** Bands of the focused symbol's latest column, honouring the tier toggles. */
  const focusBands = useMemo(() => {
    if (!map || map.nCols === 0) return [];
    const raw = topBands(map.matrices, enabledTiers, map.grid, map.nCols, map.nCols - 1, 60);
    const last = livePrice ?? map.candles[map.nCols - 1].close;
    return scaleBandsTo100(bandsWithin(raw, last, BAND_WINDOW_PCT));
  }, [map, enabledTiers, livePrice]);

  const alerts = useAlerts(symbol, livePrice, focusBands, settings);

  const onToggleTier = useCallback(
    (i: number) => {
      const next = [...enabledTiers];
      next[i] = !next[i];
      // Leave at least one tier on; an all-off chart looks like a failed load.
      if (next.some(Boolean)) patchView({ enabledTiers: next });
    },
    [enabledTiers, patchView],
  );

  return (
    <div className="app">
      <Toolbar
        symbol={symbol}
        interval={interval}
        tiers={tiers}
        enabledTiers={enabledTiers}
        onSymbol={(s) => patchView({ symbol: s })}
        onInterval={(i: Interval) => patchView({ interval: i })}
        onToggleTier={onToggleTier}
        onRefresh={() => setNonce((n) => n + 1)}
        onSettings={() => setSettingsOpen(true)}
      />

      <Watchlist
        symbols={symbols}
        active={symbol}
        prices={prices}
        bands={watchBands}
        minScore={settings.alertMinScore}
        onSelect={(s) => patchView({ symbol: s })}
      />

      <main className="main">
        <HeatmapCanvas
          map={loading ? null : map}
          enabledTiers={enabledTiers}
          livePrice={livePrice}
          interval={interval}
        />
      </main>

      <StatusBar
        status={status}
        symbol={symbol}
        candles={map?.nCols ?? 0}
        mode={map ? `${map.mode} · ${tiers.join('/')}×` : null}
        error={error}
        tape={tape}
      />

      <Settings
        open={settingsOpen}
        values={settings}
        alerts={alerts}
        onChange={patchSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
