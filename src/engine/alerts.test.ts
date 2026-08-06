import { describe, it, expect } from 'vitest';
import { scaleBandsTo100, alertCandidates, alertKey, dueAlerts } from './alerts';

describe('scaleBandsTo100', () => {
  it('maps the strongest band to 100', () => {
    const out = scaleBandsTo100([
      { price: 1, score: 4 },
      { price: 2, score: 8 },
    ]);
    expect(out[1].score).toBe(100);
    expect(out[0].score).toBe(50);
  });

  it('leaves prices untouched', () => {
    expect(scaleBandsTo100([{ price: 64000, score: 3 }])[0].price).toBe(64000);
  });

  it('handles an empty list', () => {
    expect(scaleBandsTo100([])).toEqual([]);
  });

  it('does not divide by zero when every band is empty', () => {
    expect(scaleBandsTo100([{ price: 1, score: 0 }])[0].score).toBe(0);
  });
});

describe('alertCandidates', () => {
  const bands = [
    { price: 99, score: 90 }, // -1%
    { price: 104, score: 40 }, // +4%
    { price: 110, score: 95 }, // +10%
    { price: 100.5, score: 20 }, // +0.5%, too weak
  ];

  it('returns only bands within the distance threshold', () => {
    const out = alertCandidates(bands, 100, 2, 0);
    expect(out.map((c) => c.price)).toEqual([100.5, 99]);
  });

  it('returns only bands at or above the score threshold', () => {
    const out = alertCandidates(bands, 100, 100, 90);
    expect(out.map((c) => c.price).sort((a, b) => a - b)).toEqual([99, 110]);
  });

  it('sorts by proximity, nearest first', () => {
    const out = alertCandidates(bands, 100, 100, 0);
    expect(out[0].price).toBe(100.5);
  });

  it('reports a signed distance percentage', () => {
    const out = alertCandidates(bands, 100, 2, 80);
    expect(out[0].distancePct).toBeCloseTo(-1, 6);
  });

  it('returns nothing when price is unknown', () => {
    expect(alertCandidates(bands, 0, 5, 0)).toEqual([]);
  });

  it('returns nothing for an empty band list', () => {
    expect(alertCandidates([], 100, 5, 0)).toEqual([]);
  });
});

describe('alertKey', () => {
  it('is stable for the same band across small price drifts', () => {
    expect(alertKey('BTCUSDT', 64010)).toBe(alertKey('BTCUSDT', 64020));
  });

  it('differs between distant bands', () => {
    expect(alertKey('BTCUSDT', 64000)).not.toBe(alertKey('BTCUSDT', 68000));
  });

  it('differs between symbols', () => {
    expect(alertKey('BTCUSDT', 64000)).not.toBe(alertKey('ETHUSDT', 64000));
  });
});

describe('dueAlerts', () => {
  const candidates = [{ price: 100, score: 95, distancePct: 1 }];

  it('fires an alert that has never fired', () => {
    expect(dueAlerts('BTCUSDT', candidates, new Map(), 1000, 60_000)).toHaveLength(1);
  });

  it('suppresses a repeat inside the cooldown window', () => {
    const fired = new Map([[alertKey('BTCUSDT', 100), 1000]]);
    expect(dueAlerts('BTCUSDT', candidates, fired, 30_000, 60_000)).toHaveLength(0);
  });

  it('allows a repeat once the cooldown has elapsed', () => {
    const fired = new Map([[alertKey('BTCUSDT', 100), 1000]]);
    expect(dueAlerts('BTCUSDT', candidates, fired, 90_000, 60_000)).toHaveLength(1);
  });

  it('does not suppress a different band', () => {
    const fired = new Map([[alertKey('BTCUSDT', 100), 1000]]);
    const other = [{ price: 200, score: 95, distancePct: 1 }];
    expect(dueAlerts('BTCUSDT', other, fired, 1000, 60_000)).toHaveLength(1);
  });
});
