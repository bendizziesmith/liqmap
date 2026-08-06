import type { Interval } from './engine/types';
import type { ColormapId } from './engine/classes';

export const PRESET_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

export const INTERVALS: Interval[] = ['5m', '15m', '1h', '4h', '1d'];

export interface Settings {
  /** Minimum band strength (0-100, relative to the strongest band) worth alerting on. */
  alertMinScore: number;
  /** Fire when a qualifying band is within this percentage of price. */
  alertDistancePct: number;
  alertsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  alertMinScore: 70,
  alertDistancePct: 1.5,
  alertsEnabled: false,
};

export type Tab = 'heatmap' | 'map';

export interface ViewState {
  symbol: string;
  interval: Interval;
  /** Which leverage tiers are painted. Render-only — toggling never rebuilds the engine. */
  enabledTiers: boolean[];
  tab: Tab;
  /** Right-docked liquidation profile on the heatmap. */
  showProfile: boolean;
  colormap: ColormapId;
}

export const DEFAULT_VIEW: ViewState = {
  symbol: 'BTCUSDT',
  interval: '4h',
  enabledTiers: [true, true, true, true],
  tab: 'heatmap',
  showProfile: true,
  colormap: 'inferno',
};

/**
 * The Map view's two modes are the two leverage regimes, so their intervals are fixed
 * rather than following the heatmap tab — a "Scalping" panel built from 1d candles would
 * make its own label a lie.
 */
export const MAP_SCALP_INTERVAL: Interval = '1h';
export const MAP_SWING_INTERVAL: Interval = '4h';

/** Display resolution for the Map view. The raw grid is 1100 buckets, finer than any screen. */
export const MAP_BINS = 200;

/** Do not re-notify about the same level more often than this. */
export const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

/** How long a watchlist symbol's heatmap stays fresh before a rebuild. */
export const WATCHLIST_TTL_MS = 5 * 60 * 1000;

/** REST ticker poll cadence used whenever the socket is not live. */
export const POLL_MS = 15_000;

/**
 * Band strength is judged within this percentage of price. Wide enough to cover the tiers
 * that realistically get hit, narrow enough to exclude the unswept shelf at the grid edges.
 */
export const BAND_WINDOW_PCT = 12;
