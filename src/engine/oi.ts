import type { Candle, OiPoint } from './types';

/** Upper bound on the open-interest amplifier. */
const OI_FACTOR_MAX = 3;
/** How hard a percentage rise in OI pushes the amplifier. */
const OI_GAIN = 8;

/**
 * Project the open-interest series onto the candle timeline.
 *
 * Bybit's OI endpoint has its own cadence and its own gaps, so an exact timestamp join
 * would silently drop samples. Instead each candle takes the most recent OI observation at
 * or before its open, with the earliest sample back-filled to cover any leading candles.
 * Returns all zeros if there is no OI data, which `oiFactors` reads as "unknown".
 */
export function alignOi(candles: Candle[], oi: OiPoint[]): Float64Array {
  const out = new Float64Array(candles.length);
  if (oi.length === 0) return out;

  const sorted = [...oi].sort((a, b) => a.timestamp - b.timestamp);
  let i = 0;
  let current = sorted[0].openInterest;

  for (let c = 0; c < candles.length; c++) {
    while (i < sorted.length && sorted[i].timestamp <= candles[c].start) {
      current = sorted[i].openInterest;
      i++;
    }
    out[c] = current;
  }
  return out;
}

/**
 * Per-candle weight multiplier derived from open-interest growth.
 *
 * Rising OI means new positions are being opened, so the liquidation levels that candle
 * creates are more real. Falling OI means positions are closing — but closures do not make
 * *existing* levels less real, so the factor floors at 1 rather than shrinking.
 */
export function oiFactors(candles: Candle[], oi: OiPoint[]): Float64Array {
  const aligned = alignOi(candles, oi);
  const out = new Float64Array(candles.length).fill(1);
  if (oi.length === 0) return out;

  for (let i = 1; i < candles.length; i++) {
    const cur = aligned[i];
    const prev = aligned[i - 1];
    if (cur <= 0 || prev <= 0) continue;

    const growth = Math.max((cur - prev) / cur, 0);
    out[i] = Math.min(1 + OI_GAIN * growth, OI_FACTOR_MAX);
  }
  return out;
}
