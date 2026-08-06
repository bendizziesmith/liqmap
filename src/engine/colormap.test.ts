import { describe, it, expect } from 'vitest';
import { inferno, alphaFor } from './colormap';

describe('inferno', () => {
  it('starts near black', () => {
    const [r, g, b] = inferno(0);
    expect(r).toBeLessThan(20);
    expect(g).toBeLessThan(20);
    expect(b).toBeLessThan(30);
  });

  it('ends near white-yellow', () => {
    const [r, g, b] = inferno(1);
    expect(r).toBeGreaterThan(230);
    expect(g).toBeGreaterThan(230);
    expect(b).toBeGreaterThan(120);
  });

  it('passes through red-orange in the middle', () => {
    const [r, g, b] = inferno(0.5);
    expect(r).toBeGreaterThan(150);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeLessThan(r);
  });

  it('increases monotonically in perceived brightness', () => {
    // The property that makes a heatmap readable: hotter is always visibly brighter.
    // Individual channels are not monotonic — inferno's red dips slightly near the top.
    const luma = (x: number) => {
      const [r, g, b] = inferno(x);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let prev = -1;
    for (let i = 0; i <= 40; i++) {
      const l = luma(i / 40);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });

  it('clamps out-of-range input', () => {
    expect(inferno(-5)).toEqual(inferno(0));
    expect(inferno(5)).toEqual(inferno(1));
  });

  it('returns byte-ranged channels', () => {
    for (let i = 0; i <= 10; i++) {
      for (const ch of inferno(i / 10)) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('alphaFor', () => {
  it('has a floor of 35 so faint levels stay faintly visible', () => {
    expect(alphaFor(0)).toBe(35);
  });

  it('saturates at 255 once the normalized score passes 0.8', () => {
    expect(alphaFor(0.8)).toBe(255);
    expect(alphaFor(1)).toBe(255);
  });

  it('ramps linearly below the saturation point', () => {
    expect(alphaFor(0.4)).toBe(Math.round(35 + 220 * 0.5));
  });
});
