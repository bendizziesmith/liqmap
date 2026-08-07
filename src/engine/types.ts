/** A closed OHLCV candle, normalised out of Bybit's string tuples. Oldest-first in arrays. */
export interface Candle {
  /** Candle open time, epoch ms. */
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Quote-currency volume. Drives the position-size weight. */
  turnover: number;
}

/** One open-interest observation. */
export interface OiPoint {
  timestamp: number;
  openInterest: number;
}

/** Leverage regime. Short intervals attract high leverage, long intervals low. */
export type Mode = 'scalping' | 'swing';

export type Interval = '5m' | '15m' | '1h' | '4h' | '1d';

/** A linear price axis discretised into fixed-width buckets. */
export interface Grid {
  min: number;
  max: number;
  nBuckets: number;
  /** Width of one bucket in quote currency. */
  step: number;
}

/**
 * The built heatmap. One matrix per tier, each `nCols * nBuckets` row-major by column,
 * so toggling a tier on or off is a render-only operation.
 */
export interface HeatmapData {
  grid: Grid;
  mode: Mode;
  tiers: number[];
  /** `matrices[tierIndex][col * nBuckets + bucket]` */
  matrices: Float32Array[];
  nCols: number;
  /** Candle backing each column, oldest-first. `candles[i]` ↔ column `i`. */
  candles: Candle[];
  /**
   * Active levels as of the *second-to-last* candle. Lets a still-forming candle be
   * re-seeded into the final column without replaying the whole walk.
   */
  baseline: Float32Array[];
  /** OI factor applied to the final candle, reused when that candle is re-seeded live. */
  lastOiFactor: number;
  /** Wick retention the walk was built with, reused when the forming candle re-seeds. */
  wickRetention: number;
  /** Seed split the walk used, reused when the forming candle re-seeds. */
  seedWeights: number[];
  /**
   * Per-tier survival factor applied once per candle, or `null` when decay is off.
   *
   * Stored so `reseedLast` can age the baseline the same way the walk did, rather than
   * re-deriving it and drifting out of step with the historical columns.
   */
  decayFactors: number[] | null;
}

/** Modelling switches for a build. Off by default: the engine assumes nothing unasked. */
export interface BuildOptions {
  /**
   * Age unswept levels out exponentially by leverage.
   *
   * The clearing rule alone treats every never-swept level as a standing position, but most
   * positions close without ever being liquidated, so old levels are ghosts.
   */
  decay?: boolean;
  /**
   * Fraction of a wick-only-swept level that survives (0 = full clearing, today's rule).
   *
   * Candle bodies always clear fully; this softens only what a spike wicked through.
   */
  wickRetention?: number;
  /**
   * Declared standing split of the live book per tier (see STANDING_SHARES).
   *
   * Seed weights are derived as share / halfLife so the knob describes the book the user
   * sees, not the flow that feeds it. Omitted = 'current', the legacy behaviour.
   */
  standingShare?: 'current' | 'flat' | 'highLeverage';
}

/** A contiguous run of high-score buckets, used by the watchlist and alerts. */
export interface Band {
  price: number;
  score: number;
}
