// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProfileChart } from './ProfileChart';
import { liquidationProfile } from '../engine/profile';
import { N_BUCKETS } from '../engine/grid';
import type { Grid } from '../engine/types';

/**
 * Regression cover for a bug where the Map brush snapped back to its default about once a
 * second: the reset effect keyed on the `profile` object identity, and the Map rebuilds
 * that object on every live price tick, so each tick wiped the user's window — and since
 * ticks outpace a drag, the brush also looked frozen.
 */

const W = 800;
const H = 300;
const AXIS_W = 46;
const AXIS_H = 20;
const BRUSH_H = 26;
const BRUSH_GAP = 6;
const PLOT_W = W - AXIS_W;
const PLOT_H = H - AXIS_H - BRUSH_H - BRUSH_GAP;
const BRUSH_Y = PLOT_H + AXIS_H + BRUSH_GAP + BRUSH_H / 2;

const grid: Grid = { min: 0, max: 1100, nBuckets: N_BUCKETS, step: 1 };

/** A brand new profile object each call — exactly what a live price tick produces. */
function makeProfile(price = 550) {
  const tiers = [0, 1, 2, 3].map(() => new Float32Array(N_BUCKETS));
  for (let b = 0; b < N_BUCKETS; b++) {
    tiers[0][b] = 1 + (b % 7);
    tiers[1][b] = 1 + (b % 5);
  }
  return liquidationProfile(tiers, grid, price, { bins: 200, tierLabels: [3, 5, 10, 25] });
}

beforeAll(() => {
  // jsdom has no canvas 2D and no ResizeObserver. The component skips painting when
  // getContext returns null, which is all that is needed here: this exercises state.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
});

let container: HTMLDivElement;
let root: Root;

const baseProps = () => ({
  title: 'Swing',
  subtitle: 'XRPUSDT · 4h',
  datasetKey: 'XRPUSDT:4h',
  profile: makeProfile(),
  loading: false,
  error: null,
  onExport: () => {},
  formatPrice: (p: number) => p.toFixed(4),
  colormapId: 'inferno' as const,
  usdScale: { long: 1, short: 1 },
    minUsd: 0,
});

function render(props = baseProps()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ProfileChart {...props} />));
  return props;
}

function rerender(props: ReturnType<typeof baseProps>) {
  act(() => root.render(<ProfileChart {...props} />));
}

const canvas = () => container.querySelector('canvas')!;

/** Visible bin window, published by the component for exactly this kind of check. */
function brush(): [number, number] | null {
  const raw = canvas().getAttribute('data-brush');
  if (!raw) return null;
  const [a, b] = raw.split(',').map(Number);
  return [a, b];
}

/** Pixel x of a bin index on the brush strip. */
const xOfBin = (i: number) => (i / 200) * PLOT_W;

function pointer(type: string, x: number, id: number) {
  canvas().dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: BRUSH_Y, bubbles: true, isPrimary: true,
  }));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('brush survives live data refresh', () => {
  it('keeps a user-narrowed window when a new profile object arrives', () => {
    const props = render();
    const initial = brush();
    expect(initial).not.toBeNull();

    // Drag the right handle inward, as a user narrowing the view would.
    const target = initial![0] + 25;
    act(() => {
      pointer('pointerdown', xOfBin(initial![1]), 1);
      pointer('pointermove', xOfBin(target), 1);
      pointer('pointerup', xOfBin(target), 1);
    });

    const narrowed = brush();
    expect(narrowed![1]).toBeLessThan(initial![1]);

    // A live price tick: same dataset, brand new profile object.
    rerender({ ...props, profile: makeProfile(551) });
    expect(brush()).toEqual(narrowed);

    // And again, because the original bug reset on every single tick.
    rerender({ ...props, profile: makeProfile(552) });
    rerender({ ...props, profile: makeProfile(553) });
    expect(brush()).toEqual(narrowed);
  });

  it('resets to the default window when the dataset itself changes', () => {
    const props = render();
    const initial = brush()!;
    const target = initial[0] + 25;
    act(() => {
      pointer('pointerdown', xOfBin(initial[1]), 2);
      pointer('pointermove', xOfBin(target), 2);
      pointer('pointerup', xOfBin(target), 2);
    });
    const narrowed = brush();

    // A different symbol is a genuinely different book, so the default window is right.
    rerender({ ...props, datasetKey: 'BTCUSDT:4h', profile: makeProfile(600) });
    expect(brush()).not.toEqual(narrowed);
  });

  it('leaves the window alone when only the USD scale refreshes', () => {
    const props = render();
    const initial = brush()!;
    const target = initial[0] + 30;
    act(() => {
      pointer('pointerdown', xOfBin(initial[1]), 3);
      pointer('pointermove', xOfBin(target), 3);
      pointer('pointerup', xOfBin(target), 3);
    });
    const narrowed = brush();

    // Open interest refreshes on its own cadence and must not touch the view.
    rerender({ ...props, usdScale: { long: 0.004, short: 0.006 } });
    expect(brush()).toEqual(narrowed);
  });
});

describe('drag is not interrupted by a refresh', () => {
  it('keeps pointer capture and the in-progress window across a profile update', () => {
    const props = render();

    const captured: number[] = [];
    const released: number[] = [];
    canvas().setPointerCapture = ((id: number) => captured.push(id)) as never;
    canvas().releasePointerCapture = ((id: number) => released.push(id)) as never;

    const initial = brush()!;
    act(() => {
      pointer('pointerdown', xOfBin(initial[1]), 7);
      pointer('pointermove', xOfBin(initial[0] + 40), 7);
    });
    expect(captured).toContain(7);
    const during = brush();

    // A refresh lands mid-drag: it must neither release the pointer nor move the window.
    rerender({ ...props, profile: makeProfile(552) });
    expect(released).not.toContain(7);
    expect(brush()).toEqual(during);

    // Finishing the drag still works afterwards.
    act(() => pointer('pointerup', xOfBin(initial[0] + 40), 7));
    expect(brush()).toEqual(during);
  });
});
