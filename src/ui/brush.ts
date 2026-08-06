/**
 * Brush geometry for the Map view.
 *
 * The Map's plot area deliberately has no zoom of its own — scrolling over it should scroll
 * the page like ordinary content — so every range change comes through this strip. Keeping
 * the arithmetic pure means the drag behaviour is testable without synthesising events.
 */

/** Grab width of each edge handle, in pixels. */
export const BRUSH_HANDLE_PX = 8;

export type BrushZone = 'left' | 'right' | 'inside' | 'outside';

/** Bin index under an x position on the strip, clamped to `[0, nBins]`. */
export function xToBin(x: number, width: number, nBins: number): number {
  if (width <= 0) return 0;
  return Math.round(Math.min(nBins, Math.max(0, (x / width) * nBins)));
}

/** Pixel span `[x0, x1]` covered by a bin range. */
export function brushPixelRange(
  range: [number, number],
  nBins: number,
  width: number,
): [number, number] {
  if (nBins <= 0) return [0, width];
  return [(range[0] / nBins) * width, (range[1] / nBins) * width];
}

/**
 * Which part of the brush an x position is over.
 *
 * Handles win over the interior: on a narrow window the two grab zones overlap, and a drag
 * there should resize rather than slide — sliding a window you were trying to widen is the
 * more annoying failure.
 */
export function brushZoneAt(
  x: number,
  range: [number, number],
  nBins: number,
  width: number,
  handlePx: number = BRUSH_HANDLE_PX,
): BrushZone {
  const [x0, x1] = brushPixelRange(range, nBins, width);

  if (Math.abs(x - x0) <= handlePx) return 'left';
  if (Math.abs(x - x1) <= handlePx) return 'right';
  if (x > x0 && x < x1) return 'inside';
  return 'outside';
}

/** Move the window by `deltaBins`, keeping its width and stopping at the walls. */
export function slideBrush(
  range: [number, number],
  deltaBins: number,
  nBins: number,
): [number, number] {
  const width = range[1] - range[0];
  let a = Math.round(range[0] + deltaBins);
  a = Math.max(0, Math.min(nBins - width, a));
  return [a, a + width];
}

/** Drag one edge, honouring a minimum width and never crossing the opposite edge. */
export function resizeBrush(
  range: [number, number],
  edge: 'left' | 'right',
  toBin: number,
  nBins: number,
  minBins: number,
): [number, number] {
  const clamped = Math.max(0, Math.min(nBins, Math.round(toBin)));

  if (edge === 'left') {
    return [Math.min(clamped, range[1] - minBins), range[1]];
  }
  return [range[0], Math.max(clamped, range[0] + minBins)];
}
