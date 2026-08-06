# USD denomination, axis parity, side-panel upgrade

**Date:** 2026-08-06
**Status:** Approved (brief-as-spec; open questions resolved below)
**Builds on:** `2026-08-06-liquidation-map-design.md`

## 1. Engine — estimated USD

Seeding drops the median-turnover normalisation and carries notional instead:

```
amount(anchor, tier) = candle.turnover × oiFactor × anchorShare × tierShare
long liq  += amount / 2
short liq += amount / 2
```

Bucket values are therefore **estimated USD at risk** at that price level. The halving is
what makes the number honest: a candle's turnover is the notional that traded, and it is
split between the longs and the shorts it opened — depositing the full amount on both sides
would double-count it. It is a uniform factor, so percentile-normalised rendering is
unchanged.

**Conservation invariant:** with no clearing, the sum of every bucket in a column equals
`Σ turnover × oiFactor` over the seeded candles. This is the new headline engine test.

The `min(turnover / median, 5)` clamp is removed. It existed to stop one outlier dominating
a *relative* scale; on a USD scale a huge-volume candle genuinely did carry huge notional,
and the percentile normalisation still handles the visual.

**Formatting.** `formatUsd` → `$0`, `$950`, `$12.4K`, `$3.2M`, `$1.1B`. Every USD figure in
the UI is prefixed "est." and the footer disclaimer stays.

## 2. Live partial-candle updates

`buildHeatmap` additionally returns `baseline` — the active-level vectors as of the
*second-to-last* candle — plus the last candle's OI factor. `reseedLast(map, candle)` then
recomputes only the final column: clear from baseline, seed the new candle, write one
column. O(nBuckets) instead of rebuilding 1000 columns and re-allocating ~18 MB.

The websocket subscribes `kline.{interval}.{symbol}`. An unconfirmed candle re-seeds the
last column; a confirmed one (a new candle has opened) triggers a full refetch, which
happens once per interval. The 15 s REST poll stays as fallback only.

## 3. Axis interactions (both charts)

Pure maths in `ui/axis.ts`, DOM wiring thin:

```ts
axisZoomFactor(deltaPx, sensitivity): number   // exponential, symmetric
scaleAbout(domain, factor, anchorFraction): [number, number]
```

- Vertical drag on the price axis zooms price about the axis centre. **Up zooms in**
  (`factor < 1`), down zooms out — stated TradingView convention.
- Horizontal drag on the time axis zooms time. On the Map view the bottom axis is price, so
  a horizontal drag there zooms price.
- Wheel over an axis zooms that axis only; wheel over the plot keeps existing behaviour.
- Double-click an axis refits **that axis only**; double-click the plot refits both.
- Cursor is `ns-resize` over the price axis, `ew-resize` over the time axis, `crosshair`
  over the plot.

## 4. Side panel

- Bars anchor at the price axis and grow **leftward** into the chart.
- Cumulative curves run along the panel: shorts summed upward from current price in amber,
  longs summed downward in green, each with a subtle area fill.
- Levels in the top 8% of visible bar values render in the amber accent so heavy pockets
  read instantly; everything else keeps its tier colour.
- Hover gives a specific price, per-tier est. $, total est. $, and cumulative long/short
  est. $ to that level.

## 5. Map view

- Tooltip reports a **specific price** — the bin midpoint at tick precision — never a
  from–to range. Per-tier est. $, total, and cumulative longs/shorts with a colour key.
- Secondary axis labelled in `$M`; Y axis labelled "Est. Liquidation Volume (USD)".

## Resolved open questions

| Question | Decision |
|---|---|
| Long/short split of a candle's notional | 50/50. The spec's formula deposits on both sides; without halving, totals are 2× turnover and the USD figure overstates by double. Uniform, so visuals are unchanged. |
| Cumulative curve colours | Longs green, shorts amber, on **both** panel and Map. The Map previously used red/teal; a colour must mean one thing across surfaces, so the Map moves to match the panel spec. |
| "Symbol tick precision" | Derived from price magnitude rather than a per-symbol `instruments-info` fetch — it yields the same decimals for every symbol in scope and costs no extra request. Noted as an approximation. |
| Removing the 5× turnover clamp | Removed as specified. Relative-scale protection is now the percentile normalisation's job. |
| `medianOf` | Deleted along with its tests; nothing consumes it once median normalisation is gone. |
| Confirmed-candle handling | Full refetch, once per interval. Appending in place would need grid re-derivation when a new extreme arrives. |

## Testing

Engine: conservation of turnover into bucket totals; per-tier/anchor USD amounts; OI factor
still multiplies; `formatUsd` thresholds and rounding; `reseedLast` reproduces a rebuild,
clears a swept level, and leaves earlier columns untouched.

Axis: `axisZoomFactor` is 1 at zero, symmetric (`f(d)·f(−d) = 1`), up zooms in, clamped;
`scaleAbout` holds the anchor and preserves ordering.

Data: the websocket subscribes the kline topic and parses confirmed vs forming candles.
