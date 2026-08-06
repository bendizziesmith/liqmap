/**
 * Inferno control points, sampled from the matplotlib ramp. Perceptually uniform and
 * black-anchored, so an empty grid reads as background rather than as a colour.
 */
const STOPS: Array<[number, number, number]> = [
  [0, 0, 4],
  [22, 11, 57],
  [66, 10, 104],
  [106, 23, 110],
  [147, 38, 103],
  [188, 55, 84],
  [221, 81, 58],
  [243, 120, 25],
  [252, 165, 10],
  [246, 215, 70],
  [252, 255, 164],
];

/** Linearly interpolated inferno colour for `x` in `[0, 1]`, as 0-255 channels. */
export function inferno(x: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, x)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/**
 * Opacity for a normalized score. The 1.25 multiplier saturates at 0.8 rather than 1, which
 * keeps strong bands solid instead of fading them against the candles drawn on top.
 */
export function alphaFor(x: number): number {
  return Math.round(35 + 220 * Math.min(1, 1.25 * Math.max(0, x)));
}
