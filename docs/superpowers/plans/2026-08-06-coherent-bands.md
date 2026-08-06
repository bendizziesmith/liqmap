# Coherent bands instead of 1px streaks

The engine model does not change. This is about how the same data reads.

## Why it currently reads as noise

The raster is built one source pixel per bucket — height `b1 - b0 + 1` — then blitted into
the plot with `imageSmoothingEnabled = false`. Two failure modes fall out of that:

- **Downscale drops data.** Whenever the visible bucket span exceeds the plot height (fully
  zoomed out: 1100 buckets into ~686px), nearest-neighbour sampling picks one bucket per
  output row and silently discards the rest. A level has a `plotH / nBuckets` chance of
  being drawn at all, so bands flicker in and out as you zoom and what survives is
  single-pixel aliasing debris.
- **A level is one bucket wide.** Even where the raster upscales (1d default zoom is 281
  buckets over 686px, so 2.4px per bucket), each of the 12 liquidation prices a candle
  implies lands on exactly one bucket. Twelve unrelated 2px lines per column reads as
  static, not as structure.

## 1. Resolution-aware vertical aggregation

Build the raster at **display-row** resolution instead of bucket resolution:

    rasterRows = clamp(floor(plotH / MIN_ROW_PX), 1, visibleBuckets)      MIN_ROW_PX = 2

- Zoomed out (buckets > rows): each row sums the buckets that fall in it. **Sum, not max** —
  every bucket maps to exactly one row, so the visible mass is conserved exactly and the
  percentile ladder still describes what is painted.
- Zoomed in (buckets ≤ rows): rows collapse to one bucket each and the old 1:1 behaviour
  returns untouched.

Class breaks are computed over the **aggregated** row values, not raw buckets, so the ladder
and the raster agree.

The side panel is built on the same row grid and its bars drawn `plotH / rasterRows` tall,
so a bar is exactly as tall as the band it describes rather than a 1px needle beside it.

## 2. Seed kernel

An entry is not at one exact tick. Each seeded level spreads over a triangular kernel —
`0.25 / 0.5 / 0.25` across the centre bucket and one neighbour each side — so a band is born
three buckets wide with a bright core and softer shoulders. At the grid edges the
out-of-range share folds back into the clamped bucket, so the total is unchanged and the
conservation tests still hold exactly.

## 3. Noise floor and smoothing

- Cells below **a quarter of the first class break** paint fully transparent rather than as
  dim speckle, so the ground reads as clean dark. The legend gains a `< floor hidden` note.
- Settings toggle **"Smooth rendering"**, default on: the heat blit sets
  `imageSmoothingEnabled = true` (only meaningful on upscale), and the panel's bar lengths
  are drawn through a `0.25/0.5/0.25` pass. Off restores the crisp blocky rendering.
  Smoothing is render-only — the tooltip reads raw values either way.

## What changes meaning

Nothing in the engine except the kernel, which conserves mass exactly. One rendering
consequence worth stating: when zoomed out far enough to aggregate, a painted cell — and so
a legend threshold — describes a **display band** rather than a single bucket. Previously it
described one arbitrary surviving bucket and discarded its neighbours, so this is strictly
more faithful, but the magnitudes are not the same numbers. The plot tooltip still reads the
single bucket under the cursor and is unaffected.

## Verification

Tests + build green, deploy, then live on XRPUSDT 1d and BTCUSDT 4h at default zoom: median
contiguous band height in px before/after (target ≥3px), background speckle share, single
bucket detail returns when fully zoomed in, and three plot-tooltip USD figures unchanged
against pre-change values with decay off. Screenshots before/after, same view, desktop and
mobile.
