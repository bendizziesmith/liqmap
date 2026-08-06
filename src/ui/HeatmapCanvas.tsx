import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HeatmapData } from '../engine/types';
import { bucketToPrice, priceToBucket } from '../engine/grid';
import { computeVmax, normalizeScore } from '../engine/normalize';
import { alphaFor, inferno } from '../engine/colormap';

const AXIS_W = 62; // right-hand price gutter
const AXIS_H = 22; // bottom time gutter
const DEFAULT_COLS = 220;
/**
 * Price padding around the visible candles, as a fraction of their span. Kept tight: the
 * far tiers accumulate an unswept shelf near the grid edges, and opening on it would bury
 * the near-price structure that is actually tradeable. Zoom out to reach it.
 */
const FIT_PAD = 0.15;

interface View {
  c0: number;
  c1: number;
  p0: number;
  p1: number;
}

interface Props {
  map: HeatmapData | null;
  enabledTiers: boolean[];
  livePrice: number | null;
  interval: string;
}

interface Hover {
  x: number;
  y: number;
  price: number;
  col: number;
  scores: number[];
  time: number;
}

function fitView(map: HeatmapData): View {
  const c0 = Math.max(0, map.nCols - DEFAULT_COLS);
  const c1 = map.nCols;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = c0; i < c1; i++) {
    if (map.candles[i].low < lo) lo = map.candles[i].low;
    if (map.candles[i].high > hi) hi = map.candles[i].high;
  }
  if (!Number.isFinite(lo)) return { c0, c1, p0: map.grid.min, p1: map.grid.max };

  const pad = (hi - lo) * FIT_PAD || hi * 0.05;
  return {
    c0,
    c1,
    p0: Math.max(map.grid.min, lo - pad),
    p1: Math.min(map.grid.max, hi + pad),
  };
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function formatTime(ms: number, interval: string): string {
  const d = new Date(ms);
  const date = `${d.getDate()}/${d.getMonth() + 1}`;
  if (interval === '1d') return date;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

export function HeatmapCanvas({ map, enabledTiers, livePrice, interval }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rasterRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /**
   * Sum of the enabled tiers, cached.
   *
   * The paint loop touches every visible pixel, so folding four matrix reads into one here
   * — recomputed only when the map or the toggles change — is what keeps panning smooth.
   */
  const combined = useMemo(() => {
    if (!map) return null;
    const out = new Float32Array(map.nCols * map.grid.nBuckets);
    for (let t = 0; t < map.matrices.length; t++) {
      if (!enabledTiers[t]) continue;
      const src = map.matrices[t];
      for (let i = 0; i < out.length; i++) out[i] += src[i];
    }
    return out;
  }, [map, enabledTiers]);

  // Refit whenever a different dataset arrives.
  useEffect(() => {
    setView(map && map.nCols > 0 ? fitView(map) : null);
  }, [map]);

  /**
   * Track the element size so the canvas can match device pixels exactly.
   *
   * Three triggers, because ResizeObserver alone is not reliable enough: some environments
   * deliver only one entry before the final layout pass and never fire again, which leaves
   * the canvas permanently mis-sized. The rAF measure catches that, and the window listener
   * covers orientation changes on the phone build.
   */
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const w = Math.floor(width);
      const h = Math.floor(height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    measure();
    const raf = requestAnimationFrame(measure);

    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  const plot = useMemo(
    () => ({ x: 0, y: 0, w: Math.max(0, size.w - AXIS_W), h: Math.max(0, size.h - AXIS_H) }),
    [size],
  );

  const priceToY = useCallback(
    (price: number, v: View) => plot.h - ((price - v.p0) / (v.p1 - v.p0)) * plot.h,
    [plot.h],
  );
  const yToPrice = useCallback(
    (y: number, v: View) => v.p0 + ((plot.h - y) / plot.h) * (v.p1 - v.p0),
    [plot.h],
  );

  // ---- paint -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map || !view || !combined || plot.w <= 0 || plot.h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const { grid, nCols } = map;
    const c0 = Math.max(0, Math.floor(view.c0));
    const c1 = Math.min(nCols, Math.ceil(view.c1));
    const b0 = priceToBucket(grid, view.p0);
    const b1 = priceToBucket(grid, view.p1);
    const cols = Math.max(1, c1 - c0);
    const rows = Math.max(1, b1 - b0 + 1);

    const vmax = computeVmax(map.matrices, enabledTiers, grid.nBuckets, c0, c1, b0, b1 + 1);

    // Native-resolution raster, upscaled with smoothing off so buckets stay crisp squares.
    let raster = rasterRef.current;
    if (!raster) {
      raster = document.createElement('canvas');
      rasterRef.current = raster;
    }
    raster.width = cols;
    raster.height = rows;
    const rctx = raster.getContext('2d');
    if (!rctx) return;

    const img = rctx.createImageData(cols, rows);
    const px = img.data;
    for (let c = c0; c < c1; c++) {
      const offset = c * grid.nBuckets;
      const cx = c - c0;
      for (let b = b0; b <= b1; b++) {
        const x = normalizeScore(combined[offset + b], vmax);
        const [r, g, bl] = inferno(x);
        // Bucket 0 is the lowest price, but image row 0 is the top of the screen.
        const i = ((b1 - b) * cols + cx) * 4;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = bl;
        px[i + 3] = alphaFor(x);
      }
    }
    rctx.putImageData(img, 0, 0);

    // Align the blit to the exact price/time window the raster covers.
    const topPrice = bucketToPrice(grid, b1) + grid.step / 2;
    const botPrice = bucketToPrice(grid, b0) - grid.step / 2;
    const yTop = priceToY(topPrice, view);
    const yBot = priceToY(botPrice, view);
    const colW = plot.w / (view.c1 - view.c0);
    const xLeft = (c0 - view.c0) * colW;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(raster, xLeft, yTop, cols * colW, yBot - yTop);

    // ---- candles ----
    const bodyW = Math.max(1, Math.min(colW * 0.62, 14));
    ctx.lineWidth = 1;
    for (let c = c0; c < c1; c++) {
      const k = map.candles[c];
      const cx = (c - view.c0 + 0.5) * colW;
      if (cx < -colW || cx > plot.w + colW) continue;

      const up = k.close >= k.open;
      const stroke = up ? 'rgba(94,234,212,0.85)' : 'rgba(248,113,113,0.85)';
      ctx.strokeStyle = stroke;
      ctx.fillStyle = up ? 'rgba(94,234,212,0.30)' : 'rgba(248,113,113,0.30)';

      const yH = priceToY(k.high, view);
      const yL = priceToY(k.low, view);
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, yH);
      ctx.lineTo(Math.round(cx) + 0.5, yL);
      ctx.stroke();

      if (colW >= 3) {
        const yO = priceToY(k.open, view);
        const yC = priceToY(k.close, view);
        const top = Math.min(yO, yC);
        const h = Math.max(1, Math.abs(yC - yO));
        ctx.fillRect(cx - bodyW / 2, top, bodyW, h);
        ctx.strokeRect(cx - bodyW / 2, top, bodyW, h);
      }
    }

    // ---- live price ----
    if (livePrice != null && livePrice >= view.p0 && livePrice <= view.p1) {
      const y = priceToY(livePrice, view);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(plot.w, y + 0.5);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(plot.w, y - 9, AXIS_W, 18);
      ctx.fillStyle = '#07070b';
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatPrice(livePrice), plot.w + 6, y);
    }

    // ---- price axis ----
    ctx.fillStyle = 'rgba(148,163,184,0.9)';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const ticks = Math.max(2, Math.min(10, Math.floor(plot.h / 46)));
    for (let i = 0; i <= ticks; i++) {
      const price = view.p0 + ((view.p1 - view.p0) * i) / ticks;
      const y = priceToY(price, view);
      if (livePrice != null && Math.abs(y - priceToY(livePrice, view)) < 12) continue;
      ctx.fillText(formatPrice(price), plot.w + 6, y);
      ctx.strokeStyle = 'rgba(148,163,184,0.10)';
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(plot.w, y + 0.5);
      ctx.stroke();
    }

    // ---- time axis ----
    ctx.textBaseline = 'top';
    const tTicks = Math.max(2, Math.min(8, Math.floor(plot.w / 110)));
    for (let i = 0; i <= tTicks; i++) {
      const col = Math.floor(view.c0 + ((view.c1 - view.c0) * i) / tTicks);
      const k = map.candles[Math.max(0, Math.min(nCols - 1, col))];
      if (!k) continue;
      const x = (col - view.c0) * colW;
      const label = formatTime(k.start, interval);
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(148,163,184,0.9)';
      ctx.fillText(label, Math.min(Math.max(0, x - w / 2), plot.w - w), plot.h + 6);
    }

    // ---- crosshair ----
    if (hover) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(245,158,11,0.75)';
      ctx.beginPath();
      ctx.moveTo(hover.x + 0.5, 0);
      ctx.lineTo(hover.x + 0.5, plot.h);
      ctx.moveTo(0, hover.y + 0.5);
      ctx.lineTo(plot.w, hover.y + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }, [map, view, combined, enabledTiers, livePrice, size, plot, hover, priceToY, interval]);

  // ---- interaction -------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const pinchRef = useRef<{ dx: number; dy: number; view: View } | null>(null);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!view || !map) return;
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

      setView((v) => {
        if (!v) return v;
        // Modifier zooms price; the bare wheel zooms time, which is the common case.
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          const anchor = yToPrice(my, v);
          const p0 = anchor - (anchor - v.p0) * factor;
          const p1 = anchor + (v.p1 - anchor) * factor;
          return { ...v, p0, p1 };
        }
        const anchorCol = v.c0 + (mx / plot.w) * (v.c1 - v.c0);
        let c0 = anchorCol - (anchorCol - v.c0) * factor;
        let c1 = anchorCol + (v.c1 - anchorCol) * factor;
        if (c1 - c0 < 8) return v;
        c0 = Math.max(-map.nCols * 0.1, c0);
        c1 = Math.min(map.nCols * 1.1, c1);
        return { ...v, c0, c1 };
      });
    },
    [view, map, plot.w, yToPrice],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!view) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      pointers.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      canvasRef.current?.setPointerCapture(e.pointerId);

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinchRef.current = {
          dx: Math.max(1, Math.abs(a.x - b.x)),
          dy: Math.max(1, Math.abs(a.y - b.y)),
          view,
        };
        dragRef.current = null;
      } else {
        dragRef.current = { x: e.clientX, y: e.clientY, view };
      }
    },
    [view],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !map || !view || !combined) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: mx, y: my });
      }

      // Two fingers: independent time and price scaling.
      if (pointers.current.size === 2 && pinchRef.current) {
        const [a, b] = [...pointers.current.values()];
        const start = pinchRef.current;
        const sx = start.dx / Math.max(1, Math.abs(a.x - b.x));
        const sy = start.dy / Math.max(1, Math.abs(a.y - b.y));
        const midCol = (start.view.c0 + start.view.c1) / 2;
        const midPrice = (start.view.p0 + start.view.p1) / 2;
        const halfC = ((start.view.c1 - start.view.c0) / 2) * sx;
        const halfP = ((start.view.p1 - start.view.p0) / 2) * sy;
        if (halfC > 4) {
          setView({
            c0: midCol - halfC,
            c1: midCol + halfC,
            p0: midPrice - halfP,
            p1: midPrice + halfP,
          });
        }
        return;
      }

      if (dragRef.current) {
        const d = dragRef.current;
        const colW = plot.w / (d.view.c1 - d.view.c0);
        const dCols = (e.clientX - d.x) / colW;
        const dPrice = ((e.clientY - d.y) / plot.h) * (d.view.p1 - d.view.p0);
        setView({
          c0: d.view.c0 - dCols,
          c1: d.view.c1 - dCols,
          p0: d.view.p0 + dPrice,
          p1: d.view.p1 + dPrice,
        });
        setHover(null);
        return;
      }

      if (mx > plot.w || my > plot.h) {
        setHover(null);
        return;
      }

      const colW = plot.w / (view.c1 - view.c0);
      const col = Math.floor(view.c0 + mx / colW);
      if (col < 0 || col >= map.nCols) {
        setHover(null);
        return;
      }
      const price = yToPrice(my, view);
      const bucket = priceToBucket(map.grid, price);
      const scores = map.matrices.map((m) => m[col * map.grid.nBuckets + bucket]);

      setHover({ x: mx, y: my, price, col, scores, time: map.candles[col].start });
    },
    [map, view, combined, plot, yToPrice],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) dragRef.current = null;
  }, []);

  const refit = useCallback(() => {
    if (map && map.nCols > 0) setView(fitView(map));
  }, [map]);

  // React attaches wheel passively, which forbids preventDefault. Bind it directly.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const hoverTotal = hover ? hover.scores.reduce((a, s, i) => a + (enabledTiers[i] ? s : 0), 0) : 0;

  return (
    <div className="chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="chart__canvas"
        style={{ width: size.w, height: size.h }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={refit}
      />

      {!map && <div className="chart__empty">Loading market data…</div>}
      {map && map.nCols === 0 && <div className="chart__empty">No candles for this symbol.</div>}

      {hover && map && (
        <div
          className="tip"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, plot.w - 190)),
            top: Math.min(hover.y + 14, Math.max(0, plot.h - 150)),
          }}
        >
          <div className="tip__row tip__row--head">
            <span>{formatTime(hover.time, interval)}</span>
            <strong>{formatPrice(hover.price)}</strong>
          </div>
          {map.tiers.map((t, i) => (
            <div className="tip__row" key={t} data-off={!enabledTiers[i]}>
              <span>{t}×</span>
              <span>{hover.scores[i] > 0 ? hover.scores[i].toFixed(2) : '—'}</span>
            </div>
          ))}
          <div className="tip__row tip__row--total">
            <span>total</span>
            <strong>{hoverTotal > 0 ? hoverTotal.toFixed(2) : '—'}</strong>
          </div>
          <div className="tip__note">relative score, not USD</div>
        </div>
      )}

      <button className="chart__refit" onClick={refit} type="button">
        Refit
      </button>
    </div>
  );
}
