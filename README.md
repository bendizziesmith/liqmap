# LiqMap

**Live: [liqmap.netlify.app](https://liqmap.netlify.app)**

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

1. **Clear** every bucket inside `[low, high]`. Price traded there, so those positions are gone.
2. **Seed** the levels the candle implies, in USD. Three entry anchors — close `0.45`,
   high `0.275`, low `0.275` — each carrying
   `turnover × clamp(1 + 8·max(ΔOI/OI, 0), 1, 3)`
   split across four tiers as `[0.35, 0.30, 0.20, 0.15]`, then **halved between the long and
   short side** so a candle's dollars are counted once rather than twice.
   Long liquidation at `entry·(1 − 1/L)`, short at `entry·(1 + 1/L)`.
   With no clearing, the grid sums to exactly `Σ turnover × oiFactor`.
3. **Snapshot** the live vector into column `t`.

One `Float32Array` per tier (`nCols × 1100`), so tier toggles never trigger a rebuild.

Rendering quantises intensity into **five ordinal classes** rather than a smooth ramp — a
continuous gradient mapped a wide middle band onto near-identical yellows, so large regions
read as one uniform blob. Class breaks are the p50/p75/p90/p97 percentiles of the non-zero
values currently on screen, so only ~3% of painted area can be top class, and alpha rises
per class. Two ramps ship: **Inferno (classes)** by default and a **Classic**
blue→cyan→green→yellow→red where red is heaviest; the choice lives in Settings and drives
the raster, the side panel and the Map together. A legend labels each class with its est.
USD floor. The raster is drawn at native bucket resolution and upscaled with smoothing off,
so buckets stay crisp.

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
