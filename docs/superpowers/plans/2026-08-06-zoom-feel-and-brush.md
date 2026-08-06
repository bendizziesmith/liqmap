# Zoom feel + brush-only Map zoom

**Goal:** Make heatmap zooming gradual and delta-proportional, and move all Map range
control onto the brush so the Map page scrolls like a normal document.

---

## Task 1: Delta-proportional wheel zoom

**Files:** modify `src/ui/axis.ts` (+ `axis.test.ts`), `src/ui/HeatmapCanvas.tsx`

Today the wheel applies a flat `1.15×` per event whatever the delta, so a trackpad's many
small events compound and zooming out runs away.

- [ ] `wheelZoomFactor(deltaY, deltaMode)` → `exp(WHEEL_K · normalisedPx)`, clamped per event.
      `WHEEL_K = 0.00075`, so one 100px notch ≈ **1.078×**.
- [ ] Normalise `deltaMode`: lines (Firefox) × 33px so a 3-line notch ≈ Chrome's 100px;
      pages × 400px.
- [ ] Tests: zero delta → 1; one notch inside 1.07–1.09; monotone; symmetric
      (`f(d)·f(−d) = 1`); clamped against a flick; line-mode notch ≈ pixel-mode notch;
      non-finite → 1.
- [ ] Retune `AXIS_DRAG_SENSITIVITY` 160 → 400 so a deliberate axis drag is not ~8× more
      violent per pixel than the wheel.

## Task 2: Pure brush geometry

**Files:** create `src/ui/brush.ts`, `src/ui/brush.test.ts`

- [ ] `xToBin`, `brushPixelRange`, `brushZoneAt` (`left` / `right` / `inside` / `outside`),
      `slideBrush`, `resizeBrush`.
- [ ] Tests: zone detection including handle hit areas; slide clamps at both ends while
      preserving width; resize honours a minimum width, cannot cross the opposite edge, and
      clamps to bounds.

## Task 3: Map plot loses zoom, brush gains it

**Files:** modify `src/ui/ProfileChart.tsx`

- [ ] Remove the wheel handler and its `preventDefault` listener so the page scrolls.
- [ ] Remove plot drag-pan and pinch. Hover and tooltip stay.
- [ ] Brush: drag inside to slide, drag either handle to resize, double-click to reset,
      plus a small reset control. Visible handles. Pointer events so touch works.
- [ ] `touch-action` on the canvas must allow page scrolling again.

## Task 4: Verify

- [ ] Tests + build green, push, wait for deploy.
- [ ] Live: measure heatmap candle-span change for one wheel notch (expect 7–9%); assert the
      Map domain is unchanged by wheel and that the page scrolls; brush slide, resize and
      reset all work with tooltips and cumulative curves intact; touch-drag a handle.
- [ ] Screenshots: Map with a narrowed brush window, desktop + mobile.

## Self-review

Spec coverage: wheel curve → Task 1, axis feel → Task 1, brush-only Map → Tasks 2–3,
verification → Task 4. Heatmap behaviour is otherwise untouched, which is the stated
requirement. Types: `BrushZone` and the brush helpers are defined once in `brush.ts`.
