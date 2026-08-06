import { describe, it, expect } from 'vitest';
import { spreadX, pinchFactor, pinchAnchor, zoomDomain } from './gesture';

describe('spreadX', () => {
  it('measures horizontal separation regardless of pointer order', () => {
    expect(spreadX({ x: 100, y: 0 }, { x: 250, y: 0 })).toBe(150);
    expect(spreadX({ x: 250, y: 0 }, { x: 100, y: 0 })).toBe(150);
  });

  it('ignores vertical separation, because only the price axis zooms', () => {
    expect(spreadX({ x: 100, y: 0 }, { x: 250, y: 900 })).toBe(150);
  });

  it('floors at 1 so it can be divided by safely', () => {
    expect(spreadX({ x: 40, y: 0 }, { x: 40, y: 0 })).toBe(1);
  });
});

describe('pinchFactor', () => {
  it('is 1 when the fingers have not moved', () => {
    expect(pinchFactor(200, 200)).toBe(1);
  });

  it('shrinks the domain when fingers spread apart, which zooms in', () => {
    expect(pinchFactor(100, 200)).toBeCloseTo(0.5, 10);
  });

  it('grows the domain when fingers come together, which zooms out', () => {
    expect(pinchFactor(200, 100)).toBeCloseTo(2, 10);
  });

  it('never divides by zero', () => {
    expect(Number.isFinite(pinchFactor(200, 0))).toBe(true);
    expect(Number.isFinite(pinchFactor(0, 200))).toBe(true);
  });
});

describe('pinchAnchor', () => {
  it('reports the midpoint of the two pointers as a fraction of width', () => {
    expect(pinchAnchor({ x: 100, y: 0 }, { x: 300, y: 0 }, 400)).toBeCloseTo(0.5, 10);
  });

  it('clamps to the plot when fingers stray outside it', () => {
    expect(pinchAnchor({ x: -500, y: 0 }, { x: -400, y: 0 }, 400)).toBe(0);
    expect(pinchAnchor({ x: 900, y: 0 }, { x: 950, y: 0 }, 400)).toBe(1);
  });

  it('returns a finite fraction for a zero-width plot', () => {
    expect(Number.isFinite(pinchAnchor({ x: 10, y: 0 }, { x: 20, y: 0 }, 0))).toBe(true);
  });
});

describe('zoomDomain', () => {
  const bounds: [number, number] = [0, 200];

  it('leaves the domain alone at factor 1', () => {
    expect(zoomDomain([50, 150], 1, 0.5, bounds, 4)).toEqual([50, 150]);
  });

  it('halves the span around the centre when anchored at the midpoint', () => {
    expect(zoomDomain([50, 150], 0.5, 0.5, bounds, 4)).toEqual([75, 125]);
  });

  it('holds the left edge when anchored at 0', () => {
    const [a, b] = zoomDomain([50, 150], 0.5, 0, bounds, 4);
    expect(a).toBe(50);
    expect(b).toBe(100);
  });

  it('holds the right edge when anchored at 1', () => {
    const [a, b] = zoomDomain([50, 150], 0.5, 1, bounds, 4);
    expect(a).toBe(100);
    expect(b).toBe(150);
  });

  it('keeps the anchored value under the fingers while zooming', () => {
    // The point a third of the way across must still sit a third of the way across.
    const domain: [number, number] = [0, 120];
    const anchorValue = 40;
    const [a, b] = zoomDomain(domain, 0.5, 1 / 3, bounds, 4);
    expect(a + (b - a) / 3).toBeCloseTo(anchorValue, 6);
  });

  it('grows the domain when zooming out', () => {
    const [a, b] = zoomDomain([80, 120], 2, 0.5, bounds, 4);
    expect(b - a).toBeCloseTo(80, 6);
  });

  it('never expands beyond the bounds', () => {
    const [a, b] = zoomDomain([10, 190], 5, 0.5, bounds, 4);
    expect(a).toBeGreaterThanOrEqual(bounds[0]);
    expect(b).toBeLessThanOrEqual(bounds[1]);
  });

  it('clamps an over-eager zoom-in to the minimum span rather than overshooting', () => {
    const [a, b] = zoomDomain([50, 60], 0.01, 0.5, bounds, 4);
    expect(b - a).toBe(4);
    // Still centred on the anchor, so the window does not jump out from under the fingers.
    expect((a + b) / 2).toBeCloseTo(55, 6);
  });

  it('is a no-op once the domain is already at the minimum span', () => {
    expect(zoomDomain([50, 54], 0.25, 0.5, bounds, 4)).toEqual([50, 54]);
  });

  it('allows a zoom that lands exactly on the minimum span', () => {
    const [a, b] = zoomDomain([50, 70], 0.2, 0.5, bounds, 4);
    expect(b - a).toBeCloseTo(4, 6);
  });

  it('returns integer bin indices, since the caller slices an array with them', () => {
    const [a, b] = zoomDomain([50, 150], 0.37, 0.42, bounds, 4);
    expect(Number.isInteger(a)).toBe(true);
    expect(Number.isInteger(b)).toBe(true);
  });

  it('keeps the domain ordered', () => {
    for (const f of [0.2, 0.5, 1, 2, 5]) {
      for (const anchor of [0, 0.25, 0.5, 0.75, 1]) {
        const [a, b] = zoomDomain([40, 160], f, anchor, bounds, 4);
        expect(b).toBeGreaterThan(a);
      }
    }
  });

  it('shifts rather than clipping when zoom-out hits one edge', () => {
    // Zooming out near the left wall must not silently produce a narrower window.
    const [a, b] = zoomDomain([0, 40], 2, 0.5, bounds, 4);
    expect(a).toBe(0);
    expect(b - a).toBeCloseTo(80, 6);
  });
});
