/**
 * Axis drag-to-zoom maths.
 *
 * Kept pure so the awkward part — turning a drag distance into a domain — is unit-tested,
 * leaving the DOM wiring in the canvas components thin enough to read.
 */

/** Pixels of drag that produce one e-fold of zoom. Tuned to feel like TradingView's axes. */
export const AXIS_DRAG_SENSITIVITY = 160;

/** One gesture should not be able to zoom more than tenfold in either direction. */
const MAX_FACTOR = 10;

/**
 * Domain scale factor for a drag along an axis.
 *
 * `deltaPx` is measured in screen space, where Y grows downward. Dragging **up** returns a
 * factor below 1, which shrinks the domain — that is a zoom in, matching TradingView. The
 * exponential makes the gesture symmetric: dragging back exactly undoes it, which a linear
 * mapping cannot do.
 */
export function axisZoomFactor(deltaPx: number, sensitivity = AXIS_DRAG_SENSITIVITY): number {
  if (!Number.isFinite(deltaPx) || sensitivity <= 0) return 1;
  const raw = Math.exp(deltaPx / sensitivity);
  return Math.min(MAX_FACTOR, Math.max(1 / MAX_FACTOR, raw));
}

/**
 * Scale a continuous domain about an anchor expressed as a 0-1 fraction across it.
 *
 * Unlike the bin-index zoom in `gesture.ts` this returns floats and does not clamp to outer
 * bounds: a price axis is continuous and panning past the data is legitimate.
 */
export function scaleAbout(
  domain: [number, number],
  factor: number,
  anchorFraction: number,
): [number, number] {
  const [d0, d1] = domain;
  const span = d1 - d0;
  if (!Number.isFinite(span) || span <= 0) return [d0, d1];

  const anchor = d0 + anchorFraction * span;
  return [anchor - (anchor - d0) * factor, anchor + (d1 - anchor) * factor];
}
