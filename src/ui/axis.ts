/**
 * Axis drag-to-zoom maths.
 *
 * Kept pure so the awkward part — turning a drag distance into a domain — is unit-tested,
 * leaving the DOM wiring in the canvas components thin enough to read.
 */

/**
 * Pixels of drag that produce one e-fold of zoom.
 *
 * Deliberately close to the wheel's own scale: at 160 an axis drag was roughly eight times
 * more aggressive per pixel than a wheel notch, so the two gestures felt like different
 * controls. At 400 a half-screen drag is about 2.4x, which is firm but recoverable.
 */
export const AXIS_DRAG_SENSITIVITY = 400;

/** One gesture should not be able to zoom more than tenfold in either direction. */
const MAX_FACTOR = 10;

/** Zoom per pixel of wheel delta. One 100px notch lands at e^0.075 ≈ 1.078. */
const WHEEL_K = 0.00075;

/** A single wheel event should never zoom more than this, however violent the flick. */
const MAX_WHEEL_FACTOR = 1.6;

/** Firefox reports whole lines; 33px each makes its 3-line notch match Chrome's 100px. */
const PIXELS_PER_LINE = 33;
const PIXELS_PER_PAGE = 400;

/**
 * Zoom factor for one wheel event, proportional to how far the wheel actually moved.
 *
 * The previous flat step applied the same 1.15x whatever the delta, so a trackpad — which
 * emits a stream of small deltas — compounded them and zooming out ran away. Deriving the
 * factor from the delta makes a notch a notch and a gentle swipe gentle, and keeps the
 * gesture symmetric so scrolling back undoes it exactly.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;

  const scale = deltaMode === 1 ? PIXELS_PER_LINE : deltaMode === 2 ? PIXELS_PER_PAGE : 1;
  const raw = Math.exp(WHEEL_K * deltaY * scale);
  return Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, raw));
}

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
