import { describe, it, expect } from 'vitest';
import { decimalsFromTickSize, heuristicDecimals, makePriceFormatter } from './price';

describe('decimalsFromTickSize', () => {
  it('reads the real Bybit tick sizes for the preset symbols', () => {
    expect(decimalsFromTickSize('0.10')).toBe(1); // BTCUSDT
    expect(decimalsFromTickSize('0.01')).toBe(2); // ETHUSDT
    expect(decimalsFromTickSize('0.0001')).toBe(4); // XRPUSDT, ADAUSDT
    expect(decimalsFromTickSize('0.00001')).toBe(5); // DOGEUSDT
  });

  it('handles whole-number ticks', () => {
    expect(decimalsFromTickSize('1')).toBe(0);
    expect(decimalsFromTickSize('5')).toBe(0);
  });

  it('ignores trailing zeros beyond the significant digit', () => {
    // 0.10 is a one-decimal tick even though it is written with two.
    expect(decimalsFromTickSize('0.10')).toBe(1);
    expect(decimalsFromTickSize('0.500')).toBe(1);
  });

  it('handles scientific notation', () => {
    expect(decimalsFromTickSize('1e-4')).toBe(4);
  });

  it('returns null for unusable input so the caller can fall back', () => {
    expect(decimalsFromTickSize('')).toBeNull();
    expect(decimalsFromTickSize('abc')).toBeNull();
    expect(decimalsFromTickSize('0')).toBeNull();
  });

  it('caps absurd precision rather than emitting a 20-decimal axis', () => {
    expect(decimalsFromTickSize('0.000000000001')).toBeLessThanOrEqual(8);
  });
});

describe('heuristicDecimals', () => {
  it('is only a fallback, keyed off magnitude', () => {
    expect(heuristicDecimals(64000)).toBe(1);
    expect(heuristicDecimals(1900)).toBe(1);
    expect(heuristicDecimals(1.05)).toBe(4);
    expect(heuristicDecimals(0.0699)).toBe(5);
  });
});

describe('makePriceFormatter', () => {
  it('renders XRP at four decimals on both sides of a dollar', () => {
    // The bug this replaces: 1.050 above the line, 0.9716 below it.
    const fmt = makePriceFormatter(4);
    expect(fmt(1.05)).toBe('1.0500');
    expect(fmt(0.9716)).toBe('0.9716');
    expect(fmt(1.05).length).toBe(fmt(0.9716).length);
  });

  it('renders BTC at one decimal', () => {
    expect(makePriceFormatter(1)(64860.55)).toBe('64860.6');
  });

  it('renders DOGE at five decimals', () => {
    expect(makePriceFormatter(5)(0.069742)).toBe('0.06974');
  });

  it('renders ETH at two decimals', () => {
    expect(makePriceFormatter(2)(1910.567)).toBe('1910.57');
  });

  it('keeps a constant width across a decade boundary', () => {
    const fmt = makePriceFormatter(4);
    expect(fmt(9.9999).length).toBe(fmt(10.0001).length - 1); // one more integer digit only
    expect(fmt(0.5).split('.')[1].length).toBe(fmt(5).split('.')[1].length);
  });

  it('emits plain parseable numbers with no separators', () => {
    const fmt = makePriceFormatter(1);
    expect(fmt(1234567.89)).toBe('1234567.9');
    expect(Number.isFinite(Number(fmt(1234567.89)))).toBe(true);
  });

  it('survives non-finite input', () => {
    const fmt = makePriceFormatter(2);
    expect(fmt(NaN)).toBe('—');
    expect(fmt(Infinity)).toBe('—');
  });

  it('falls back to the magnitude heuristic when decimals are unknown', () => {
    const fmt = makePriceFormatter(null);
    expect(fmt(64860.55)).toBe('64860.6');
    expect(fmt(1.05)).toBe('1.0500');
  });
});
