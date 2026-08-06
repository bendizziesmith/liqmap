# Intensity classes + per-symbol price precision

**Date:** 2026-08-06
**Status:** Approved (brief-as-spec; open questions resolved below)

## 1. Heat colours become ordinal classes

**Problem.** The continuous inferno ramp with `x = (s/vmax)^0.68` maps a wide middle band of
values onto near-identical yellows, so a large area reads as one uniform blob. There is no
visible step between the heaviest pocket and a merely warm one.

**Fix.** Quantise into five ordinal classes with deliberate visual separation.

Class breaks come from percentiles of the **visible non-zero values**:

| Class | Range | Share of non-zero area |
|---|---|---|
| 0 | below p50 | ~50% |
| 1 | p50 – p75 | ~25% |
| 2 | p75 – p90 | ~15% |
| 3 | p90 – p97 | ~7% |
| 4 | above p97 | ~3% |

Only ~3% of painted area can be top-class, which is what stops the wash. Values at or below
zero paint nothing at all — the old alpha-35 floor tinted the whole grid and flattened
contrast.

**Two ramps, one module.** `COLORMAPS` holds both; the active id lives in settings.

- **Inferno (classes)** — default, keeps the existing hue family. Luminance per class runs
  31 → 68 → 107 → 172 → 248, every step at least 37 apart, so adjacent classes cannot blur.
- **Classic** — blue → cyan → green → yellow → red, red heaviest. Note this ramp orders by
  **hue, not luminance**: its red (L≈104) is darker than its yellow (L≈201). That is the
  convention traders read natively, so it is kept, and ascending per-class alpha
  (64 → 116 → 170 → 214 → 255) restores the "top class dominates" reading on a dark ground.

**Legend.** Charts guidance for intensity maps is explicit that a scale needs a legend, and
that colour must not be the sole carrier of meaning. A compact five-swatch legend labelled
with each class's est. USD floor makes the hierarchy readable and the thresholds checkable.

**Shared usage.** One module drives the heatmap raster, the side panel and the Map bars.
Tier stacking survives — a bar still shows its leverage breakdown — but the tier palette is
sampled from the *active* colormap, and any bar landing in the top class is drawn in that
colormap's hot colour. So switching colormap changes the whole app coherently, while a
colour still means one leverage tier within a bar.

## 2. Price precision from the instrument, not from magnitude

**Problem.** Every component rolls its own magnitude ladder, so XRP renders `1.050` above a
dollar and `0.9716` below it — precision flips across an arbitrary boundary, and column
widths jitter.

**Fix.** Derive decimals from Bybit's own tick size, once per symbol.

`GET /v5/market/instruments-info?category=linear&symbol={S}` → `priceFilter.tickSize`.
Confirmed: BTCUSDT `0.10` → 1 dp, ETHUSDT `0.01` → 2, XRPUSDT `0.0001` → 4,
ADAUSDT `0.0001` → 4, DOGEUSDT `0.00001` → 5.

Cached with a long TTL (instrument specs effectively never change intraday). If the fetch
fails, fall back to the existing magnitude heuristic so the chart still renders.

**One formatter, every site.** `formatPrice(symbol)` is used by: price-axis ticks, the live
price label and its axis tag, the watchlist, the heatmap tooltip, the side-panel tooltip,
the Map tooltip, the Map X axis, the liquidation tape, alert notifications, the alerts log,
and CSV export. No component formats a price itself.

CSV keeps plain parseable numbers — fixed decimals, no separators or symbols.

## Resolved open questions

| Question | Decision |
|---|---|
| Do panel/Map bars switch to intensity colours entirely? | No. Bar **length** already encodes magnitude, so recolouring by intensity would be redundant and would destroy the tier breakdown established last round. Tier stacking stays; the tier palette is sampled from the active colormap and top-class bars take its hot colour. |
| Percentile set | p50 / p75 / p90 / p97, tuned by eye against live BTCUSDT 4h and XRPUSDT 1h. |
| Zero-value cells | Paint nothing. The previous alpha-35 floor tinted the entire grid and cost contrast. |
| Where breaks are computed | Over the visible window only, like `vmax` — zooming into a quiet region reveals its structure instead of rendering it all class 0. |
| Legend | Added, though not requested: the charts guidance requires a legend for intensity scales, and it makes thresholds verifiable. |
| Tick size vs `priceScale` | `tickSize`, because it is the actual increment; `priceScale` happens to agree for these symbols but is a display hint. |

## Testing

Classes: breaks ascending; `classOf` monotone in value; invariant under rescaling value and
breaks together; zero and negative map to "no paint"; five classes with the documented
luminance separation; both ramps define all five.

Price: `decimalsFromTickSize('0.0001') === 4`, `'0.10' === 1`, `'0.00001' === 5`;
XRPUSDT renders `1.0500` and `0.9716` at equal width; BTCUSDT `64860.6`; unknown symbol
falls back without throwing; the instrument fetch is cached and parses `tickSize`.
