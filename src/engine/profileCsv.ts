import type { LiquidationProfile } from './profile';

/** Fixed four tier columns so the file shape does not change between scalping and swing. */
const TIER_COLUMNS = 4;

export const CSV_HEADER = 'price_from,price_to,L1,L2,L3,L4,cumulative';

/** Trim float noise without switching to exponent or locale formatting, which would not parse. */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 1e6) / 1e6);
}

/**
 * Serialise a profile to CSV.
 *
 * The single `cumulative` column carries whichever side of the split the row is on: the
 * long total below current price, the short total above. They are separate quantities, so
 * a row only ever has one of them.
 */
export function profileToCsv(profile: LiquidationProfile): string {
  const lines = [CSV_HEADER];

  for (let i = 0; i < profile.bins.length; i++) {
    const bin = profile.bins[i];
    const cumulative = i < profile.priceBinIndex ? bin.cumLong : bin.cumShort;

    const tiers: string[] = [];
    for (let t = 0; t < TIER_COLUMNS; t++) {
      tiers.push(num(bin.tiers[t] ?? 0));
    }

    lines.push(
      [num(bin.priceFrom), num(bin.priceTo), ...tiers, num(cumulative)].join(','),
    );
  }

  return lines.join('\n') + '\n';
}

/** Suggested filename, e.g. `liqmap-XRPUSDT-swing-4h.csv`. */
export function csvFilename(symbol: string, mode: string, interval: string): string {
  return `liqmap-${symbol}-${mode}-${interval}.csv`;
}
