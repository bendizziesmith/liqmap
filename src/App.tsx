import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Interval } from './engine/types';
import { tiersForMode, modeForInterval } from './engine/tiers';
import { topBands, bandsWithin } from './engine/bands';
import { lastColumn } from './engine/profile';
import { priceToBucket } from './engine/grid';
import { calibrationScales, sumActiveSides } from './engine/calibrate';
import { scaleBandsTo100 } from './engine/alerts';
import { BAND_WINDOW_PCT, DEFAULT_SETTINGS, DEFAULT_VIEW, PRESET_SYMBOLS, type Tab } from './config';
import { HeatmapCanvas } from './ui/HeatmapCanvas';
import { MapView } from './ui/MapView';
import { Toolbar } from './ui/Toolbar';
import { Watchlist } from './ui/Watchlist';
import { Settings } from './ui/Settings';
import { StatusBar } from './ui/StatusBar';
import { usePersisted } from './ui/hooks/usePersisted';
import { useHeatmap, useLiveHeatmap } from './ui/hooks/useHeatmap';
import { useLive } from './ui/hooks/useLive';
import { KLINE_INTERVAL } from './data/rest';
import { useWatchlist } from './ui/hooks/useWatchlist';
import { useAlerts } from './ui/hooks/useAlerts';
import { useMedia } from './ui/hooks/useMedia';
import { usePriceFormats } from './ui/hooks/usePriceFormat';
import type { ColormapId } from './engine/classes';

export default function App() {
  const [view, patchView] = usePersisted('liqmap.view', DEFAULT_VIEW);
  const [settings, patchSettings] = usePersisted('liqmap.settings', DEFAULT_SETTINGS);
  const [nonce, setNonce] = useState(0);
  const [closedNonce, setClosedNonce] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { symbol, interval, enabledTiers, tab, showProfile, colormap } = view;


  const tiers = useMemo(() => tiersForMode(modeForInterval(interval)), [interval]);

  // 90px of profile is not affordable on a phone, so it collapses regardless of preference.
  const narrow = useMedia('(max-width: 720px)');
  const profileVisible = showProfile && !narrow;

  const fetched = useHeatmap(symbol, interval, nonce + closedNonce, settings.levelDecay);
  const { loadOlder, loadingOlder, prependedCount } = fetched;

  // A custom symbol joins the live feed and the watchlist strip alongside the presets.
  const symbols = useMemo(
    () => (PRESET_SYMBOLS.includes(symbol) ? PRESET_SYMBOLS : [...PRESET_SYMBOLS, symbol]),
    [symbol],
  );

  // One lookup for every symbol on screen: the watchlist needs each instrument's own
  // precision, not the focused symbol's.
  const formatFor = usePriceFormats(symbols);
  const formatPrice = formatFor(symbol);

  const { prices, status, tape, formingCandle, candleClosed, openInterest } = useLive(
    symbols,
    symbol,
    KLINE_INTERVAL[interval],
  );

  // Fold the forming candle into the map so a sweep clears its bars without a reload.
  const { map, error } = useLiveHeatmap(fetched, formingCandle);

  // A closed candle needs a refetch: the new one can extend the price range, which means
  // rebucketing every column rather than re-seeding the last.
  useEffect(() => {
    if (candleClosed > 0) setClosedNonce((n) => n + 1);
  }, [candleClosed]);
  const watchBands = useWatchlist(symbols, interval, settings.levelDecay);
  const livePrice = prices[symbol] ?? map?.candles.at(-1)?.close ?? null;

  /** Bands of the focused symbol's latest column, honouring the tier toggles. */
  const focusBands = useMemo(() => {
    if (!map || map.nCols === 0) return [];
    const raw = topBands(map.matrices, enabledTiers, map.grid, map.nCols, map.nCols - 1, 60);
    const last = livePrice ?? map.candles[map.nCols - 1].close;
    return scaleBandsTo100(bandsWithin(raw, last, BAND_WINDOW_PCT));
  }, [map, enabledTiers, livePrice]);

  /**
   * Displayed USD is denominated in open interest.
   *
   * Raw bucket values are cumulative turnover that flowed through a level over the whole
   * window; only currently-open positions can actually liquidate, so the active book is
   * scaled to total the reported open interest. Display only — no engine value moves.
   */
  const usdScale = useMemo(() => {
    if (!map || map.nCols === 0) return { long: 1, short: 1 };
    const price = livePrice ?? map.candles[map.nCols - 1].close;
    const priceBucket = priceToBucket(map.grid, price);
    return calibrationScales(openInterest[symbol] ?? 0, sumActiveSides(lastColumn(map), priceBucket));
  }, [map, openInterest, symbol, livePrice]);

  const alerts = useAlerts(symbol, livePrice, focusBands, settings, formatPrice);

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
        tab={tab}
        tiers={tiers}
        enabledTiers={enabledTiers}
        showProfile={showProfile}
        profileLocked={narrow}
        onSymbol={(s) => patchView({ symbol: s })}
        onInterval={(i: Interval) => patchView({ interval: i })}
        onTab={(t: Tab) => patchView({ tab: t })}
        onToggleTier={onToggleTier}
        onToggleProfile={() => patchView({ showProfile: !showProfile })}
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
        formatFor={formatFor}
      />

      <main className="main">
        {tab === 'heatmap' ? (
          /* Keep the previous map during a background refetch: useHeatmap retains it, so
             blanking to a "Loading" overlay would hide a perfectly usable chart. */
          <HeatmapCanvas
            map={map}
            enabledTiers={enabledTiers}
            livePrice={livePrice}
            interval={interval}
            showProfile={profileVisible}
            formatPrice={formatPrice}
            colormapId={colormap}
            usdScale={usdScale}
            resetKey={`${symbol}:${interval}:${nonce + closedNonce}`}
            onNeedOlder={loadOlder}
            loadingOlder={loadingOlder}
            prependedCount={prependedCount}
          />
        ) : (
          <MapView
            symbol={symbol}
            livePrice={livePrice}
            nonce={nonce}
            formatPrice={formatPrice}
            colormapId={colormap}
            openInterestValue={openInterest[symbol] ?? 0}
            decay={settings.levelDecay}
          />
        )}
      </main>

      <StatusBar
        status={status}
        symbol={symbol}
        candles={map?.nCols ?? 0}
        mode={map ? `${map.mode} · ${tiers.join('/')}×` : null}
        error={error}
        tape={tape}
        formatPrice={formatPrice}
      />

      <footer className="disclaimer">
        Liquidation levels and USD figures are <strong>estimates</strong> modelled from public
        market data — exchanges do not publish per-position leverage or open positions. Not
        exchange-reported, and not financial advice.
      </footer>

      <Settings
        open={settingsOpen}
        values={settings}
        alerts={alerts}
        onChange={patchSettings}
        onClose={() => setSettingsOpen(false)}
        formatPrice={formatPrice}
        colormap={colormap}
        onColormap={(id: ColormapId) => patchView({ colormap: id })}
      />
    </div>
  );
}
