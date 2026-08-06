/**
 * The one price↔screen transform.
 *
 * The heatmap raster, the candles, the crosshair and the side-panel profile bars all go
 * through these two functions. That is what makes the panel line up with the heat: there
 * is a single transform rather than two implementations that have to be kept in agreement.
 *
 * Screen Y grows downward, so the low end of the price range sits at `height` and the high
 * end at 0.
 */

/** Screen Y for `price`, given the visible range `[p0, p1]` and a plot of `height` px. */
export function priceToY(price: number, p0: number, p1: number, height: number): number {
  const span = p1 - p0;
  // A degenerate range would divide by zero; centring is the only sane answer.
  if (span === 0) return height / 2;
  return height - ((price - p0) / span) * height;
}

/** Price at screen Y, the inverse of `priceToY`. */
export function yToPrice(y: number, p0: number, p1: number, height: number): number {
  if (height === 0) return p0;
  return p0 + ((height - y) / height) * (p1 - p0);
}
