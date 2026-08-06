# Liquidation Map Implementation Plan

> **For agentic workers:** Executed inline in-session via superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Liquidation Map — an aggregate now-profile of estimated liquidation volume
by price — as both a top-level tab and a side panel on the heatmap.

**Architecture:** `engine/profile.ts` reshapes the *existing* heatmap's last column into
binned, tier-stacked, cumulative form. No new data pipeline. A shared pure `priceToY` in
`ui/scale.ts` guarantees the side panel aligns with the heatmap by construction.

**Tech Stack:** Unchanged — Vite, React 19, TypeScript, Vitest, canvas 2D.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/profile.ts` | **new** — `lastColumn`, `liquidationProfile`, binning, cumulative |
| `src/engine/profileCsv.ts` | **new** — profile → CSV string |
| `src/engine/colormap.ts` | **modify** — add `TIER_COLORS` (four inferno samples) |
| `src/ui/scale.ts` | **new** — pure `priceToY` / `yToPrice`, shared by chart and panel |
| `src/ui/ProfileChart.tsx` | **new** — one Map-view panel: bars, cumulative, brush, tooltip |
| `src/ui/MapView.tsx` | **new** — stacks Scalping (1h) + Swing (4h) panels, help line, CSV |
| `src/ui/HeatmapCanvas.tsx` | **modify** — reserve right strip, draw side panel, use `scale.ts` |
| `src/ui/Toolbar.tsx` | **modify** — tab switcher, side-panel toggle, tier chip colours |
| `src/App.tsx` | **modify** — tab state, mount MapView, pass panel flag |
| `src/config.ts` | **modify** — `Tab`, `showProfile`, `MAP_SCALP_INTERVAL`, `MAP_SWING_INTERVAL` |
| `src/styles.css` | **modify** — tab bar, map layout, tier chip colours, mobile rules |
| `src/ui/hooks/useMedia.ts` | **new** — viewport query for the mobile auto-collapse |

---

## Task 1: Engine — profile (TDD)

**Files:** create `src/engine/profile.ts`, `src/engine/profile.test.ts`

- [ ] **Step 1: Write failing tests**

Key assertions:

```ts
// identity binning reproduces the source column — proves it IS the heatmap's last column
const map = buildHeatmap(candles, [], '4h');
const active = lastColumn(map);
const p = liquidationProfile(active, map.grid, price, { bins: map.grid.nBuckets });
for (let b = 0; b < map.grid.nBuckets; b++) {
  expect(p.bins[b].tiers[0]).toBeCloseTo(valueAt(map, 0, map.nCols - 1, b), 6);
}

// cumulative is monotonic walking away from price, and zero across the divide
for (let i = p.priceBinIndex - 1; i > 0; i--) {
  expect(p.bins[i - 1].cumLong).toBeGreaterThanOrEqual(p.bins[i].cumLong);
}
expect(p.bins[p.priceBinIndex + 3].cumLong).toBe(0);

// stack sum equals tier sum
expect(bin.total).toBeCloseTo(bin.tiers.reduce((a, b) => a + b, 0), 6);
```

Plus: `lastColumn` reads column `nCols - 1`; bins are contiguous with no price gaps;
all-zero column yields zero totals and no NaN; `maxCum` is the max across both directions.

- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** Run → pass. **Step 5:** Commit.

## Task 2: Engine — CSV (TDD)

**Files:** create `src/engine/profileCsv.ts`, `src/engine/profileCsv.test.ts`

- [ ] Failing tests:
  - header is exactly `price_from,price_to,L1,L2,L3,L4,cumulative`
  - one data row per bin
  - the cumulative column carries `cumLong` below price and `cumShort` above
  - values are plain numbers with no thousands separators (a CSV must parse)
- [ ] Run → fail. Implement. Run → pass. Commit.

## Task 3: Shared transform (TDD)

**Files:** create `src/ui/scale.ts`, `src/ui/scale.test.ts`

- [ ] Failing tests:
  - `priceToY(p0, p0, p1, h) === h` (bottom) and `priceToY(p1, …) === 0` (top)
  - `yToPrice(priceToY(x))` round-trips
  - a midpoint price lands at `h/2`
  - zero-height and `p0 === p1` degenerate inputs return finite numbers
- [ ] Run → fail. Implement. Run → pass. Commit.
- [ ] Refactor `HeatmapCanvas` to use it — no behaviour change, tests still green.

## Task 4: Tier palette

**Files:** modify `src/engine/colormap.ts` (+ test), `src/ui/Toolbar.tsx`, `src/styles.css`

- [ ] Test: `TIER_COLORS` has 4 entries, all valid `#rrggbb`, brightness strictly increasing
      by index (the property that makes the ordering meaningful).
- [ ] Implement, apply to tier chips via a `--tier` custom property per chip. Commit.

## Task 5: Side panel in the heatmap

**Files:** modify `src/ui/HeatmapCanvas.tsx`, `src/ui/Toolbar.tsx`, `src/App.tsx`, `src/config.ts`

- [ ] Reserve `PROFILE_W = 90` between plot and price gutter when enabled; plot width shrinks.
- [ ] Draw horizontal tier-stacked bars using the same `priceToY` as the candles.
- [ ] Toolbar toggle; auto-collapse under 720px via `useMedia`.
- [ ] Commit.

## Task 6: Map view

**Files:** create `src/ui/ProfileChart.tsx`, `src/ui/MapView.tsx`; modify `App.tsx`, `Toolbar.tsx`, `styles.css`

- [ ] `ProfileChart`: vertical stacked bars, dashed price marker + label, cumulative lines on
      a secondary axis shaded outward, hover tooltip, wheel/drag price zoom, brush strip.
- [ ] `MapView`: Scalping (1h) above Swing (4h), help line, per-mode CSV download.
- [ ] Tab switcher in the toolbar, `tab` persisted in view state.
- [ ] Commit.

## Task 7: UI/UX + responsive

- [ ] ui-ux-pro-max pass; Map panels stack and stay legible at 390px; no horizontal overflow.
- [ ] Commit.

## Task 8: Verification

- [ ] `npx vitest run` green; `npm run build` exit 0.
- [ ] Browser: Map view renders both modes for XRPUSDT with longs left / shorts right of the
      marker; side-panel bars line up with heatmap bands (screenshot); CSV downloads with
      correct headers; all five presets; 390px stacks and panel auto-collapses.
- [ ] Screenshots desktop + mobile. Commit.

---

## Self-Review

**Spec coverage.** Engine → Tasks 1–2. Shared transform → Task 3. Palette → Task 4.
Side panel → Task 5. Map view → Task 6. UI rules and help line → Tasks 6–7. Verification
list → Task 8. Every spec section maps to a task.

**Placeholders.** None — each task names exact files and concrete assertions.

**Type consistency.** `LiquidationProfile` / `ProfileBin` are defined once in `profile.ts`
and consumed unchanged by `profileCsv.ts`, `ProfileChart`, `MapView`, and `HeatmapCanvas`.
`priceToY` keeps one signature across `scale.ts`, `HeatmapCanvas`, and the panel.
`TIER_COLORS` is defined once in `colormap.ts`.

**Risk.** Task 3 refactors working render code. It is behaviour-preserving and the existing
145 tests plus a browser check gate it before Task 5 builds on top.
