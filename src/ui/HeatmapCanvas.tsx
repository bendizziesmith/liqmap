import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HeatmapData } from '../engine/types';
import { bucketToPrice, priceToBucket } from '../engine/grid';
import { normalizeScore } from '../engine/normalize';
import { COLORMAPS, classAlpha, classBreaks, classOf, type ColormapId } from '../engine/classes';
import { lastColumn } from '../engine/profile';
import { buildPanelProfile } from '../engine/panelProfile';
import { formatUsd, formatUsdPrecise } from '../engine/usd';
import type { PriceFormatter } from './hooks/usePriceFormat';
import { priceToY, yToPrice } from './scale';
import { axisZoomFactor, scaleAbout } from './axis';
import { capturePointer, releasePointer } from './gesture';

const AXIS_W = 62; // right-hand price gutter
const AXIS_H = 22; // bottom time gutter
const PROFILE_W = 90; // right-docked liquidation profile strip
const DEFAULT_COLS = 220;
/**
 * Price padding around the visible candles, as a fraction of their span. Kept tight: the
 * far tiers accumulate an unswept shelf near the grid edges, and opening on it would bury
 * the near-price structure that is actually tradeable. Zoom out to reach it.
 */
const FIT_PAD = 0.15;

/** Cumulative curve colours: longs below price, shorts above. Shared with the Map view. */
export const LONG_COLOR = '#4ade80';
export const SHORT_COLOR = '#f59e0b';

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
  showProfile: boolean;
  formatPrice: PriceFormatter;
  colormapId: ColormapId;
}

type Region = 'plot' | 'priceAxis' | 'timeAxis' | 'panel';

interface Hover {
  x: number;
  y: number;
  region: Region;
  price: number;
  col: number;
  scores: number[];
  time: number;
  row: number;
}

function fitPrice(map: HeatmapData, c0: number, c1: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, Math.floor(c0)); i < Math.min(map.nCols, Math.ceil(c1)); i++) {
    if (map.candles[i].low < lo) lo = map.candles[i].low;
    if (map.candles[i].high > hi) hi = map.candles[i].high;
  }
  if (!Number.isFinite(lo)) return [map.grid.min, map.grid.max];
  const pad = (hi - lo) * FIT_PAD || hi * 0.05;
  return [Math.max(map.grid.min, lo - pad), Math.min(map.grid.max, hi + pad)];
}

function fitView(map: HeatmapData): View {
  const c0 = Math.max(0, map.nCols - DEFAULT_COLS);
  const c1 = map.nCols;
  const [p0, p1] = fitPrice(map, c0, c1);
  return { c0, c1, p0, p1 };
}

