# LiqMap

**Live: [liqmap.smithblock.ai](https://liqmap.smithblock.ai)** (liqmap.netlify.app remains as an alias)

A crypto liquidation heatmap that runs entirely in your browser. It pulls public Bybit v5
market data, computes where leveraged positions would be liquidated, and paints the result
as a time × price heatmap. No API key, no backend, no account.

![Desktop](docs/screenshots/desktop.png)

## Run it

```bash
npm install
npm run dev       # http://localhost:5177
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm test` | Engine + data-layer unit tests (no network) |
| `npm run build` | Typecheck and produce a static `dist/` |
| `npm run preview` | Serve the production build |
| `npm run screenshots` | Recapture `docs/screenshots/` from a running dev server |
| `node scripts/verify-backfill.mjs` | Pan back through history, reporting candles/date/heap per page |

## What you are looking at

**Bright horizontal bands are price levels where a lot of leverage would get liquidated.**
Price tends to be drawn toward them, and they often act as acceleration zones rather than
support — when price reaches one, the liquidations there become forced market orders.

**A band that stops dead in the middle of the chart has been consumed.** Every candle
erases the levels inside its own high–low range, because price trading through a level means
those positions are already liquidated. That vertical edge is the moment the level got
swept, and it is the single most informative thing on the chart.

Figures are **estimated USD notional**, labelled "est." throughout, and **calibrated to open
interest**. Liquidations can only come from positions that are currently open, so the active
unswept book is scaled to total the symbol's reported `openInterestValue` — raw engine values
are cumulative turnover over the whole window and reach billions, far more than could ever
liquidate.

**Each side is anchored separately.** Open interest counts contracts, and every contract has
a long holder and a short holder, so $227M of OI means $227M of longs standing *and* $227M of
shorts. Scaling both sides against a single OI figure undercounts each by about two. Fully
zoomed out, cumulative longs and cumulative shorts each converge on OI.

Cumulative figures sum over the **whole loaded book** outward from current price, so zooming
changes what you can see but never what the tooltip reports at a given price. These are
display multipliers only; no engine value or rendering normalisation changes.

## Liquidation Map

The **Map** tab answers a different question from the heatmap. The heatmap is history — how
levels built up and got swept over time. The Map is *now*: how much estimated liquidation
volume is sitting at each price level at this moment, stacked by leverage tier.

![Liquidation Map](docs/screenshots/map-desktop.png)

It is literally the heatmap's **last column** — the active-levels snapshot after the most
recent candle's clearing pass — reshaped into a price profile. There is no second pipeline.

- **Scalping** (10/25/50/100×, from 1h candles) and **Swing** (3/5/10/25×, from 4h) are
  shown together, because the two leverage regimes sit at very different distances.
- Everything **left of the dashed marker is long liquidations**, everything right is shorts.
- The **cumulative curve** sums outward from current price in each direction: how much total
  liquidation price would pass through to reach a given level.
- **Export CSV** gives `price_from, price_to, L1..L4, cumulative` per mode, in est. USD.

**History loads as you pan.** The first request returns 1000 candles; panning within 15% of
the left edge fetches the next 1000 older ones and rebuilds, up to a 5000-candle cap
(~164 MB heap, ~13 ms per rebuild). The view shifts with the prepend so it does not jump.

You will usually see a **gap either side of current price**. That is not missing data — the
latest candle cleared its own high–low range, so nothing is pending where price just traded.

The same profile is available as a **side panel** on the heatmap (the panel button in the
toolbar), drawn against the chart's own price axis so each bar sits at exactly the height of
the band it describes. It collapses automatically on narrow screens.

Tier colours mean the same thing everywhere — toolbar chips, Map bars, side panel:
deep purple is the lowest leverage, bright yellow the highest.

## Controls

- **Wheel** zooms time, **shift/ctrl+wheel** zooms price, **drag** pans, **double-click**
  refits. On touch: one finger pans, two fingers pinch.
- **Drag an axis to zoom it**: vertically on the price axis (up zooms in, TradingView
  convention), horizontally on the time axis. Wheel over an axis zooms that axis alone, and
  double-clicking an axis refits just that one.
- **Tier buttons** (3×/5×/10×/25× on swing, 10×/25×/50×/100× on scalping) toggle which
  leverage cohorts are painted. This is render-only — nothing is recomputed.
- **Watchlist** shows each symbol's live price and the distance to its nearest strong band.
- **Settings** holds proximity alerts: notify when a band above a strength threshold comes
  within a chosen percentage of price.

## How it works

```
src/
  engine/     pure, synchronous, no React and no network — all of the maths
    tiers.ts        interval → leverage ladder, liquidation price formulas
    grid.ts         1100-bucket price axis
    oi.ts           open-interest alignment and the ΔOI weight multiplier
    seed.ts         per-candle clear + seed of the live level vector
    build.ts        the walk: clear → seed → snapshot, plus reseedLast for live ticks
    normalize.ts    p99.7 percentile → vmax, gamma curve
    bands.ts        column → ranked price levels
    profile.ts      last column → binned, tier-stacked profile + cumulative curves
    profileCsv.ts   profile → CSV
    classes.ts      ordinal intensity classes + the two colormaps
    price.ts        tick-size → decimals, one price formatter
    calibrate.ts    scale the active book onto open interest
    history.ts      merge older pages, cap, backfill trigger
    panelProfile.ts active levels → per-screen-row bars, cumulative, hot pockets
    usd.ts          $12.4K / $3.2M / $1.1B formatting
    alerts.ts       relative band scaling, proximity + cooldown logic
    colormap.ts     inferno ramp + the four tier colours
  data/       network only
    rest.ts         kline, open interest (cursor paginated), tickers
    ws.ts           public linear socket, 20s ping, backoff reconnect
    cache.ts        TTL memo shared by the watchlist
    instruments.ts  per-symbol tick size, cached for the session
  ui/         React
    scale.ts        the one price↔Y transform, shared by chart and side panel
    axis.ts         axis drag-to-zoom maths
    gesture.ts      pinch maths + safe pointer capture
    HeatmapCanvas   heat raster, candles, crosshair, docked profile strip
    ProfileChart    one Map panel: bars, cumulative, brush, tooltip
    MapView         Scalping + Swing panels, CSV export
    …               toolbar, watchlist, settings, hooks
```

### The model

For each closed candle, oldest first:

1. **Decay** every level by its tier's per-candle factor `2^-(candleDays / halfLife)`.
   Clearing alone treats a level price never revisited as a position someone is still
   holding, but most positions are closed, stopped or rolled long before they are
   liquidated — so unswept levels accumulate into ghosts. Half-lives track how long each
   leverage can realistically be *held*: swing `3x 60d · 5x 30d · 10x 14d · 25x 5d`,
   scalping `10x 5d · 25x 2d · 50x 1d · 100x 12h`. Decay runs inside the same walk, so a
   2024 level visibly fades column by column instead of the chart being re-scaled at the
   end, and values under 1e-6 of the column peak are floored to zero. Toggle in Settings.
2. **Clear** every bucket inside `[low, high]`. Price traded there, so those positions are gone.
3. **Seed** the levels the candle implies, in USD. Three entry anchors — close `0.45`,
   high `0.275`, low `0.275` — each carrying
   `turnover × clamp(1 + 8·max(ΔOI/OI, 0), 1, 3)`
   split across four tiers as `[0.35, 0.30, 0.20, 0.15]`, then **halved between the long and
   short side** so a candle's dollars are counted once rather than twice.
   Long liquidation at `entry·(1 − 1/L)`, short at `entry·(1 + 1/L)`, each level spread
   over a small triangular kernel (`0.25/0.5/0.25` across three buckets — an entry is not
   at one exact tick, and a one-bucket needle claims precision the model does not have).
   Edge shares fold back in, so with no clearing or decay the grid still sums to exactly
   `Σ turnover × oiFactor`.
4. **Snapshot** the live vector into column `t`.

Decay comes before seeding so a candle's own entries land at full weight — they were opened
during that candle and have had no time to age.

One `Float32Array` per tier (`nCols × 1100`), so tier toggles never trigger a rebuild.

Rendering quantises intensity into **five ordinal classes** rather than a smooth ramp — a
continuous gradient mapped a wide middle band onto near-identical yellows, so large regions
read as one uniform blob. Class breaks are the p50/p75/p90/p97 percentiles of the non-zero
values currently on screen, so only ~3% of painted area can be top class, and alpha rises
per class. Breaks are drawn **per side of the book**: one shared ladder ranks every visible
cell together, and whichever side price sits near occupies a far narrower band of buckets,
so its levels are denser per bucket and take the top classes while the other side collapses
into the two faintest. Measured on XRPUSDT 1d, the above-price half held $28.16B against the
below-price half's $10.75B and still rendered with 3.9% hot cells against 49.2% — the scale
was hiding 2.6x more mass than it showed. Ranking each side against its own distribution
costs cross-side comparability, which the tooltip and the side panel still give exactly, and
buys back the structure of whichever half is quieter. The legend carries a row per side. Two ramps ship: **Inferno (classes)** by default and a **Classic**
blue→cyan→green→yellow→red where red is heaviest; the choice lives in Settings and drives
the raster, the side panel and the Map together. A legend labels each class with its est.
USD floor, and notes that the faintest quarter of class 0 is hidden entirely — a noise
floor that keeps the ground clean dark instead of dim speckle.

The raster is drawn at **display-row** resolution, not bucket resolution: when the visible
bucket span exceeds what the plot can show at ≥3px per row, each row takes the *sum* of the
buckets it owns (mass conserved, so the class ladder stays honest), and zooming in returns
naturally to one bucket per row. Before this, one source pixel per bucket meant the blit's
nearest-neighbour sampling silently discarded every bucket that didn't land on an output
row — levels flickered with zoom and the chart read as 1px static. The side panel is built
on the same row grid, so bars are exactly as tall as the bands they describe. A "Smooth
The heat is **never** interpolated: `imageSmoothingEnabled = false` is a constant, not a
preference. Measured live at BTCUSDT 4h, smoothing on left 57.3% of heat pixels interpolated
rather than palette colours, **zero** hard class edges anywhere in the plot, and the five
designed alphas spread across 199 distinct values — soft, glowy, and with no definite band
position, which also reads as misalignment. Crisp measures exactly five alphas.

Display rows have a **1px** floor. They exist to stop buckets being dropped by resampling —
which is what the sum aggregation fixes — not to fatten bands; a 3px floor merged
neighbouring levels into blocks and cost the per-candle structure the chart is read for.

### Settings that cannot strand you

Persisted settings are **versioned** (`SETTINGS_VERSION`). A plain merge of stored-over-
defaults means the first value a user ever received wins forever, so a corrected default
can never reach them — that is exactly how a build shipping `smoothRendering: true` kept
rendering smooth long after the default became `false`. On load, `migrateSettings` drops
keys the app no longer owns, fills in keys added since, and on a version bump resets model
and render settings to shipped while carrying personal alert preferences forward. The build
ID and a **Reset to defaults** control sit at the top of the Settings panel.

### Minimum-pool threshold

A log-scaled slider hides every pool below a chosen est. USD, so the chart thins to only
the levels worth reacting to. Its travel spans the *actual* pool range on screen (smallest
to largest) rather than a fixed decade count — measured on BTCUSDT 4h the pools ran
$2.3M–$51.2M, so a fixed 3-decade slider did nothing across its whole bottom half. Position
0 is a true zero: "show all" is reachable, not merely approached.

The filter applies to the **heatmap raster only**. The side panel and the Map profile always
show the complete current book — they are the baseline the thinned heatmap is read against,
and filtering them too would remove the reference that makes the thinning legible. Verified
live: varying the threshold changes **zero** panel bar rows, against a control that drifts
by more from elapsed time alone, while the heat area falls 566k → 29k pixels. `rasterCutoff`
is the single place the threshold becomes a cutoff, and `ProfileChart` has no threshold prop
at all, so the Map cannot filter even by mistake. Panel and Map tooltips are labelled
`full book`; the heatmap's note says the view is filtered whenever a threshold is set. The USD cut-off is converted to raw engine
units per side from a scale *snapshot* pinned to the dataset — a live OI-varying input in
the paint would re-grade history on a tick and break the stability contract below. Each tier
chip carries its est. USD among the visible, above-threshold pools, with a combined total,
and the threshold is remembered per symbol and timeframe.

### Intra-candle stability

Between candle closes, only the forming column, the price line and the side panel may
change — every historical pixel stays bit-identical. The class ladder's percentile samples
exclude the forming column (so the ladder recomputes on candle close, symbol/timeframe
change, zoom/pan and tier toggles — never on a websocket tick), the raster's long/short
split keys on the forming candle's open, and near-price gridlines are never tied to the
tick. Verified by pixel-diffing live captures 15s apart: 0 changed pixels outside the
forming column and the price line.

Every surface reads one shared per-row series: the panel bins buckets through the same
`rowOfBucket` as the raster, bars sit at the blit's own y-mapping, and both tooltips report
the display row's per-tier sums under one side rule — so the heat cell, the bar and both
tooltips describe the same dollars at the same price (`scripts/verify-surfaces.mjs` asserts
it live, three-legged, via `window.__liqmapAudit`).

### Time axis

Ticks are generated from the **time domain**, not by stepping column indices. A step is
chosen from a calendar ladder (minute → year) to suit the zoom, and boundaries align to local
calendar units, so labels land on real dates: year starts read `2026`, month starts `Mar`,
and day numbers or `HH:mm` in between. Labels are a pure function of the tick's own date —
never of its neighbours — which is what keeps a tick glued to its date while the chart pans
and through a history prepend that shifts every column index underneath it. Index-modulo
stepping, which this replaces, landed on arbitrary dates and could print the same label twice.

### Price precision

Decimals come from the instrument's own `priceFilter.tickSize`, fetched once per symbol and
cached — BTC 1 dp, ETH 2, XRP and ADA 4, DOGE 5. One `formatPrice` feeds the axis, the live
tag, the watchlist, all three tooltips, the Map axis, the tape, alerts and CSV, so a symbol
renders at one precision everywhere. Formatting by magnitude, which this replaces, flipped
XRP between `1.050` and `0.9716` across the dollar line.

### Why Bybit only

Binance rejects browser CORS on its public market endpoints, so a no-backend build cannot
use it. Bybit's v5 public endpoints are CORS-open and need no key. Symbols are Bybit linear
perpetuals; the custom input accepts any of them.

## Tests

```bash
npm test
```

321 tests, none of which touch the network — `fetch` and `WebSocket` are stubbed. The engine
is pure, so it is tested directly against synthetic candles. The load-bearing cases are the
clearing invariant (a level seeded at candle 0 survives to candle 2 and is exactly zero at
the candle whose range covers it), USD conservation, and cumulative monotonicity outward
from current price.

## PWA and iOS

`vite.config.ts` sets `base: './'` so every asset path is relative, and the service worker
caches **only** the app shell — requests to `api.bybit.com` are network-only and never
cached, because a stale liquidation map is worse than none. The build is static with no SSR
and no Node runtime requirements, so it can be wrapped with Capacitor as-is. Layout already
honours `env(safe-area-inset-*)` and works down to 360px.

![Mobile](docs/screenshots/mobile.png)

## Deploying

Netlify builds `npm run build` and publishes `dist/`. Pushes to `main` auto-deploy via a
GitHub webhook into a Netlify build hook.

`netlify.toml` carries the header policy that matters:

| Path | Cache-Control | Why |
|---|---|---|
| `/assets/*` | `immutable`, 1 year | Vite fingerprints the filenames, so changed content is always a changed URL |
| `/sw.js` | `must-revalidate` | A cached service worker keeps serving its old precached shell — users get pinned to a build you already replaced |
| `/index.html`, `/` | `must-revalidate` | It points at the fingerprinted bundles, so a stale copy pins the whole app |

The build id shown in Settings comes from Netlify's `COMMIT_REF`, so you can always tell
which build a browser is actually running.

## Caveats

- Liquidation levels and their USD figures are **inferred** from price, turnover and open
  interest. Exchanges do not publish per-position leverage, so this is a model, not ground
  truth.
- The USD scale is **anchored to open interest**, not to the raw turnover the engine sums.
  Without that anchor the totals read as flow (months of notional through a level) rather
  than stock (what is standing there now), and land an order of magnitude too high.
- Levels far from price are never swept, so they accumulate into bright shelves near the
  grid edges. That is the model behaving correctly, but it means band strength is judged
  within ±12% of price (`BAND_WINDOW_PCT`) so those shelves do not drown out everything else.
- Open interest history is short on some symbols; where it is missing the weight multiplier
  falls back to a neutral 1 and the map is turnover-weighted only.
