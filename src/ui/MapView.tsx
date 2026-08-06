import { useCallback, useMemo } from 'react';
import type { Interval } from '../engine/types';
import { lastColumn, liquidationProfile } from '../engine/profile';
import { csvFilename, profileToCsv } from '../engine/profileCsv';
import { MAP_BINS, MAP_SCALP_INTERVAL, MAP_SWING_INTERVAL } from '../config';
import { useHeatmap } from './hooks/useHeatmap';
import { ProfileChart } from './ProfileChart';

interface Props {
  symbol: string;
  livePrice: number | null;
  nonce: number;
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

function useMode(symbol: string, interval: Interval, livePrice: number | null, nonce: number) {
  const { map, loading, error } = useHeatmap(symbol, interval, nonce);

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

  return { profile, loading, error, tiers: map?.tiers ?? [] };
}

export function MapView({ symbol, livePrice, nonce }: Props) {
  const scalp = useMode(symbol, MAP_SCALP_INTERVAL, livePrice, nonce);
  const swing = useMode(symbol, MAP_SWING_INTERVAL, livePrice, nonce);

  const exportMode = useCallback(
    (mode: 'scalping' | 'swing', interval: Interval, profile: typeof scalp.profile) => {
      if (!profile) return;
      download(csvFilename(symbol, mode, interval), profileToCsv(profile));
    },
    [symbol],
  );

  return (
    <div className="map">
      <ProfileChart
        title="Scalping"
        subtitle={`${symbol} · ${MAP_SCALP_INTERVAL} · ${scalp.tiers.join('/') || '10/25/50/100'}×`}
        profile={scalp.profile}
        loading={scalp.loading}
        error={scalp.error}
        onExport={() => exportMode('scalping', MAP_SCALP_INTERVAL, scalp.profile)}
      />

      <ProfileChart
        title="Swing"
        subtitle={`${symbol} · ${MAP_SWING_INTERVAL} · ${swing.tiers.join('/') || '3/5/10/25'}×`}
        profile={swing.profile}
        loading={swing.loading}
        error={swing.error}
        onExport={() => exportMode('swing', MAP_SWING_INTERVAL, swing.profile)}
      />

      <p className="map__help">
        Bars are <strong>relative intensity</strong>, not contracts or USD. Taller means a
        stronger expected reaction — price tends to be drawn toward these levels and to
        accelerate through them. Below current price is long liquidations, above is shorts.
      </p>
    </div>
  );
}