function formatTime(ms: number, interval: string): string {
  const d = new Date(ms);
  const date = `${d.getDate()}/${d.getMonth() + 1}`;
  if (interval === '1d') return date;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mm}`;
}

export function HeatmapCanvas({
  map,
  enabledTiers,
  livePrice,
  interval,
  showProfile,
  formatPrice,
  colormapId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rasterRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState('crosshair');
  const [breaksForLegend, setBreaksForLegend] = useState<number[]>([]);

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

  /** Active levels as of the latest candle — the same data the Map view profiles. */
  const active = useMemo(() => (map && map.nCols > 0 ? lastColumn(map) : null), [map]);

  useEffect(() => {
    setView(map && map.nCols > 0 ? fitView(map) : null);
    // Refit only when a different symbol/interval arrives, not on every live re-seed.
  }, [map?.grid.min, map?.grid.max, map?.nCols]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const profileW = showProfile ? PROFILE_W : 0;
  const plot = useMemo(
    () => ({
      w: Math.max(0, size.w - AXIS_W - profileW),
      h: Math.max(0, size.h - AXIS_H),
    }),
    [size, profileW],
  );
  const profileX = plot.w;
  const axisX = plot.w + profileW;

  /** Per-screen-row profile: bar mass, cumulative curves and hot-pocket threshold. */
  const panel = useMemo(() => {
    if (!showProfile || !active || !map || !view || plot.h <= 0) return null;
    return buildPanelProfile(
      active,
      enabledTiers,
      map.grid,
      view.p0,
      view.p1,
      plot.h,
      livePrice,
    );
  }, [showProfile, active, map, view, plot.h, enabledTiers, livePrice]);

  const regionAt = useCallback(
    (mx: number, my: number): Region => {
      if (my > plot.h) return 'timeAxis';
      if (mx > axisX) return 'priceAxis';
      if (showProfile && mx > profileX) return 'panel';
      return 'plot';
    },
    [plot.h, axisX, profileX, showProfile],
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
    const toY = (price: number) => priceToY(price, view.p0, view.p1, plot.h);

    const c0 = Math.max(0, Math.floor(view.c0));
    const c1 = Math.min(nCols, Math.ceil(view.c1));
    const b0 = priceToBucket(grid, view.p0);
    const b1 = priceToBucket(grid, view.p1);
    const cols = Math.max(1, c1 - c0);
    const rows = Math.max(1, b1 - b0 + 1);

    // Class breaks from the visible window, so zooming into a quiet region reveals its
    // structure rather than flattening it all into the faintest class.
    const visible: number[] = [];
    for (let c = c0; c < c1; c++) {
      const off = c * grid.nBuckets;
      for (let b = b0; b <= b1; b++) {
        const v = combined[off + b];
        if (v > 0) visible.push(v);
      }
    }
    const breaks = classBreaks(visible);
    setBreaksForLegend((prev) =>
      prev.length === breaks.length && prev.every((v, i) => v === breaks[i]) ? prev : breaks,
    );
    const ramp = COLORMAPS[colormapId] ?? COLORMAPS.inferno;

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
        const cls = classOf(combined[offset + b], breaks);
        const i = ((b1 - b) * cols + cx) * 4;
        if (cls < 0) {
          px[i + 3] = 0;
          continue;
        }
        const [r, g, bl] = ramp.classColors[cls];
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = bl;
        px[i + 3] = classAlpha(cls);
      }
    }
    rctx.putImageData(img, 0, 0);

    const topPrice = bucketToPrice(grid, b1) + grid.step / 2;
    const botPrice = bucketToPrice(grid, b0) - grid.step / 2;
    const colW = plot.w / (view.c1 - view.c0);
    const xLeft = (c0 - view.c0) * colW;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plot.w, plot.h);
    ctx.clip();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(raster, xLeft, toY(topPrice), cols * colW, toY(botPrice) - toY(topPrice));

    // ---- candles ----
    const bodyW = Math.max(1, Math.min(colW * 0.62, 14));
    ctx.lineWidth = 1;
    for (let c = c0; c < c1; c++) {
      const k = map.candles[c];
      const cx = (c - view.c0 + 0.5) * colW;
      if (cx < -colW || cx > plot.w + colW) continue;

      const up = k.close >= k.open;
      ctx.strokeStyle = up ? 'rgba(94,234,212,0.85)' : 'rgba(248,113,113,0.85)';
      ctx.fillStyle = up ? 'rgba(94,234,212,0.30)' : 'rgba(248,113,113,0.30)';

      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, toY(k.high));
      ctx.lineTo(Math.round(cx) + 0.5, toY(k.low));
      ctx.stroke();

      if (colW >= 3) {
        const yO = toY(k.open);
        const yC = toY(k.close);
        ctx.fillRect(cx - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
        ctx.strokeRect(cx - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
      }
    }
    ctx.restore();

    // ---- side profile ----
    // Bars anchor at the price axis and grow leftward into the chart, so their tips point
    // at the levels rather than away from them.
    if (showProfile && panel) {
      const usable = profileW - 4;

      ctx.fillStyle = 'rgba(13,15,22,0.55)';
      ctx.fillRect(profileX, 0, profileW, plot.h);

      if (panel.rowMax > 0) {
        for (let r = 0; r < panel.rows.length && r < plot.h; r++) {
          const row = panel.rows[r];
          if (row.total <= 0) continue;

          // Same 0.68 gamma as the heat colours; without it the unswept shelf at the grid
          // edge owns the scale and everything near price is a hairline.
          const barW = normalizeScore(row.total, panel.rowMax) * usable;
          const hot = classOf(row.total, breaks) === COLORMAPS.inferno.classColors.length - 1;

          let x = axisX;
          for (let t = 0; t < row.tiers.length; t++) {
            const v = row.tiers[t];
            if (v <= 0) continue;
            const w = (v / row.total) * barW;
            ctx.fillStyle = hot ? ramp.hot : ramp.tierColors[t] ?? ramp.tierColors[ramp.tierColors.length - 1];
            ctx.fillRect(x - w, r, w, 1);
            x -= w;
          }
        }
      }

      // ---- cumulative curves along the panel ----
      const rows = panel.rows;
      const maxCum = panel.maxCum;
      if (maxCum > 0) {
        const cumX = (v: number) => axisX - (v / maxCum) * usable;

        const curve = (
          from: number,
          to: number,
          pick: (r: (typeof rows)[number]) => number,
          stroke: string,
          fill: string,
        ) => {
          const step = from < to ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(axisX, from);
          for (let r = from; step > 0 ? r <= to : r >= to; r += step) {
            const row = rows[r];
            if (!row) continue;
            ctx.lineTo(cumX(pick(row)), r);
          }
          ctx.lineTo(axisX, to);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();

          ctx.beginPath();
          let started = false;
          for (let r = from; step > 0 ? r <= to : r >= to; r += step) {
            const row = rows[r];
            if (!row) continue;
            const x = cumX(pick(row));
            if (started) ctx.lineTo(x, r);
            else {
              ctx.moveTo(x, r);
              started = true;
            }
          }
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        };

        const lastRow = Math.min(rows.length - 1, Math.floor(plot.h) - 1);
        if (panel.priceRow > 0) {
          curve(panel.priceRow - 1, 0, (r) => r.cumShort, SHORT_COLOR, 'rgba(245,158,11,0.10)');
        }
        if (panel.priceRow < lastRow) {
          curve(panel.priceRow + 1, lastRow, (r) => r.cumLong, LONG_COLOR, 'rgba(74,222,128,0.10)');
        }
      }

      ctx.strokeStyle = 'rgba(148,163,184,0.18)';
      ctx.beginPath();
      ctx.moveTo(profileX + 0.5, 0);
      ctx.lineTo(profileX + 0.5, plot.h);
      ctx.stroke();
    }

    // ---- live price ----
    if (livePrice != null && livePrice >= view.p0 && livePrice <= view.p1) {
      const y = toY(livePrice);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(axisX, y + 0.5);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(axisX, y - 9, AXIS_W, 18);
      ctx.fillStyle = '#07070b';
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatPrice(livePrice), axisX + 6, y);
    }

    // ---- price axis ----
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    const ticks = Math.max(2, Math.min(10, Math.floor(plot.h / 46)));
    for (let i = 0; i <= ticks; i++) {
      const price = view.p0 + ((view.p1 - view.p0) * i) / ticks;
      const y = toY(price);
      if (livePrice != null && Math.abs(y - toY(livePrice)) < 12) continue;
      ctx.fillStyle = 'rgba(148,163,184,0.9)';
      ctx.fillText(formatPrice(price), axisX + 6, y);
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
    if (hover && hover.region !== 'timeAxis') {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(245,158,11,0.75)';
      ctx.beginPath();
      if (hover.region === 'plot') {
        ctx.moveTo(hover.x + 0.5, 0);
        ctx.lineTo(hover.x + 0.5, plot.h);
      }
      ctx.moveTo(0, hover.y + 0.5);
      ctx.lineTo(axisX, hover.y + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    map, view, combined, active, panel, enabledTiers, livePrice, size, plot, hover,
    interval, showProfile, profileW, profileX, axisX,
  ]);

  // ---- interaction -------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number; view: View; region: Region } | null>(null);
  const pinchRef = useRef<{ dx: number; dy: number; view: View } | null>(null);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!view || !map) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const region = regionAt(mx, my);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

      setView((v) => {
        if (!v) return v;
        // Over an axis the wheel zooms that axis alone; over the plot it keeps the old
        // behaviour of time-zoom, with a modifier for price.
        const priceOnly = region === 'priceAxis' || e.shiftKey || e.ctrlKey || e.metaKey;
        if (priceOnly) {
          const anchor = region === 'priceAxis' ? 0.5 : 1 - my / plot.h;
          const [p0, p1] = scaleAbout([v.p0, v.p1], factor, anchor);
          return { ...v, p0, p1 };
        }
        const anchor = region === 'timeAxis' ? 0.5 : mx / plot.w;
        const [c0, c1] = scaleAbout([v.c0, v.c1], factor, anchor);
        if (c1 - c0 < 8) return v;
        return { ...v, c0: Math.max(-map.nCols * 0.1, c0), c1: Math.min(map.nCols * 1.1, c1) };
      });
    },
    [view, map, plot.w, plot.h, regionAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!view) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      pointers.current.set(e.pointerId, { x: mx, y: my });
      capturePointer(canvasRef.current, e.pointerId);

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinchRef.current = {
          dx: Math.max(1, Math.abs(a.x - b.x)),
          dy: Math.max(1, Math.abs(a.y - b.y)),
          view,
        };
        dragRef.current = null;
      } else {
        dragRef.current = { x: e.clientX, y: e.clientY, view, region: regionAt(mx, my) };
      }
    },
    [view, regionAt],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !map || !view) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: mx, y: my });
      }

      if (pointers.current.size === 2 && pinchRef.current) {
        const [a, b] = [...pointers.current.values()];
        const start = pinchRef.current;
        const sx = start.dx / Math.max(1, Math.abs(a.x - b.x));
        const sy = start.dy / Math.max(1, Math.abs(a.y - b.y));
        const [c0, c1] = scaleAbout([start.view.c0, start.view.c1], sx, 0.5);
        const [p0, p1] = scaleAbout([start.view.p0, start.view.p1], sy, 0.5);
        if (c1 - c0 > 8) setView({ c0, c1, p0, p1 });
        return;
      }

      const d = dragRef.current;
      if (d) {
        // Dragging an axis zooms it about its centre. Up zooms in on price, matching
        // TradingView; left/right does the same for time.
        if (d.region === 'priceAxis') {
          const [p0, p1] = scaleAbout(
            [d.view.p0, d.view.p1],
            axisZoomFactor(e.clientY - d.y),
            0.5,
          );
          setView({ ...d.view, p0, p1 });
          setHover(null);
          return;
        }
        if (d.region === 'timeAxis') {
          const [c0, c1] = scaleAbout(
            [d.view.c0, d.view.c1],
            axisZoomFactor(d.x - e.clientX),
            0.5,
          );
          if (c1 - c0 > 8) setView({ ...d.view, c0, c1 });
          setHover(null);
          return;
        }

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

      const region = regionAt(mx, my);
      setCursor(
        region === 'priceAxis' ? 'ns-resize' : region === 'timeAxis' ? 'ew-resize' : 'crosshair',
      );

      if (region === 'timeAxis' || region === 'priceAxis') {
        setHover(null);
        return;
      }

      const price = yToPrice(my, view.p0, view.p1, plot.h);
      const bucket = priceToBucket(map.grid, price);
      const colW = plot.w / (view.c1 - view.c0);
      const col = Math.max(0, Math.min(map.nCols - 1, Math.floor(view.c0 + mx / colW)));
      const scores = map.matrices.map((m) => m[col * map.grid.nBuckets + bucket]);

      setHover({
        x: mx,
        y: my,
        region,
        price,
        col,
        scores,
        time: map.candles[col].start,
        row: Math.max(0, Math.min(Math.floor(my), (panel?.rows.length ?? 1) - 1)),
      });
    },
    [map, view, plot, regionAt, panel],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    releasePointer(canvasRef.current, e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) dragRef.current = null;
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!map || map.nCols === 0) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const region = regionAt(e.clientX - rect.left, e.clientY - rect.top);

      setView((v) => {
        if (!v) return fitView(map);
        // Double-clicking an axis refits that axis alone; the plot refits both.
        if (region === 'priceAxis') {
          const [p0, p1] = fitPrice(map, v.c0, v.c1);
          return { ...v, p0, p1 };
        }
        if (region === 'timeAxis') {
          const full = fitView(map);
          return { ...v, c0: full.c0, c1: full.c1 };
        }
        return fitView(map);
      });
    },
    [map, regionAt],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const ramp = COLORMAPS[colormapId] ?? COLORMAPS.inferno;
  const hoverTotal = hover ? hover.scores.reduce((a, s, i) => a + (enabledTiers[i] ? s : 0), 0) : 0;
  const panelRow = hover && panel ? panel.rows[hover.row] : null;

  return (
    <div className="chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="chart__canvas"
        style={{ width: size.w, height: size.h, cursor }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDoubleClick}
      />

      {!map && <div className="chart__empty">Loading market data…</div>}
      {map && map.nCols === 0 && <div className="chart__empty">No candles for this symbol.</div>}

      {hover && map && hover.region === 'panel' && panelRow && (
        <div
          className="tip"
          style={{
            left: Math.max(6, profileX - 210),
            top: Math.min(hover.y + 12, Math.max(0, plot.h - 175)),
          }}
        >
          <div className="tip__row tip__row--head">
            <span>price</span>
            <strong>{formatPrice(panelRow.price)}</strong>
          </div>
          {map.tiers.map((t, i) => (
            <div className="tip__row" key={t} data-off={!enabledTiers[i]}>
              <span>
                <i className="tip__swatch" style={{ background: ramp.tierColors[i] }} />
                {t}×
              </span>
              <span>{panelRow.tiers[i] > 0 ? formatUsdPrecise(panelRow.tiers[i]) : '—'}</span>
            </div>
          ))}
          <div className="tip__row tip__row--total">
            <span>total est.</span>
            <strong>{panelRow.total > 0 ? formatUsdPrecise(panelRow.total) : '—'}</strong>
          </div>
          <div className="tip__row">
            <span style={{ color: LONG_COLOR }}>cum. longs</span>
            <span>{panelRow.cumLong > 0 ? formatUsd(panelRow.cumLong) : '—'}</span>
          </div>
          <div className="tip__row">
            <span style={{ color: SHORT_COLOR }}>cum. shorts</span>
            <span>{panelRow.cumShort > 0 ? formatUsd(panelRow.cumShort) : '—'}</span>
          </div>
          <div className="tip__note">estimated USD, not exchange-reported</div>
        </div>
      )}

      {hover && map && hover.region === 'plot' && (
        <div
          className="tip"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, plot.w - 200)),
            top: Math.min(hover.y + 14, Math.max(0, plot.h - 150)),
          }}
        >
          <div className="tip__row tip__row--head">
            <span>{formatTime(hover.time, interval)}</span>
            <strong>{formatPrice(hover.price)}</strong>
          </div>
          {map.tiers.map((t, i) => (
            <div className="tip__row" key={t} data-off={!enabledTiers[i]}>
              <span>
                <i className="tip__swatch" style={{ background: ramp.tierColors[i] }} />
                {t}×
              </span>
              <span>{hover.scores[i] > 0 ? formatUsd(hover.scores[i]) : '—'}</span>
            </div>
          ))}
          <div className="tip__row tip__row--total">
            <span>total est.</span>
            <strong>{hoverTotal > 0 ? formatUsdPrecise(hoverTotal) : '—'}</strong>
          </div>
          <div className="tip__note">estimated USD, not exchange-reported</div>
        </div>
      )}

      {/* Intensity scale. Charts guidance is explicit that an intensity map needs a legend
          and must not lean on colour alone — this also makes the class breaks checkable. */}
      {map && breaksForLegend.length > 0 && (
        <div className="legend" aria-label="Intensity classes, estimated USD">
          <span className="legend__title">est. $ / level</span>
          {ramp.classColors.map((c, i) => (
            <span className="legend__item" key={i}>
              <i style={{ background: `rgb(${c[0]},${c[1]},${c[2]})`, opacity: classAlpha(i) / 255 }} />
              {i === 0 ? `< ${formatUsd(breaksForLegend[0])}` : `${formatUsd(breaksForLegend[i - 1])}+`}
            </span>
          ))}
        </div>
      )}

      <button className="chart__refit" onClick={() => map && setView(fitView(map))} type="button">
        Refit
      </button>
    </div>
  );
}
