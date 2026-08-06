import { describe, it, expect } from 'vitest';
import { axisZoomFactor, scaleAbout, wheelZoomFactor, AXIS_DRAG_SENSITIVITY } from './axis';

describe('wheelZoomFactor', () => {
  it('does nothing on a zero delta', () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('zooms about 1.08x for one mouse notch, not the old flat 1.15x', () => {
    const f = wheelZoomFactor(100);
    expect(f).toBeGreaterThan(1.07);
    expect(f).toBeLessThan(1.09);
  });

  it('scales with the delta rather than stepping', () => {
    // A trackpad emits many small deltas; each must move a correspondingly small amount.
    const small = wheelZoomFactor(4);
    expect(small).toBeGreaterThan(1);
    expect(small).toBeLessThan(1.01);
  });

  it('is monotone in delta', () => {
    let prev = 0;
    for (const d of [0, 5, 20, 60, 100, 240]) {
      const f = wheelZoomFactor(d);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('is symmetric, so scrolling back undoes the zoom exactly', () => {
    for (const d of [7, 40, 100, 300]) {
      expect(wheelZoomFactor(d) * wheelZoomFactor(-d)).toBeCloseTo(1, 10);
    }
  });

  it('zooms out above 1 and in below 1', () => {
    expect(wheelZoomFactor(100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-100)).toBeLessThan(1);
  });

  it('clamps a violent flick so one event cannot swallow the chart', () => {
    expect(wheelZoomFactor(50_000)).toBeLessThanOrEqual(1.6);
    expect(wheelZoomFactor(-50_000)).toBeGreaterThanOrEqual(1 / 1.6);
  });

  it('treats a three-line notch like a hundred-pixel one', () => {
    // Firefox reports lines, Chrome pixels; a notch should feel the same in both.
    const lines = wheelZoomFactor(3, 1);
    const pixels = wheelZoomFactor(100, 0);
    expect(Math.abs(lines - pixels)).toBeLessThan(0.01);
  });

  it('handles page-mode deltas without running away', () => {
    expect(wheelZoomFactor(1, 2)).toBeLessThanOrEqual(1.6);
    expect(wheelZoomFactor(1, 2)).toBeGreaterThan(1);
  });

  it('returns 1 for non-finite input', () => {
    expect(wheelZoomFactor(NaN)).toBe(1);
  });
});

describe('axisZoomFactor', () => {
  it('does nothing at zero drag', () => {
    expect(axisZoomFactor(0)).toBe(1);
  });

  it('zooms in when dragging up, following the TradingView convention', () => {
    // Screen Y decreases upward, so an upward drag is a negative delta.
    expect(axisZoomFactor(-60)).toBeLessThan(1);
  });

  it('zooms out when dragging down', () => {
    expect(axisZoomFactor(60)).toBeGreaterThan(1);
  });

  it('is symmetric: dragging back undoes the zoom exactly', () => {
    for (const d of [10, 45, 120, 400]) {
      expect(axisZoomFactor(d) * axisZoomFactor(-d)).toBeCloseTo(1, 10);
    }
  });

  it('grows monotonically with drag distance', () => {
    let prev = 0;
    for (const d of [0, 20, 40, 80, 160]) {
      const f = axisZoomFactor(d);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('reaches e at one sensitivity unit, so the feel is predictable', () => {
    expect(axisZoomFactor(AXIS_DRAG_SENSITIVITY)).toBeCloseTo(Math.E, 6);
  });

  it('clamps a violent flick so one gesture cannot zoom a thousandfold', () => {
    expect(axisZoomFactor(100_000)).toBeLessThanOrEqual(10);
    expect(axisZoomFactor(-100_000)).toBeGreaterThanOrEqual(0.1);
  });

  it('honours a custom sensitivity', () => {
    expect(axisZoomFactor(50, 50)).toBeCloseTo(Math.E, 6);
  });

  it('returns 1 for non-finite input rather than poisoning the domain', () => {
    expect(axisZoomFactor(NaN)).toBe(1);
  });
});

describe('scaleAbout', () => {
  it('leaves the domain alone at factor 1', () => {
    expect(scaleAbout([100, 200], 1, 0.5)).toEqual([100, 200]);
  });

  it('halves the span about the centre', () => {
    expect(scaleAbout([100, 200], 0.5, 0.5)).toEqual([125, 175]);
  });

  it('doubles the span about the centre', () => {
    expect(scaleAbout([100, 200], 2, 0.5)).toEqual([50, 250]);
  });

  it('holds the bottom edge when anchored at 0', () => {
    expect(scaleAbout([100, 200], 0.5, 0)).toEqual([100, 150]);
  });

  it('holds the top edge when anchored at 1', () => {
    expect(scaleAbout([100, 200], 0.5, 1)).toEqual([150, 200]);
  });

  it('keeps the anchored value under the cursor', () => {
    const anchor = 0.25;
    const [a, b] = scaleAbout([0, 400], 0.4, anchor);
    expect(a + (b - a) * anchor).toBeCloseTo(100, 6);
  });

  it('preserves ordering across a wide sweep of inputs', () => {
    for (const f of [0.1, 0.5, 1, 3, 9]) {
      for (const anchor of [0, 0.3, 0.5, 0.8, 1]) {
        const [a, b] = scaleAbout([10, 90], f, anchor);
        expect(b).toBeGreaterThan(a);
      }
    }
  });

  it('returns floats, since a price domain is continuous', () => {
    const [a, b] = scaleAbout([100, 200], 0.37, 0.42);
    expect(Number.isInteger(a) && Number.isInteger(b)).toBe(false);
  });

  it('refuses to collapse a degenerate domain', () => {
    const [a, b] = scaleAbout([100, 100], 0.5, 0.5);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
  });
});
