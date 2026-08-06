/**
 * USD formatting for estimated notional.
 *
 * Every figure these produce is an *estimate* derived from public market data, so callers
 * label them "est." — the formatter deliberately does not bake that in, because it is also
 * used for axis ticks where the label sits elsewhere.
 */

const UNITS: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

function format(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '$0';

  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  for (const [scale, suffix] of UNITS) {
    if (abs >= scale) return `${sign}$${(abs / scale).toFixed(decimals)}${suffix}`;
  }
  return `${sign}$${Math.round(abs)}`;
}

/** Compact form for dense UI: `$12.4K`, `$3.2M`, `$1.1B`. */
export function formatUsd(value: number): string {
  return format(value, 1);
}

/** Two-decimal form for tooltips, where the extra digit is readable and useful. */
export function formatUsdPrecise(value: number): string {
  return format(value, 2);
}
