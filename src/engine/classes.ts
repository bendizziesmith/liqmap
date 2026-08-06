export type Rgb = [number, number, number];

/** Five ordinal intensity classes. */
export const N_CLASSES = 5;

/**
 * Percentiles of the visible non-zero values that separate the classes.
 *
 * Weighted toward the top so only ~3% of painted area can be heaviest — a continuous ramp
 * put a wide middle band on near-identical yellows, which is what made large regions read
 * as one uniform blob with no hierarchy.
 */
export const CLASS_PERCENTILES = [0.5, 0.75, 0.9, 0.97];

/** Opacity per class. Rising alpha carries hierarchy even where hue ordering does not. */
const CLASS_ALPHA = [64, 116, 170, 214, 255];

export interface Colormap {
  label: string;
  /** One colour per intensity class, faintest first. */
  classColors: Rgb[];
  /** Leverage-tier palette sampled from the same family, lowest tier first. */
  tierColors: string[];
  /** Accent for the heaviest class, reused to flag top-class bars. */
  hot: string;
}

export const COLORMAPS: Record<'inferno' | 'classic', Colormap> = {
  inferno: {
    label: 'Inferno (classes)',
    // Luminance 31 / 68 / 107 / 172 / 248 — every step at least 37 apart.
    classColors: [
      [59, 15, 112],
      [140, 41, 129],
      [222, 73, 104],
      [252, 165, 10],
      [252, 255, 164],
    ],
    tierColors: ['#6a0a68', '#bb3754', '#f98e09', '#f5db4c'],
    hot: '#fcffa4',
  },
  classic: {
    label: 'Classic (blue→red)',
    /*
     * Ordered by hue rather than luminance: this ramp's red is darker than its yellow, but
     * blue-cool through red-hot is the ordering traders read without a legend. The rising
     * per-class alpha above restores "heaviest dominates" on a dark ground.
     */
    classColors: [
      [29, 78, 216],
      [8, 145, 178],
      [34, 197, 94],
      [250, 204, 21],
      [255, 51, 68],
    ],
    tierColors: ['#1d4ed8', '#0891b2', '#22c55e', '#facc15'],
    hot: '#ff3344',
  },
};

export type ColormapId = keyof typeof COLORMAPS;

export function colormapIds(): ColormapId[] {
  return Object.keys(COLORMAPS) as ColormapId[];
}

/** Perceived brightness of an RGB triple. */
export function luminance(rgb: Rgb): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Class boundaries drawn from the non-zero values supplied.
 *
 * Zeros are excluded: the grid is mostly empty by construction, so including them would put
 * every percentile at 0 and collapse the scale.
 */
export function classBreaks(
  values: ArrayLike<number>,
  percentiles: number[] = CLASS_PERCENTILES,
): number[] {
  const nonZero: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) nonZero.push(values[i]);
  }
  if (nonZero.length === 0) return percentiles.map(() => 0);

  nonZero.sort((a, b) => a - b);
  return percentiles.map((p) => {
    const idx = Math.min(nonZero.length - 1, Math.max(0, Math.ceil(p * nonZero.length) - 1));
    return nonZero[idx];
  });
}

/**
 * Intensity class for a value, or -1 for "paint nothing".
 *
 * A value sitting exactly on a break belongs to the higher class, so the top break is
 * inclusive and the heaviest level always reads as heaviest.
 */
export function classOf(value: number, breaks: number[]): number {
  if (!(value > 0)) return -1;
  let cls = 0;
  for (let i = 0; i < breaks.length; i++) {
    if (value >= breaks[i]) cls = i + 1;
  }
  return Math.min(cls, N_CLASSES - 1);
}

export function classAlpha(cls: number): number {
  if (cls < 0) return 0;
  return CLASS_ALPHA[Math.min(cls, N_CLASSES - 1)];
}
