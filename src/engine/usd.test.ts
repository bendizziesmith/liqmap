import { describe, it, expect } from 'vitest';
import { formatUsd, formatUsdPrecise } from './usd';

describe('formatUsd', () => {
  it('shows plain dollars below a thousand', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(1)).toBe('$1');
    expect(formatUsd(950)).toBe('$950');
    expect(formatUsd(999)).toBe('$999');
  });

  it('switches to K at a thousand', () => {
    expect(formatUsd(1000)).toBe('$1.0K');
    expect(formatUsd(12_400)).toBe('$12.4K');
    expect(formatUsd(999_000)).toBe('$999.0K');
  });

  it('switches to M at a million', () => {
    expect(formatUsd(1_000_000)).toBe('$1.0M');
    expect(formatUsd(3_200_000)).toBe('$3.2M');
  });

  it('switches to B at a billion', () => {
    expect(formatUsd(1_100_000_000)).toBe('$1.1B');
    expect(formatUsd(3_660_000_000)).toBe('$3.7B');
  });

  it('switches to T at a trillion, rather than showing five-digit B', () => {
    expect(formatUsd(2_500_000_000_000)).toBe('$2.5T');
  });

  it('rounds to one decimal', () => {
    // Avoids the exact .x5 boundary: 12.45 is not representable in binary, so toFixed
    // rounds it down. Immaterial for an estimate, but not worth asserting either way.
    expect(formatUsd(12_440)).toBe('$12.4K');
    expect(formatUsd(12_460)).toBe('$12.5K');
  });

  it('handles negatives without mangling the sign', () => {
    expect(formatUsd(-3_200_000)).toBe('-$3.2M');
  });

  it('treats non-finite input as zero rather than printing NaN', () => {
    expect(formatUsd(NaN)).toBe('$0');
    expect(formatUsd(Infinity)).toBe('$0');
  });

  it('rounds sub-dollar amounts to whole dollars', () => {
    expect(formatUsd(0.4)).toBe('$0');
    expect(formatUsd(1.6)).toBe('$2');
  });
});

describe('formatUsdPrecise', () => {
  it('keeps two decimals for tooltip-grade figures', () => {
    expect(formatUsdPrecise(3_248_000)).toBe('$3.25M');
    expect(formatUsdPrecise(12_449)).toBe('$12.45K');
  });

  it('agrees with formatUsd on magnitude suffix', () => {
    expect(formatUsdPrecise(1_000_000_000).endsWith('B')).toBe(true);
  });
});
