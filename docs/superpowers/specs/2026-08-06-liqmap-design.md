# LiqMap — Client-Side Liquidation Heatmap PWA

**Date:** 2026-08-06
**Status:** Approved (brief-as-spec; open questions resolved below)

## Purpose

Render a TradingDifferent-style crypto liquidation heatmap computed entirely in the
browser from free Bybit v5 public endpoints. No API key, no backend, no server-side
rendering. Static build so the same bundle can later be wrapped with Capacitor for iOS.

## Non-goals

- No Capacitor/iOS packaging this run (only: do not block it — no SSR, no Node runtime deps,
  no absolute-origin assumptions).
- No account, no persistence beyond `localStorage`.
- No alternative data providers. Binance rejects browser CORS; Bybit is the only source.

## Architecture

Three layers with a one-way dependency arrow: `ui → data → engine`. The engine never
imports React or touches the network; the data layer never imports React.

```
engine/   pure, synchronous, fully unit-tested
  tiers.ts       mode + tier config, liquidation price math
  grid.ts        price↔bucket mapping over a fixed 1100-bucket grid
  oi.ts          open-interest alignment + ΔOI factor
  seed.ts        per-candle clear + seed of the active level vector
  build.ts       orchestration: candles+OI → per-tier Float32 matrices
  normalize.ts   percentile (vmax) over visible non-zero values
  colormap.ts    inferno LUT + score→RGBA mapping

data/     network only, no rendering
  rest.ts        kline + open-interest fetch, OI cursor pagination
  ws.ts          Bybit public linear socket: tickers + allLiquidation, 20s ping
  cache.ts       in-memory TTL cache used by the watchlist

ui/       React
  HeatmapCanvas  offscreen native-res raster → nearest-neighbour upscale
  Toolbar        symbol presets, custom symbol, interval, tier toggles
  Watchlist      five symbols, live price, distance-% to nearest strong band
  Settings       alert threshold + proximity, persisted
  hooks/         useHeatmap, useTicker, useWatchlist, useAlerts, usePersisted
```

## Engine model

**Modes.** `5m/15m/1h` → scalping, tiers `[10, 25, 50, 100]`.
`4h/1d` → swing, tiers `[3, 5, 10, 25]`.

**Grid.** 1100 buckets, linear in price, spanning
`[minLow·(1 − 1/minTier), maxHigh·(1 + 1/minTier)]` where `minTier` is the lowest leverage
in the active mode. Bucket 0 is the lowest price.

**Per closed candle `t`, in this order:**

1. **Clear.** Zero every bucket whose price falls inside `[low_t, high_t]`, in all four
   tier vectors. Price traded there, so those positions are already liquidated.
2. **Seed.** For each entry anchor — `close` weight `0.45`, `high` weight `0.275`,
   `low` weight `0.275` — deposit
   `w = min(turnover_t / medianTurnover, 5) × oiFactor_t`
   split across tiers by `[0.35, 0.30, 0.20, 0.15]`, where
   `oiFactor_t = clamp(1 + 8·max(ΔOI_t/OI_t, 0), 1, 3)`.
   Long liquidation price `= entry·(1 − 1/L)`; short `= entry·(1 + 1/L)`.
3. **Snapshot.** Column `t` of each tier matrix is a copy of that tier's active vector.

The clearing rule in step 1 is what makes the chart correct: a column shows only levels
that are *still* live as of that candle.

**Storage.** One `Float32Array(nCols × nBuckets)` per tier, row-major by column. Tier
toggles are therefore render-only — no rebuild. 4 tiers × 1000 × 1100 ≈ 17.6 MB, and
building costs one 1100-float `.set()` per column, not a full-matrix copy.

## Rendering

Values are **relative scores**, never labelled as USD.

- `vmax` = p99.7 of the non-zero values in the visible window.
- `x = (s / vmax)^0.68`, clamped to 1.
- Colour = inferno(x); `alpha = 35 + 220·min(1, 1.25x)`.
- Raster is drawn at native `cols × buckets` resolution on an offscreen canvas, then
  blitted with `imageSmoothingEnabled = false` for a crisp nearest-neighbour upscale.
- Overlays: candles, dashed live-price line, crosshair with per-tier scores at the cursor.
- Interaction: wheel = zoom time; shift/ctrl+wheel = zoom price; drag = pan; double-click
  = refit.

## Data flow

REST snapshot on symbol/interval change (`kline limit=1000` + paginated open-interest),
build the engine once, then WebSocket keeps the live price and liquidation ticks current.
`tickers.{S}` drives the price line and watchlist; `allLiquidation.{S}` drives the live
tape (`side === "Buy"` means a **short** was liquidated). Ping every 20 s. If the socket
is not open, a 15 s REST poll of the ticker takes over, and the status pill reflects
which path is active.

## Resolved open questions

| Question | Decision |
|---|---|
| Long/short split inside a tier | Both sides receive the full tier amount (symmetric book). The resulting global ×2 does not affect relative scores. |
| ΔOI when OI history is short or missing | `oiFactor = 1`. The heatmap degrades to turnover-only weighting rather than failing. |
| OI cadence vs candle cadence | Align OI samples to candle start timestamps and forward-fill; ΔOI compares consecutive aligned samples. |
| Watchlist band distances | Each of the five symbols gets its own engine run, staggered and cached for 5 minutes, so distances are real rather than borrowed from the active symbol. |
| `vmax` sample set | Non-zero visible values only — zeros would drag the percentile to 0 on sparse grids. |
| Column count | One column per **closed** candle; the forming candle is excluded from the matrix. |

## Error handling

- Bybit `retCode !== 0` → typed `BybitError` carrying `retCode`/`retMsg`, surfaced in the
  status bar rather than thrown into a blank screen.
- Unknown/invalid symbol → empty kline list → explicit "no data for SYMBOL" state.
- Socket close → exponential-backoff reconnect (capped), REST polling meanwhile.
- Notification permission denied → alerts silently downgrade to in-app badges.

## Testing

Vitest, no network. The engine is pure so it is tested directly with synthetic candles:

- a level seeded at candle `t` is zero at candle `t+2` when `t+2`'s range covers it
- tier liquidation-price math for both sides at every leverage
- anchor weights, turnover clamp at 5×, and OI factor clamp at `[1, 3]` compose correctly
- percentile picks the expected value and ignores zeros
- grid round-trips price → bucket → price within one bucket width

Data clients are tested against a stubbed `fetch` and a fake socket.

## PWA

Manifest plus a service worker that precaches **only** the app shell (HTML, JS, CSS,
icons). Any request to `api.bybit.com` is network-only and never cached — a stale
liquidation map is worse than no map.
