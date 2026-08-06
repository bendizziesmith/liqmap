import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiquidationProfile, ProfileBin } from '../engine/profile';
import { TIER_COLORS } from '../engine/colormap';

const AXIS_H = 20; // price labels under the plot
const AXIS_W = 46; // cumulative labels on the right
const BRUSH_H = 26; // mini overview strip
const BRUSH_GAP = 6;

interface Props {
  title: string;
  subtitle: string;
  profile: LiquidationProfile | null;
  loading: boolean;
  error: string | null;
  onExport: () => void;
}

interface Hover {
  x: number;
  y: number;
  bin: ProfileBin;
  index: number;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(3);
  if (p >= 0.01) return p.toFixed(5);
  return p.toFixed(7);
}

export function ProfileChart({ title, subtitle, profile, loading, error, onExport }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  /** Visible slice of the bin array: [i0, i1). Zoom and pan act on the price axis. */
  const [range, setRange] = useState<[number, number] | null>(null);
  const dragRef = useRef<{ x: number; range: [number, number] } | null>(null);

  const nBins = profile?.bins.length ?? 0;

  useEffect(() => {
    // Open on a window around current price rather than the whole grid: the far tiers pile
    // up unswept mass at the edges that would flatten everything near price.
    if (!profile || nBins === 0) {
      setRange(null);
      return;
    }
    const span = Math.max(20, Math.round(nBins * 0.34));
    const i0 = Math.max(0, profile.priceBinIndex - Math.round(span / 2));
    setRange([i0, Math.min(nBins, i0 + span)]);
  }, [profile, nBins]);

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
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const plot = useMemo(
    () => ({
      w: Math.max(0, size.w - AXIS_W),
      h: Math.max(0, size.h - AXIS_H - BRUSH_H - BRUSH_GAP),
    }),
    [size],
  );

  /** Peak bar height and cumulative within the visible slice, so zooming reveals detail. */
  const visibleMax = useMemo(() => {
    if (!profile || !range) return { total: 0, cum: 0 };
    let total = 0;
    let cum = 0;
    for (let i = range[0]; i < range[1]; i++) {
      const b = profile.bins[i];
      if (!b) continue;
      if (b.total > total) total = b.total;
      const c = Math.max(b.cumLong, b.cumShort);
      if (c > cum) cum = c;
    }
    return { total, cum };
  }, [profile, range]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !profile || !range || plot.w <= 0 || plot.h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const [i0, i1] = range;
    const count = Math.max(1, i1 - i0);
    const barW = plot.w / count;
    const xOf = (i: number) => (i - i0) * barW;
    const yOfTotal = (v: number) =>
      visibleMax.total > 0 ? plot.h - (v / visibleMax.total) * plot.h : plot.h;
    const yOfCum = (v: number) =>
      visibleMax.cum > 0 ? plot.h - (v / visibleMax.cum) * plot.h : plot.h;

    // ---- horizontal guides ----
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    for (let g = 1; g <= 4; g++) {
      const y = (plot.h * g) / 5;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(plot.w, y + 0.5);
      ctx.stroke();
    }

    // ---- cumulative shading, outward from price in each direction ----
    const drawCum = (from: number, to: number, pick: (b: ProfileBin) => number, tint: string) => {
      ctx.beginPath();
      ctx.moveTo(xOf(from) + barW / 2, plot.h);
      for (let i = from; from < to ? i < to : i > to; i += from < to ? 1 : -1) {
        const b = profile.bins[i];
        if (!b) continue;
        ctx.lineTo(xOf(i) + barW / 2, yOfCum(pick(b)));
      }
      ctx.lineTo(xOf(to) + barW / 2, plot.h);
      ctx.closePath();
      ctx.fillStyle = tint;
      ctx.fill();
    };

    const pi = profile.priceBinIndex;
    if (pi > i0) drawCum(Math.min(pi, i1 - 1), i0, (b) => b.cumLong, 'rgba(248,113,113,0.13)');
    if (pi < i1 - 1) drawCum(Math.max(pi, i0), i1 - 1, (b) => b.cumShort, 'rgba(94,234,212,0.13)');

    // ---- stacked bars ----
    const gap = barW > 3 ? 1 : 0;
    for (let i = i0; i < i1; i++) {
      const b = profile.bins[i];
      if (!b || b.total <= 0) continue;
      let y = plot.h;
      for (let t = 0; t < b.tiers.length; t++) {
        const v = b.tiers[t];
        if (v <= 0) continue;
        const h = plot.h - yOfTotal(v);
        ctx.fillStyle = TIER_COLORS[t] ?? TIER_COLORS[TIER_COLORS.length - 1];
        ctx.fillRect(xOf(i), y - h, Math.max(1, barW - gap), h);
        y -= h;
      }
    }

    // ---- cumulative lines on top ----
    const drawLine = (from: number, to: number, pick: (b: ProfileBin) => number, stroke: string) => {
      ctx.beginPath();
      let started = false;
      for (let i = from; from < to ? i <= to : i >= to; i += from < to ? 1 : -1) {
        const b = profile.bins[i];
        if (!b) continue;
        const x = xOf(i) + barW / 2;
        const y = yOfCum(pick(b));
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    if (pi > i0) drawLine(Math.min(pi, i1 - 1), i0, (b) => b.cumLong, 'rgba(248,113,113,0.85)');
    if (pi < i1 - 1) drawLine(Math.max(pi, i0), i1 - 1, (b) => b.cumShort, 'rgba(94,234,212,0.85)');

    // ---- current price marker ----
    if (pi >= i0 && pi < i1) {
      const x = xOf(pi) + barW / 2;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, plot.h);
      ctx.stroke();
      ctx.restore();

      const label = formatPrice(profile.currentPrice);
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      const w = ctx.measureText(label).width + 10;
      const lx = Math.min(Math.max(0, x - w / 2), plot.w - w);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(lx, 0, w, 15);
      ctx.fillStyle = '#07070b';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 5, 8);
    }

    // ---- axes ----
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const v = (visibleMax.cum * g) / 4;
      // Clamp the baseline: the top tick sits at y=0 and would be sliced in half.
      const y = Math.min(plot.h - 6, Math.max(6, yOfCum(v)));
      ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0), plot.w + 5, y);
    }

    ctx.textBaseline = 'top';
    const pTicks = Math.max(2, Math.min(7, Math.floor(plot.w / 90)));
    for (let g = 0; g <= pTicks; g++) {
      const i = Math.min(i1 - 1, i0 + Math.round(((i1 - 1 - i0) * g) / pTicks));
      const b = profile.bins[i];
      if (!b) continue;
      const label = formatPrice(b.priceMid);
      const w = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(Math.max(0, xOf(i) - w / 2), plot.w - w), plot.h + 5);
    }

    // ---- brush: whole range, with the visible window highlighted ----
    const by = plot.h + AXIS_H + BRUSH_GAP;
    ctx.fillStyle = 'rgba(20,24,34,0.9)';
    ctx.fillRect(0, by, plot.w, BRUSH_H);

    const allMax = profile.maxTotal || 1;
    for (let i = 0; i < nBins; i++) {
      const b = profile.bins[i];
      if (!b || b.total <= 0) continue;
      const x = (i / nBins) * plot.w;
      const h = (b.total / allMax) * (BRUSH_H - 2);
      ctx.fillStyle = 'rgba(245,158,11,0.55)';
      ctx.fillRect(x, by + BRUSH_H - h, Math.max(1, plot.w / nBins), h);
    }

    const bx0 = (i0 / nBins) * plot.w;
    const bx1 = (i1 / nBins) * plot.w;
    ctx.fillStyle = 'rgba(7,7,11,0.55)';
    ctx.fillRect(0, by, bx0, BRUSH_H);
    ctx.fillRect(bx1, by, plot.w - bx1, BRUSH_H);
    ctx.strokeStyle = 'rgba(245,158,11,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx0 + 0.5, by + 0.5, Math.max(2, bx1 - bx0 - 1), BRUSH_H - 1);

    // ---- crosshair ----
    if (hover) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(245,158,11,0.7)';
      ctx.beginPath();
      ctx.moveTo(hover.x + 0.5, 0);
      ctx.lineTo(hover.x + 0.5, plot.h);
      ctx.stroke();
      ctx.restore();
    }
  }, [profile, range, plot, size, visibleMax, hover, nBins]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!range || nBins === 0) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;

      setRange((prev) => {
        if (!prev) return prev;
        const [i0, i1] = prev;
        const anchor = i0 + (mx / Math.max(1, plot.w)) * (i1 - i0);
        let n0 = anchor - (anchor - i0) * factor;
        let n1 = anchor + (i1 - anchor) * factor;
        if (n1 - n0 < 6) return prev;
        n0 = Math.max(0, n0);
        n1 = Math.min(nBins, n1);
        return [Math.round(n0), Math.round(n1)];
      });
    },
    [range, nBins, plot.w],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!range) return;
      canvasRef.current?.setPointerCapture(e.pointerId);
      dragRef.current = { x: e.clientX, range };
    },
    [range],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !profile || !range) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (dragRef.current) {
        const d = dragRef.current;
        const [s0, s1] = d.range;
        const perPx = (s1 - s0) / Math.max(1, plot.w);
        const shift = Math.round((e.clientX - d.x) * perPx);
        let n0 = s0 - shift;
        let n1 = s1 - shift;
        if (n0 < 0) {
          n1 -= n0;
          n0 = 0;
        }
        if (n1 > nBins) {
          n0 -= n1 - nBins;
          n1 = nBins;
        }
        setRange([Math.max(0, n0), Math.min(nBins, n1)]);
        setHover(null);
        return;
      }

      if (mx < 0 || mx > plot.w || my < 0 || my > plot.h) {
        setHover(null);
        return;
      }
      const [i0, i1] = range;
      const idx = Math.floor(i0 + (mx / Math.max(1, plot.w)) * (i1 - i0));
      const bin = profile.bins[idx];
      if (!bin) {
        setHover(null);
        return;
      }
      setHover({ x: mx, y: my, bin, index: idx });
    },
    [profile, range, plot, nBins],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const hoverSide =
    hover && profile
      ? hover.index < profile.priceBinIndex
        ? 'long'
        : hover.index > profile.priceBinIndex
          ? 'short'
          : 'at price'
      : null;

  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">{title}</h2>
          <p className="panel__sub">{subtitle}</p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onExport}
          disabled={!profile}
        >
          Export CSV
        </button>
      </header>

      <div className="panel__body" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="panel__canvas"
          style={{ width: size.w, height: size.h }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={() => setHover(null)}
        />

        {loading && <div className="panel__empty">Loading…</div>}
        {error && <div className="panel__empty panel__empty--err">{error}</div>}
        {!loading && !error && profile && profile.maxTotal === 0 && (
          <div className="panel__empty">No active levels for this symbol.</div>
        )}

        {hover && profile && (
          <div
            className="tip"
            style={{
              left: Math.min(hover.x + 14, Math.max(0, plot.w - 200)),
              top: Math.min(hover.y + 14, Math.max(0, plot.h - 140)),
            }}
          >
            <div className="tip__row tip__row--head">
              <span>
                {formatPrice(hover.bin.priceFrom)}–{formatPrice(hover.bin.priceTo)}
              </span>
              <strong data-side={hoverSide ?? undefined}>{hoverSide}</strong>
            </div>
            {profile.tiers.map((t, i) => (
              <div className="tip__row" key={t}>
                <span>
                  <i className="tip__swatch" style={{ background: TIER_COLORS[i] }} />
                  {t}×
                </span>
                <span>{hover.bin.tiers[i] > 0 ? hover.bin.tiers[i].toFixed(2) : '—'}</span>
              </div>
            ))}
            <div className="tip__row tip__row--total">
              <span>total</span>
              <strong>{hover.bin.total > 0 ? hover.bin.total.toFixed(2) : '—'}</strong>
            </div>
            <div className="tip__row">
              <span>cumulative</span>
              <span>
                {Math.max(hover.bin.cumLong, hover.bin.cumShort).toFixed(1)}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
