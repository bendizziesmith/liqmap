import { describe, it, expect } from 'vitest';
import {
  BRUSH_HANDLE_PX,
  brushPixelRange,
  brushZoneAt,
  resizeBrush,
  slideBrush,
  xToBin,
} from './brush';

const N = 200;
const W = 400; // 2px per bin

describe('xToBin', () => {
  it('maps the left edge to the first bin and the right to the last', () => {
    expect(xToBin(0, W, N)).toBe(0);
    expect(xToBin(W, W, N)).toBe(N);
  });

  it('maps the midpoint to the middle bin', () => {
    expect(xToBin(W / 2, W, N)).toBe(100);
  });

  it('clamps outside the strip', () => {
    expect(xToBin(-50, W, N)).toBe(0);
    expect(xToBin(W + 50, W, N)).toBe(N);
  });

  it('survives a zero-width strip', () => {
    expect(Number.isFinite(xToBin(10, 0, N))).toBe(true);
  });
});

describe('brushPixelRange', () => {
  it('converts a bin range to pixels', () => {
    expect(brushPixelRange([50, 150], N, W)).toEqual([100, 300]);
  });

  it('spans the whole strip for the full range', () => {
    expect(brushPixelRange([0, N], N, W)).toEqual([0, W]);
  });
});

describe('brushZoneAt', () => {
  const range: [number, number] = [50, 150]; // pixels 100..300

  it('detects the left handle', () => {
    expect(brushZoneAt(100, range, N, W)).toBe('left');
    expect(brushZoneAt(100 + BRUSH_HANDLE_PX - 1, range, N, W)).toBe('left');
  });

  it('detects the right handle', () => {
    expect(brushZoneAt(300, range, N, W)).toBe('right');
    expect(brushZoneAt(300 - BRUSH_HANDLE_PX + 1, range, N, W)).toBe('right');
  });

  it('detects the interior between the handles', () => {
    expect(brushZoneAt(200, range, N, W)).toBe('inside');
  });

  it('detects outside the window', () => {
    expect(brushZoneAt(20, range, N, W)).toBe('outside');
    expect(brushZoneAt(380, range, N, W)).toBe('outside');
  });

  it('prefers a handle over the interior when the window is very narrow', () => {
    // Both handles overlap; grabbing must still resize rather than slide.
    const narrow: [number, number] = [100, 104]; // 8px wide
    const zone = brushZoneAt(202, narrow, N, W);
    expect(zone === 'left' || zone === 'right').toBe(true);
  });
});

describe('slideBrush', () => {
  it('shifts the window by whole bins', () => {
    expect(slideBrush([50, 150], 10, N)).toEqual([60, 160]);
    expect(slideBrush([50, 150], -10, N)).toEqual([40, 140]);
  });

  it('stops at the left wall without shrinking', () => {
    const [a, b] = slideBrush([10, 110], -50, N);
    expect(a).toBe(0);
    expect(b - a).toBe(100);
  });

  it('stops at the right wall without shrinking', () => {
    const [a, b] = slideBrush([100, 200], 50, N);
    expect(b).toBe(N);
    expect(b - a).toBe(100);
  });

  it('is a no-op for a zero delta', () => {
    expect(slideBrush([50, 150], 0, N)).toEqual([50, 150]);
  });

  it('handles a full-width window that cannot move', () => {
    expect(slideBrush([0, N], 25, N)).toEqual([0, N]);
  });
});

describe('resizeBrush', () => {
  const MIN = 6;

  it('moves the left edge', () => {
    expect(resizeBrush([50, 150], 'left', 70, N, MIN)).toEqual([70, 150]);
  });

  it('moves the right edge', () => {
    expect(resizeBrush([50, 150], 'right', 120, N, MIN)).toEqual([50, 120]);
  });

  it('refuses to shrink below the minimum width', () => {
    const [a, b] = resizeBrush([50, 150], 'left', 149, N, MIN);
    expect(b - a).toBe(MIN);
    expect(b).toBe(150);
  });

  it('refuses to let the right edge cross the left', () => {
    const [a, b] = resizeBrush([50, 150], 'right', 10, N, MIN);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBe(MIN);
    expect(a).toBe(50);
  });

  it('clamps to the strip bounds', () => {
    expect(resizeBrush([50, 150], 'left', -20, N, MIN)[0]).toBe(0);
    expect(resizeBrush([50, 150], 'right', 999, N, MIN)[1]).toBe(N);
  });

  it('keeps the opposite edge anchored', () => {
    expect(resizeBrush([50, 150], 'left', 20, N, MIN)[1]).toBe(150);
    expect(resizeBrush([50, 150], 'right', 190, N, MIN)[0]).toBe(50);
  });

  it('always returns an ordered range', () => {
    for (const to of [-10, 0, 40, 150, 200, 500]) {
      for (const edge of ['left', 'right'] as const) {
        const [a, b] = resizeBrush([50, 150], edge, to, N, MIN);
        expect(b).toBeGreaterThan(a);
      }
    }
  });
});
