import type { Interval } from './engine/types';
import type { ColormapId } from './engine/classes';
import type { StandingShareId } from './engine/tiers';

export const PRESET_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

export const INTERVALS: Interval[] = ['5m', '15m', '1h', '4h', '1d'];

export interface Settings {
  /** Minimum band strength (0-100, relative to the strongest band) worth alerting on. */
  alertMinScore: number;
  /** Fire when a qualifying band is within this percentage of price. */
  alertDistancePct: number;
  alertsEnabled: boolean;
  /**
   * Age unswept levels out by leverage instead of keeping them forever.
   *
   * On by default: without it the map shows dense shelves at prices the market left behind
   * years ago, which cannot represent positions anyone is still holding. Off reproduces the
   * clearing-only behaviour, for comparison.
   */
  levelDecay: boolean;
  /**
   * Soften band edges when the heat is upscaled, and the side panel's bars with them.
   *
   * On by default: the raster is a few hundred rows blown up to fill the plot, so hard
   * bucket edges read as deliberate structure the data does not actually have.
   */
  smoothRendering: boolean;
  /**
   * How a candle's wick clears resting levels.
   *
   * 'full' erases everything the candle range touched — the original rule, and the default.
   * 'partial' still erases the body span but keeps half of what only the wick reached:
   * exchanges liquidate on mark price, a spike does not fill every resting position, and
   * traders add margin. Measured on XRPUSDT 4h, 85% of everything cleared out of the
   * [0.98, 1.03] band went by wick — two thirds in one Jun-25 candle — but the parameter
   * sweep in docs/tuning-notes.md showed retention recovers too little of that band to
   * change its rank (0.59% -> 0.73% of book at 0.5, decay on), because decay ages whatever
   * a wick spares. Full stays the default until a knob actually moves the ranking; partial
   * is kept for comparison.
   */
  wickClearing: 'full' | 'partial';
  /**
   * Declared per-tier share of the STANDING book (lowest leverage first); seed weights are
   * derived as share / halfLife so the knob describes the book on screen, not the flow.
   *
   * The legacy seed split [0.35,0.30,0.20,0.15] times the half-lives is an accidental
   * standing split of ~61/26/8/2 toward 3x — a book that lives 20-33% from price, which is
   * why the far shelves dominated and the near-price walls the reference shows barely
   * registered. 'highLeverage' (15/20/30/35) matches perp reality and the reference's
   * near-price 25x walls; measured on XRPUSDT 4h it makes [1.00,1.04] the top below-price
   * cluster (0.59% -> 4.19% of book) while the far-above extras IMPROVE (51% -> 42%).
   */
  standingShare: StandingShareId;
}

export const DEFAULT_SETTINGS: Settings = {
  alertMinScore: 70,
  alertDistancePct: 1.5,
  alertsEnabled: false,
  levelDecay: true,
  smoothRendering: true,
  wickClearing: 'full',
  standingShare: 'highLeverage',
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
