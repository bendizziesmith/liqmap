/**
 * Price formatting driven by the instrument's own tick size.
 *
 * Formatting by magnitude — the thing this replaces — makes precision flip whenever price
 * crosses a power of ten, so XRP rendered `1.050` above a dollar and `0.9716` below it and
 * every column jittered. The exchange already publishes the answer as `priceFilter.tickSize`.
 */

/** Beyond this a price axis is unreadable, whatever the instrument claims. */
const MAX_DECIMALS = 8;

/** Decimal places implied by a tick size string, or null if it cannot be read. */
export function decimalsFromTickSize(tickSize: string): number | null {
  const value = Number(tickSize);
  if (!Number.isFinite(value) || value <= 0) return null;

  // Derive from the value rather than the written text: Bybit writes BTC's tick as "0.10",
  // which is a one-decimal increment despite having two written digits.
  const decimals = Math.max(0, Math.ceil(-Math.log10(value)));
  return Math.min(MAX_DECIMALS, decimals);
}

/** Magnitude-based fallback, used only when the instrument lookup fails. */
export function heuristicDecimals(price: number): number {
  const p = Math.abs(price);
  if (p >= 1000) return 1;
  if (p >= 100) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  return 7;
}

/**
 * A formatter for one symbol. Pass null to fall back to the magnitude heuristic.
 *
 * Output is a plain number — no thousands separators or currency — so the same function can
 * feed an axis label and a CSV cell.
 */
export function makePriceFormatter(decimals: number | null): (price: number) => string {
  return (price: number) => {
    if (!Number.isFinite(price)) return '—';
    return price.toFixed(decimals ?? heuristicDecimals(price));
  };
}
