/**
 * Pure pinch-gesture maths.
 *
 * Kept free of pointer events and DOM so the awkward part — how a pair of moving fingers
 * turns into a new domain — can be tested directly instead of through synthetic events.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Pointer capture that cannot throw.
 *
 * `setPointerCapture` rejects an id the browser no longer considers active — a pointer
 * cancelled by the OS, a gesture interrupted mid-flight. Uncaught inside a React handler
 * that kills the whole interaction, so a lost pointer degrades to "no capture" instead.
 */
export function capturePointer(el: Element | null | undefined, pointerId: number): void {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* pointer is already gone; nothing to capture */
  }
}

export function releasePointer(el: Element | null | undefined, pointerId: number): void {
  try {
    el?.releasePointerCapture(pointerId);
  } catch {
    /* pointer is already gone; nothing to release */
  }
}

/**
 * Horizontal separation between two pointers.
 *
 * Only the horizontal component matters: the Map view's price axis runs across, so a
 * diagonal pinch should zoom by however much the fingers separated *along price*. Floored
 * at 1 because it is always a divisor.
 */
export function spreadX(a: Point, b: Point): number {
  return Math.max(1, Math.abs(a.x - b.x));
}

/**
 * Domain scale factor for a pinch.
 *
 * Fingers spreading apart returns a factor below 1, which shrinks the visible domain — that
 * is a zoom in. Fingers closing returns above 1 and zooms out.
 */
export function pinchFactor(startSpread: number, currentSpread: number): number {
  return Math.max(1, startSpread) / Math.max(1, currentSpread);
}

/** Midpoint of the two pointers as a 0-1 fraction across the plot, clamped to it. */
export function pinchAnchor(a: Point, b: Point, width: number): number {
  if (width <= 0) return 0.5;
  const mid = (a.x + b.x) / 2;
  return Math.min(1, Math.max(0, mid / width));
}

/**
 * Scale a domain about an anchor, clamped to `bounds` and never narrower than `minSpan`.
 *
 * When a zoom-out runs into one edge the window slides along that edge rather than being
 * clipped, so pinching out near the end of the data keeps widening instead of stalling.
 * Returns integers because callers use the result to slice a bin array.
 */
export function zoomDomain(
  domain: [number, number],
  factor: number,
  anchorFraction: number,
  bounds: [number, number],
  minSpan: number,
): [number, number] {
  const [d0, d1] = domain;
  const [lo, hi] = bounds;

  const span = d1 - d0;
  const maxSpan = hi - lo;
  const wanted = Math.min(maxSpan, Math.max(minSpan, span * factor));

  // A zoom-in that would breach the minimum is a no-op rather than a clamp, so the window
  // does not silently jump to a different position than the fingers asked for.
  if (span * factor < minSpan && span <= minSpan) return [d0, d1];

  const anchorValue = d0 + anchorFraction * span;
  let n0 = anchorValue - (anchorValue - d0) * (wanted / span || 1);
  let n1 = n0 + wanted;

  if (n0 < lo) {
    n0 = lo;
    n1 = lo + wanted;
  }
  if (n1 > hi) {
    n1 = hi;
    n0 = hi - wanted;
  }
  if (n0 < lo) n0 = lo;

  return [Math.round(n0), Math.round(n1)];
}
