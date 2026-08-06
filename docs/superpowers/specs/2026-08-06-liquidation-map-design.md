# Liquidation Map — aggregate profile view + heatmap side panel

**Date:** 2026-08-06
**Status:** Approved (brief-as-spec; open questions resolved below)
**Builds on:** `2026-08-06-liqmap-design.md`

## Purpose

Show, for *right now*, how much estimated liquidation volume sits at each price level.
X axis price, Y axis relative intensity, stacked by leverage tier, with a cumulative curve
running outward from current price in each direction. Below price is long liquidations,
above is shorts.

This is exactly the **last column** of the existing heatmap engine — the active-levels
snapshot after the latest candle's clearing pass. There is no second pipeline: the profile
reads `HeatmapData.matrices` at column `nCols - 1`.

## Non-goals

- No new data source, no new fetch path. `useHeatmap` is reused verbatim.
- No historical playback of the profile. It is a now-view by definition.
- No re-derivation of liquidation maths. `engine/profile.ts` only reshapes existing output.

## Engine — `engine/profile.ts`

Pure, synchronous, no React.

```ts
lastColumn(map: HeatmapData): Float32Array[]      // active levels per tier, length nBuckets
liquidationProfile(
  activeTiers: Float32Array[],
  grid: Grid,
  currentPrice: number,
  opts?: { bins?: number; tierLabels?: number[] },
): LiquidationProfile
```

`LiquidationProfile` carries `bins: ProfileBin[]`, `currentPrice`, `priceBinIndex`,
`maxTotal`, `maxCum`, and `tiers` (the leverage labels). Each `ProfileBin` has
`priceFrom`, `priceTo`, `priceMid`, `tiers: number[]`, `total`, `cumLong`, `cumShort`.

**Binning.** The grid is 1100 buckets; the default display resolution is 200 bins. Bucket
`b` maps to bin `floor(b * nBins / nBuckets)`, so bins are contiguous and cover the grid
exactly. `bins: 1100` is the identity case and must reproduce the source column verbatim —
that is the test that proves the profile *is* the heatmap's last column.

**Cumulative.** Both series sum **outward from current price**, never across it:

- `cumLong` is non-zero only below the price bin, accumulating downward from it.
- `cumShort` is non-zero only above the price bin, accumulating upward from it.

So walking away from price in either direction, the cumulative is monotonically
non-decreasing. That monotonicity is the headline engine test.

**Scaling.** `maxCum` is the max across *both* directions, so the two sides render against
one shared secondary axis and are honestly comparable.

## Shared price↔Y transform

Extracted to `ui/scale.ts` as pure, tested functions:

```ts
priceToY(price: number, p0: number, p1: number, height: number): number
yToPrice(y: number, p0: number, p1: number, height: number): number
```

The heatmap raster, the candles, the crosshair, and the side-panel bars all call
`priceToY`. Alignment between the panel and the heat is therefore structural, not
coincidental — there is one transform, not two that must be kept in agreement.

## Tier palette

The app has no per-tier colours today: the heatmap sums tiers into a single inferno raster
and the toolbar chips only signal pressed state. The palette is therefore introduced here,
sampled from the **existing** inferno ramp rather than inventing a second colour system:

| Tier index | Meaning | Colour |
|---|---|---|
| 0 | lowest leverage, largest capital share | `#6a0a68` deep purple |
| 1 | | `#bb3754` magenta |
| 2 | | `#f98e09` orange |
| 3 | highest leverage, nearest to price | `#f5db4c` yellow |

Brighter means hotter leverage. These four colours mean the same thing in the toolbar tier
chips, the Map view bars, and the side panel. `engine/colormap.ts` owns them as
`TIER_COLORS` so there is a single source.

## Surface 1 — Map view

A new top-level tab beside the heatmap, persisted in the existing view state.

Two stacked panels for the selected symbol: **Scalping** (tiers 10/25/50/100×, built from
1h candles) and **Swing** (3/5/10/25×, from 4h). Each is one kline + one open-interest call,
fetched by reusing `useHeatmap` at a fixed interval — independent of whichever interval the
heatmap tab is showing.

Each panel renders:

- vertical tier-stacked bars, price across X, intensity up Y
- a dashed current-price marker with a price label
- cumulative lines on a secondary right axis, shaded toward each side
- hover tooltip: price bin range, per-tier score, cumulative
- wheel and drag zoom on the price axis, with a mini brush strip beneath showing the full
  range and the current window
- a CSV export button: `price_from, price_to, L1..L4, cumulative`, built client-side as a
  Blob download

One help line sits under the view: bars are relative intensity, not contracts or USD;
taller means a stronger expected reaction.

## Surface 2 — heatmap side panel

A collapsible right-docked profile on the heatmap chart, toggled from the toolbar.

Drawn **inside the heatmap canvas** as a reserved ~90px strip between the plot and the
price gutter. Horizontal tier-stacked bars, same palette, sharing the chart's `priceToY`,
so a bar sits at exactly the height of the band it describes. It re-derives from the
current map and live price, so it tracks the live poll cycle without its own fetch.

Auto-collapses below 720px, where 90px of a 390px screen is not affordable. The user can
still toggle it open.

## Resolved open questions

| Question | Decision |
|---|---|
| Which price splits long from short | Live WebSocket price when present, else the last candle's close. |
| Panel as canvas strip or DOM sibling | Canvas strip. A DOM sibling needs the chart's view state lifted and the transform re-derived, giving two things that must agree; the strip has one. |
| Map view interval coupling | Fixed 1h and 4h. The two modes *are* the two leverage regimes; letting the tab's interval float would make the labels lie. |
| Cumulative axis per side or shared | Shared, from `maxCum` across both directions. |
| Bin count | 200 by default; configurable, with 1100 as the identity case used in tests. |
| Empty / pre-load state | A profile over an all-zero column returns bins with zero totals and a valid `priceBinIndex`; charts render an explicit empty state rather than dividing by zero. |

## Testing

Engine, pure, no network:

- cumulative monotonicity outward from price, in both directions, and zero across the divide
- `bin.total` equals the sum of `bin.tiers` for every bin
- bucket→price round-trip: `priceFrom`/`priceTo` line up with the grid, contiguous, no gaps
- identity binning reproduces the heatmap matrix's final column exactly
- `lastColumn` returns column `nCols - 1`, not a copy of some other column
- all-zero column and single-bucket edge cases do not divide by zero

Transform, pure:

- `priceToY` inverts `yToPrice`
- price at `p0` maps to the bottom, `p1` to the top
- the same price yields the same Y for two different callers — the alignment guarantee

CSV, pure:

- header row exact, one row per bin, cumulative column present

## Risks

Rendering two extra canvases raises paint cost. The profile is 200 bins rather than the
heatmap's 1100×220 cells, so it is cheap by comparison; the Map view is only mounted when
its tab is active.
