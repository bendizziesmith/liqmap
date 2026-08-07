# Threshold filters the heatmap only

## Why

The side panel and the Map profile are the **complete current book** — the baseline the
thinned heatmap is read against. Filtering them too removes the reference that makes the
thinning legible: with all three surfaces filtered there is nothing left on screen showing
what was taken away.

## Change

| surface | threshold applies |
|---|---|
| heatmap raster | **yes** |
| heatmap side panel — bars and cumulative curves | no |
| Map profile — bars, brush strip, curves | no |

Structurally enforced where possible: `ProfileChart` loses its `minUsd` prop entirely, so
the Map *cannot* filter. The heatmap keeps one cutoff, derived by `rasterCutoff`, and only
the raster loop reads it.

## Contract change

The surface-consistency audit asserted heatmap ≡ panel at every threshold. That is now
wrong by design. Replacing it with two assertions:

1. **At threshold 0** heatmap and panel still agree 20/20 — the shared row series is
   unchanged, only what the raster paints differs.
2. **Panel invariance**: dragging the slider must not change a single panel bar length or
   tooltip figure. Verified by pixel-diffing the panel strip across three slider positions
   — it must be byte-identical while the heatmap visibly thins.

## Tooltips

Ambiguity is the risk: two surfaces reporting different numbers for the same price with the
same label. So the label says which book is being read — panel and Map totals are marked
`full book`, and the heatmap's note says the view is filtered whenever a threshold is set.
