# OI-anchored USD + history backfill

**Goal:** Make displayed USD mean something (anchor the active book to open interest) and
let the chart page back past the first 1000 candles.

---

## Task 1: Calibration engine (TDD)

**Files:** create `src/engine/calibrate.ts` + test; modify `src/data/rest.ts`

Liquidations can only come from **standing open positions**, so the total of all active,
unswept levels should be about the open interest — not the cumulative turnover that flowed
through those levels over months. One multiplier fixes the denomination without touching a
single engine value or any rendering normalisation.

- [ ] `sumActive(tiers)` — total of the active (last-column) levels.
- [ ] `calibrationScale(oiValue, activeTotal)` → `oiValue / activeTotal`, or `1` when either
      is unknown so the display degrades to raw relative units rather than to zero.
- [ ] `fetchTicker` also returns `openInterestValue`.
- [ ] Tests: scaled active total equals the OI value within ε; scale of 1 on missing data;
      scale tracks a refreshed OI; monotone in OI.

## Task 2: Thread the scale to every displayed figure

**Files:** `HeatmapCanvas`, `ProfileChart`, `MapView`, `profileCsv`, `useLive`, `App`

- [ ] `useLive` tracks `openInterestValue` per symbol: seeded by a REST ticker read on symbol
      change, then updated from the `tickers` websocket delta and the fallback poll.
- [ ] Every `formatUsd`/`formatUsdPrecise` call site multiplies by the scale: both heatmap
      tooltips, the panel's cumulative rows, the legend floors, the Map tooltip, the Map
      cumulative axis, and the CSV.
- [ ] The Map's two panels each derive their own scale from their own active total, both
      anchored to the same OI value.

## Task 3: History backfill (TDD)

**Files:** `src/data/rest.ts`, `src/ui/hooks/useHeatmap.ts` + test, `HeatmapCanvas`

- [ ] `fetchKlines(symbol, interval, endMs?)` — Bybit pages backwards with `end`.
- [ ] `mergeOlder(existing, older)` — prepend, drop duplicate timestamps, keep oldest-first.
- [ ] `useHeatmap` holds the candle array, exposes `loadOlder()`, `loadingOlder`, `atCap`
      and a cumulative `prependedCount`. Cap **5000** candles.
- [ ] `HeatmapCanvas` asks for more when the view comes within 15% of the left edge, shifts
      its domain by the prepended count so the view does not jump, and only refits when the
      dataset identity (symbol/interval/refresh) changes rather than on every prepend.
- [ ] Drop the whole-matrix `combined` memo: at 5000 candles it is a 22 MB allocation
      rebuilt on every live tick, and the paint only ever reads visible cells anyway.
- [ ] Tests: prepend keeps a known candle's column aligned once shifted; duplicates are
      dropped; the cap is respected; a prepend that would exceed the cap is truncated.

## Task 4: Verify

- [ ] Tests + build green, push, wait for deploy.
- [ ] Live: XRPUSDT cumulative longs in the $100M–$1B band, quoted beside Bybit's
      `openInterestValue`; pan left on BTCUSDT 4h past 2026-02-20 with heat rendered;
      no view jump; measured heap at the 5000 cap; rebuild time at cap.
- [ ] Screenshot: backfilled dates earlier than the old boundary.

## Self-review

Coverage: calibration → Tasks 1–2, backfill → Task 3, verification → Task 4. The engine's
internal values and all normalisation stay untouched, which is the stated constraint — the
scale is applied only where a number is formatted for display.
