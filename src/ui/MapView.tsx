import { useCallback, useMemo } from 'react';
import type { Interval } from '../engine/types';
import { lastColumn, liquidationProfile } from '../engine/profile';
import { csvFilename, profileToCsv } from '../engine/profileCsv';
import { MAP_BINS, MAP_SCALP_INTERVAL, MAP_SWING_INTERVAL } from '../config';
import { calibrationScales, type UsdScales } from '../engine/calibrate';
import type { StandingShareId } from '../engine/tiers';
import { useHeatmap } from './hooks/useHeatmap';
import { ProfileChart } from './ProfileChart';
import type { PriceFormatter } from './hooks/usePriceFormat';
import type { ColormapId } from '../engine/classes';

interface Props {
  symbol: string;
  livePrice: number | null;
  nonce: number;
  formatPrice: PriceFormatter;
  colormapId: ColormapId;
  /** Open-interest notional, the anchor for each panel's displayed USD. */
  openInterestValue: number;
  /** Age unswept levels out. Must match the heatmap tab, or the two tabs disagree. */
  decay: boolean;
  /** Wick retention fraction; must also match the heatmap tab. */
  wickRetention: number;
  /** Declared standing split; must also match the heatmap tab. */
  standingShare: StandingShareId;
}

/** Trigger a client-side download. No server round trip, so it works offline too. */
function download(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function useMode(
  symbol: string,
  interval: Interval,
  livePrice: number | null,
  nonce: number,
  oiValue: number,
  decay: boolean,
  wickRetention: number,
  standingShare: StandingShareId,
) {
  const { map, loading, error } = useHeatmap(
    symbol, interval, nonce, decay, wickRetention, standingShare,
  );

  const profile = useMemo(() => {
    if (!map || map.nCols === 0) return null;
    // The split price decides which side is longs and which is shorts, so prefer the live
    // tick and fall back to the last close rather than rendering an arbitrary midpoint.
    const price = livePrice ?? map.candles[map.nCols - 1].close;
    return liquidationProfile(lastColumn(map), map.grid, price, {
      bins: MAP_BINS,
      tierLabels: map.tiers,
    });
  }, [map, livePrice]);

  const usdScale = useMemo(() => {
    if (!profile) return { long: 1, short: 1 };
    // Split the book at the price bin: each side anchors to the full OI on its own.
    let long = 0;
    let short = 0;
    profile.bins.forEach((b, i) => {
      if (i < profile.priceBinIndex) long += b.total;
      else if (i > profile.priceBinIndex) short += b.total;
    });
    return calibrationScales(oiValue, { long, short });
  }, [profile, oiValue]);

  return { profile, loading, error, tiers: map?.tiers ?? [], usdScale };
}

export function MapView({
  symbol,
  livePrice,
  nonce,
  formatPrice,
  colormapId,
  openInterestValue,
  decay,
  wickRetention,
  standingShare,
}: Props) {
  const scalp = useMode(symbol, MAP_SCALP_INTERVAL, livePrice, nonce, openInterestValue, decay, wickRetention, standingShare);
  const swing = useMode(symbol, MAP_SWING_INTERVAL, livePrice, nonce, openInterestValue, decay, wickRetention, standingShare);

  const exportMode = useCallback(
    (mode: 'scalping' | 'swing', interval: Interval, profile: typeof scalp.profile, scale: UsdScales) => {
      if (!profile) return;
      download(csvFilename(symbol, mode, interval), profileToCsv(profile, formatPrice, scale));
    },
    [symbol, formatPrice],
  );

  return (
    <div className="map">
      <ProfileChart
        title="Scalping"
        subtitle={`${symbol} · ${MAP_SCALP_INTERVAL} · ${scalp.tiers.join('/') || '10/25/50/100'}×`}
        profile={scalp.profile}
        loading={scalp.loading}
        error={scalp.error}
        onExport={() => exportMode('scalping', MAP_SCALP_INTERVAL, scalp.profile, scalp.usdScale)}
        formatPrice={formatPrice}
        colormapId={colormapId}
        usdScale={scalp.usdScale}
        datasetKey={`${symbol}:${MAP_SCALP_INTERVAL}:${nonce}:${decay}:${wickRetention}:${standingShare}`}
      />

      <ProfileChart
        title="Swing"
        subtitle={`${symbol} · ${MAP_SWING_INTERVAL} · ${swing.tiers.join('/') || '3/5/10/25'}×`}
        profile={swing.profile}
        loading={swing.loading}
        error={swing.error}
        onExport={() => exportMode('swing', MAP_SWING_INTERVAL, swing.profile, swing.usdScale)}
        formatPrice={formatPrice}
        colormapId={colormapId}
        usdScale={swing.usdScale}
        datasetKey={`${symbol}:${MAP_SWING_INTERVAL}:${nonce}:${decay}:${wickRetention}:${standingShare}`}
      />

      <p className="map__help">
        Bars are <strong>estimated USD notional</strong> at each level, modelled from candle
        turnover — not exchange-reported positions. Taller means a stronger expected reaction:
        price tends to be drawn toward these levels and to accelerate through them. Below
        current price is long liquidations, above is shorts.
      </p>
    </div>
  );
}
