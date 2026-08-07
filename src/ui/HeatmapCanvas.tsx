import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HeatmapData, Interval } from '../engine/types';
import { bucketToPrice, priceToBucket } from '../engine/grid';
import { normalizeScore } from '../engine/normalize';
import { COLORMAPS, aboveNoiseFloor, classAlpha, classBreaks, classOf, type ColormapId } from '../engine/classes';
import { lastColumn } from '../engine/profile';
import { needsOlder } from '../engine/history';
import { buildPanelProfile } from '../engine/panelProfile';
import { displayRows, rowOfBucket, sideSamples } from '../engine/rows';
import { bandTierTotals, filterBands, type VisibleBand } from '../engine/threshold';
import { formatUsd, formatUsdPrecise } from '../engine/usd';
import type { UsdScales } from '../engine/calibrate';
import type { PriceFormatter } from './hooks/usePriceFormat';
import { priceToY, yToPrice } from './scale';
import { axisZoomFactor, scaleAbout, wheelZoomFactor } from './axis';
import { timeTicks } from './timeAxis';
import { INTERVAL_MS } from '../engine/interval';
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

/**
 * Painted cells a side needs before it earns its own class scale.
 *
 * With price at the very edge of the view one side is a sliver, and drawing percentiles from
 * a handful of cells would make that sliver flash between classes on every tick.
 */
const MIN_SIDE_SAMPLES = 64;

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
  /** Per-side multipliers denominating displayed USD in open interest. */
  usdScale: UsdScales;
  /** Changes only when the dataset identity changes, so a backfill does not refit. */
  resetKey: string;
  onNeedOlder: () => void;
  loadingOlder: boolean;
  prependedCount: number;
  /** Hide pools below this est. USD. 0 shows everything. */
  minUsd: number;
  /** Live stats for the toolbar: slider ceiling, survivor count, per-tier visible totals. */
  onStats: (s: {
    /** Every non-empty pool on screen, ascending — the slider maps travel onto these. */
    sorted: number[];
    count: number;
    tiers: number[];
    total: number;
  }) => void;
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
  usdScale,
  resetKey,
  onNeedOlder,
  loadingOlder,
  prependedCount,
  minUsd,
  onStats,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rasterRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Scratch buffer for the aggregated rows, reused across paints.
   *
   * Allocating rows x cols of Float64 on every frame would churn tens of megabytes during a
   * drag, which this renderer has been bitten by before.
   */
  const aggRef = useRef<Float64Array | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState('crosshair');
  const [legend, setLegend] = useState<{ above: number[]; below: number[] } | null>(null);
  /**
   * The time ticks currently drawn, published for verification.
   *
   * Axis labels live in the canvas bitmap where nothing can read them back, so "the dates
   * land on real boundaries and stay put across a pan" is otherwise only checkable by eye.
   * Same hook the Map's brush window uses.
   */
  const [tickDebug, setTickDebug] = useState('');
  const mapRef = useRef(map);
  mapRef.current = map;

  /** Active levels as of the latest candle — the same data the Map view profiles. */
  const active = useMemo(() => (map && map.nCols > 0 ? lastColumn(map) : null), [map]);

  useEffect(() => {
    // Keyed on dataset identity: a live re-seed or a history prepend must not refit.
    const m = mapRef.current;
    setView(m && m.nCols > 0 ? fitView(m) : null);
    viewNCols.current = m?.nCols ?? 0;
  }, [resetKey]);

  // First paint for a dataset that arrives after the reset key settled.
  useEffect(() => {
    if (!view && map && map.nCols > 0) {
      setView(fitView(map));
      viewNCols.current = map.nCols;
    }
  }, [map, view]);

  /**
   * Keep the view anchored when older candles are prepended.
   *
   * Every column index shifts right by the number added, so without this the chart would
   * jump backwards in time the moment a backfill landed.
   */
  const seenPrepend = useRef(0);
  /**
   * Column count the current view was reconciled against.
   *
   * `setView` is asynchronous, so on the render where a prepend lands the view still holds
   * pre-shift indices while the map already has the new columns. Requesting more history
   * from that intermediate state asks for a page that is already on its way, and a few of
   * those stacked together allocate the whole matrix set repeatedly.
   */
  const viewNCols = useRef(0);

  useEffect(() => {
    const delta = prependedCount - seenPrepend.current;
    seenPrepend.current = prependedCount;
    if (delta <= 0) return;
    setView((v) => (v ? { ...v, c0: v.c0 + delta, c1: v.c1 + delta } : v));
    viewNCols.current += delta;
  }, [prependedCount]);

  /**
   * Ask for more history once the view approaches the left edge.
   *
   * Held off until any previous prepend has been absorbed by the shift above. Without that
   * guard the render where `nCols` has grown but the view has not yet moved still looks
   * like "near the left edge", so a second page is requested immediately — and since each
   * rebuild allocates the whole matrix set, a few of those stacked together are enough to
   * exhaust the renderer.
   */
  useEffect(() => {
    if (!map || !view || loadingOlder) return;
    // Only act on a view that matches the map it is describing.
    if (viewNCols.current !== map.nCols) return;
    if (needsOlder(view.c0, map.nCols)) onNeedOlder();
  }, [map, view, loadingOlder, onNeedOlder]);

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

  /**
   * The display-row grid, shared by the heat raster and the side panel.
   *
   * Both have to agree: a bar that is 1px tall next to a band that is 4px tall reads as two
   * unrelated drawings of the same thing.
   */
  const rasterRows = useMemo(() => {
    if (!map || !view || plot.h <= 0) return 1;
    const b0 = priceToBucket(map.grid, view.p0);
    const b1 = priceToBucket(map.grid, view.p1);
    return displayRows(b1 - b0 + 1, plot.h);
  }, [map, view, plot.h]);

  /**
   * The one bucket-row-pixel mapping every surface shares.
   *
   * The raster blit scales its rows uniformly across the BUCKET price extent — which pokes
   * slightly past the view on both ends, because the edge buckets contain p0/p1 rather than
   * ending on them. Bars, curves, hover and tooltips must all use this same mapping: the
   * audit that motivated it found the panel binning rows by naive `y / (plot.h/rows)` while
   * the raster used the blit, so the two disagreed by up to a row and the same price read
   * different dollars on different surfaces.
   */
  const rowGeom = useMemo(() => {
    if (!map || !view || plot.h <= 0) return null;
    const { grid } = map;
    const b0 = priceToBucket(grid, view.p0);
    const b1 = priceToBucket(grid, view.p1);
    const topPrice = bucketToPrice(grid, b1) + grid.step / 2;
    const botPrice = bucketToPrice(grid, b0) - grid.step / 2;
    const yTop = priceToY(topPrice, view.p0, view.p1, plot.h);
    const yBot = priceToY(botPrice, view.p0, view.p1, plot.h);
    const span = yBot - yTop;
    /** Display row under a screen y, or -1 outside the painted bucket extent. */
    const rowAtY = (y: number): number => {
      const f = (y - yTop) / span;
      if (!(f >= 0) || f >= 1) return -1;
      return Math.min(rasterRows - 1, Math.floor(f * rasterRows));
    };
    /** Per-tier sums over the buckets a display row owns, in one column. */
    const rowTiers = (col: number, row: number): number[] => {
      const out = new Array<number>(map.matrices.length).fill(0);
      for (let b = b0; b <= b1; b++) {
        if (rowOfBucket(b, b0, b1, rasterRows) !== row) continue;
        for (let t = 0; t < map.matrices.length; t++) {
          out[t] += map.matrices[t][col * grid.nBuckets + b];
        }
      }
      return out;
    };
    return {
      b0, b1, yTop, yBot,
      rowAtY,
      rowTiers,
      rowTopY: (r: number) => yTop + (r / rasterRows) * span,
      rowMidY: (r: number) => yTop + ((r + 0.5) / rasterRows) * span,
      rowH: span / rasterRows,
    };
  }, [map, view, plot.h, rasterRows]);

  /** Per-display-row profile: bar mass, cumulative curves and hot-pocket threshold. */
  const panel = useMemo(() => {
    // Built whether or not the panel is drawn — it is the shared band series the threshold
    // filter, the slider ceiling and the per-tier totals all read.
    if (!active || !map || !view || plot.h <= 0) return null;
    return buildPanelProfile(
      active,
      enabledTiers,
      map.grid,
      view.p0,
      view.p1,
      rasterRows,
      livePrice,
    );
  }, [active, map, view, plot.h, rasterRows, enabledTiers, livePrice]);

  /**
   * The band series every surface reads: the current book's display rows, in est. USD.
   *
   * Rows below the price row are long liquidations, above are shorts, and the two sides are
   * anchored to open interest separately — so a band's USD depends on which side it sits on.
   */
  const bands = useMemo<VisibleBand[]>(() => {
    if (!panel) return [];
    return panel.rows.map((r, i) => {
      const scale = i > panel.priceRow ? usdScale.long : usdScale.short;
      const usd = r.total * scale;
      return { usd, total: usd, tiers: r.tiers.map((v) => v * scale) };
    });
  }, [panel, usdScale]);

  /**
   * The threshold as a RAW engine cutoff per side, snapshotted rather than live.
   *
   * The raster has to filter on raw matrix values, and converting the user's USD threshold
   * needs the OI scale — but that scale refreshes on a timer, and anything live-varying in
   * the paint re-grades history on a tick and breaks the intra-candle stability contract.
   * So the conversion is pinned to the dataset, exactly like the class ladder: it moves when
   * the user moves the slider or the dataset changes, never on a refresh.
   */
  const scaleSnapshot = useRef<UsdScales>({ long: 1, short: 1 });
  useEffect(() => {
    // Re-pin on dataset change, and once more when the real OI scale first arrives (it is
    // {1,1} until the ticker responds, which would otherwise pin a meaningless cutoff).
    scaleSnapshot.current = usdScale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, usdScale.long === 1 && usdScale.short === 1]);

  const minRaw = useMemo(() => {
    const s = scaleSnapshot.current;
    if (!(minUsd > 0)) return { long: 0, short: 0 };
    return {
      long: s.long > 0 ? minUsd / s.long : 0,
      short: s.short > 0 ? minUsd / s.short : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minUsd, resetKey]);

  // Publish what the toolbar needs: slider ceiling, survivor count, per-tier visible totals.
  const nTiers = map?.tiers.length ?? 0;
  useEffect(() => {
    const survivors = filterBands(bands, minUsd).filter((b) => b.total > 0);
    const totals = bandTierTotals(survivors, nTiers);
    onStats({
      sorted: bands.map((b) => b.usd).filter((v) => v > 0).sort((a, b) => a - b),
      count: survivors.length,
      tiers: totals.tiers,
      total: totals.total,
    });
  }, [bands, minUsd, nTiers, onStats, usdScale]);

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
    if (!canvas || !map || !view || plot.w <= 0 || plot.h <= 0) return;

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

    // Class breaks from the visible window, so zooming into a quiet region reveals its
    // structure rather than flattening it all into the faintest class.
    // Summed inline over the visible cells only. A whole-matrix cache would be ~22 MB at
    // the 5000-candle cap and would be rebuilt on every live tick, for values the paint
    // never reads.
    const valueAtCell = (col: number, bucket: number) => {
      let sum = 0;
      for (let t = 0; t < map.matrices.length; t++) {
        if (enabledTiers[t]) sum += map.matrices[t][col * grid.nBuckets + bucket];
      }
      return sum;
    };

    /*
     * Class breaks are computed per side of the book.
     *
     * One shared percentile ladder ranks every visible cell together, and whichever side
     * price happens to sit near occupies a far narrower band of buckets — so its levels are
     * denser per bucket and take the top classes, while the other side collapses into the
     * two faintest. Measured on XRPUSDT 1d, the above-price half held $28.16B against the
     * below-price half's $10.75B and still rendered with 3.9% hot cells against 49.2%: the
     * scale was hiding 2.6x more mass than it showed. Ranking each side against its own
     * distribution costs cross-side comparability — which the tooltip and the side panel
     * still give exactly — and buys back the structure of whichever half is quieter.
     */
    /*
     * The split — and everything else the ladder depends on — must hold still between
     * candle closes. The forming candle's OPEN is the newest price that cannot move until
     * the candle closes, so the raster's side split keys on it rather than on the live
     * tick: a tick that crosses a row boundary must move the price line, not re-grade
     * history around itself.
     */
    const splitPrice = nCols > 0 ? map.candles[nCols - 1].open : null;
    const priceBucket = splitPrice != null && splitPrice > 0 ? priceToBucket(grid, splitPrice) : -1;

    /*
     * Aggregate buckets into display rows before doing anything else.
     *
     * One source pixel per bucket meant the blit resampled: whenever the visible span
     * exceeded the plot height, nearest-neighbour sampling kept one bucket per output row
     * and threw the rest away, so bands flickered as you zoomed and what survived read as
     * aliasing debris. Each row now takes the SUM of the buckets it owns — every bucket
     * belongs to exactly one row, so the visible mass is conserved exactly and the
     * percentile ladder still describes what is painted. Zoom in and rows collapse back to
     * one bucket each, restoring the old 1:1 rendering on its own.
     */
    const need = rasterRows * cols;
    if (!aggRef.current || aggRef.current.length < need) aggRef.current = new Float64Array(need);
    const agg = aggRef.current;
    agg.fill(0, 0, need);

    for (let c = c0; c < c1; c++) {
      const cx = c - c0;
      for (let b = b0; b <= b1; b++) {
        const v = valueAtCell(c, b);
        if (v > 0) agg[rowOfBucket(b, b0, b1, rasterRows) * cols + cx] += v;
      }
    }

    /** Bucket at the middle of a display row, which decides the side it is judged on. */
    const centreBucket = (r: number) => b1 - Math.floor(((r + 0.5) * (b1 - b0 + 1)) / rasterRows);

    /*
     * Ladder samples EXCLUDE the forming column. Its values change on every websocket
     * reseed, and percentile breaks drawn from a drifting sample set flip any cell that
     * sits near a break — measured live as ~1,500 historical pixels recolouring inside one
     * candle. Excluded, the sample set between closes is bit-identical from tick to tick,
     * so the ladder recomputes exactly when its inputs change — candle close, symbol or
     * timeframe, zoom or pan, tier toggle — and never on a tick. The forming column still
     * paints, judged against the stable ladder.
     */
    const formingCx = c1 === nCols ? nCols - 1 - c0 : -1;

    /*
     * Verification hook: the shared per-row series for the latest column, published so the
     * live surface audit can assert that both tooltips and the raster derive from exactly
     * these numbers. Raw engine units; the audit multiplies by the published scales itself.
     */
    if (formingCx >= 0) {
      (window as unknown as Record<string, unknown>).__liqmapAudit = {
        rows: Array.from({ length: rasterRows }, (_, r) => agg[r * cols + formingCx]),
        rasterRows,
        priceBucket,
        b0,
        b1,
      };
    } else {
      (window as unknown as Record<string, unknown>).__liqmapAudit = null;
    }

    const { visible, above, below } = sideSamples(
      agg, rasterRows, cols, formingCx,
      (r) => (centreBucket(r) > priceBucket ? 'above' : 'below'),
    );

    // Too few samples on a side means price is at the edge of the window, where a per-side
    // scale would be drawn from a handful of cells. Fall back to one ladder for both.
    const shared = classBreaks(visible);
    const split = priceBucket >= 0 && above.length >= MIN_SIDE_SAMPLES && below.length >= MIN_SIDE_SAMPLES;
    const breaksAbove = split ? classBreaks(above) : shared;
    const breaksBelow = split ? classBreaks(below) : shared;

    const sameLegend = (prev: typeof legend) =>
      prev != null &&
      prev.above.every((v, i) => v === breaksAbove[i]) &&
      prev.below.every((v, i) => v === breaksBelow[i]);
    setLegend((prev) => (sameLegend(prev) ? prev : { above: breaksAbove, below: breaksBelow }));

    const ramp = COLORMAPS[colormapId] ?? COLORMAPS.inferno;

    let raster = rasterRef.current;
    if (!raster) {
      raster = document.createElement('canvas');
      rasterRef.current = raster;
    }
    raster.width = cols;
    raster.height = rasterRows;
    const rctx = raster.getContext('2d');
    if (!rctx) return;

    const img = rctx.createImageData(cols, rasterRows);
    const px = img.data;
    for (let r = 0; r < rasterRows; r++) {
      const above = centreBucket(r) > priceBucket;
      const breaks = above ? breaksAbove : breaksBelow;
      // The minimum-pool threshold, in this side's raw engine units.
      const cut = above ? minRaw.short : minRaw.long;
      for (let cx = 0; cx < cols; cx++) {
        const v = agg[r * cols + cx];
        const i = (r * cols + cx) * 4;
        // Below the floor is left fully transparent rather than painted as dim speckle;
        // below the user's threshold it is not a pool worth showing at all.
        if (v < cut || !aboveNoiseFloor(v, breaks)) {
          px[i + 3] = 0;
          continue;
        }
        const cls = classOf(v, breaks);
        const [cr, cg, cb] = ramp.classColors[cls];
        px[i] = cr;
        px[i + 1] = cg;
        px[i + 2] = cb;
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

    /*
     * Never smooth the heat. Interpolation is not a preference here: measured on the live
     * chart it turned 57% of heat pixels into colours that are not in the palette, erased
     * every hard class edge in the plot, and spread five designed alpha steps across 199
     * values. A band whose edge is a multi-pixel gradient has no definite price, which is
     * why it also read as misalignment.
     */
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
        const lengths = panel.rows.map((r) => r.total);
        const lengthMax = panel.rowMax;

        for (let r = 0; r < panel.rows.length; r++) {
          const row = panel.rows[r];
          if (row.total <= 0) continue;
          // Same threshold the raster applies, in the same raw units and on the same side.
          if (row.total < (r < panel.priceRow ? minRaw.short : minRaw.long)) continue;

          // Same 0.68 gamma as the heat colours; without it the unswept shelf at the grid
          // edge owns the scale and everything near price is a hairline.
          const barW = normalizeScore(lengths[r], lengthMax) * usable;
          // Rows above the price row are higher prices, so they are judged on the short
          // side's scale — the same split the raster uses.
          const hot =
            classOf(row.total, r < panel.priceRow ? breaksAbove : breaksBelow) ===
            COLORMAPS.inferno.classColors.length - 1;

          // A bar sits exactly where the blit puts the same row, so the two line up.
          const y = rowGeom ? rowGeom.rowTopY(r) : r;
          const h = Math.max(1, rowGeom ? rowGeom.rowH : 1);

          let x = axisX;
          for (let t = 0; t < row.tiers.length; t++) {
            const v = row.tiers[t];
            if (v <= 0) continue;
            const w = (v / row.total) * barW;
            ctx.fillStyle = hot ? ramp.hot : ramp.tierColors[t] ?? ramp.tierColors[ramp.tierColors.length - 1];
            ctx.fillRect(x - w, y, w, h);
            x -= w;
          }
        }
      }

      // ---- cumulative curves along the panel ----
      const rows = panel.rows;
      const maxCum = panel.maxCum;
      if (maxCum > 0) {
        const cumX = (v: number) => axisX - (v / maxCum) * usable;

        // Rows are display rows, not pixels, so every y here goes through the shared
        // blit mapping — the same one the raster and the bars use.
        const yOfRow = (r: number) => (rowGeom ? rowGeom.rowMidY(r) : r + 0.5);

        const curve = (
          from: number,
          to: number,
          pick: (r: (typeof rows)[number]) => number,
          stroke: string,
          fill: string,
        ) => {
          const step = from < to ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(axisX, yOfRow(from));
          for (let r = from; step > 0 ? r <= to : r >= to; r += step) {
            const row = rows[r];
            if (!row) continue;
            ctx.lineTo(cumX(pick(row)), yOfRow(r));
          }
          ctx.lineTo(axisX, yOfRow(to));
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();

          ctx.beginPath();
          let started = false;
          for (let r = from; step > 0 ? r <= to : r >= to; r += step) {
            const row = rows[r];
            if (!row) continue;
            const x = cumX(pick(row));
            const y = yOfRow(r);
            if (started) ctx.lineTo(x, y);
            else {
              ctx.moveTo(x, y);
              started = true;
            }
          }
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        };

        const lastRow = rows.length - 1;
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
      // Skipping near the live price is about the LABEL colliding with the price tag in the
      // gutter — the gridline itself must not be tied to the tick, or every price move that
      // crosses the 12px threshold toggles a full-width row on and off (measured live as
      // ~1,400 changed pixels across two rows in one 15s window).
      const nearTag = livePrice != null && Math.abs(y - toY(livePrice)) < 12;
      if (!nearTag) {
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.fillText(formatPrice(price), axisX + 6, y);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.10)';
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(plot.w, y + 0.5);
      ctx.stroke();
    }

    // ---- time axis ----
    // Ticks come from the time domain and land on calendar boundaries, so a label is glued
    // to its date: panning slides them with the chart and a backfill prepend, which shifts
    // every column index, leaves them exactly where they were.
    ctx.textBaseline = 'top';
    const stepMs = INTERVAL_MS[interval as Interval] ?? 36e5;
    const timeAtCol = (col: number) => {
      const cs = map.candles;
      const i = Math.floor(col);
      if (i < 0) return cs[0].start + col * stepMs;
      if (i >= cs.length - 1) return cs[cs.length - 1].start + (col - (cs.length - 1)) * stepMs;
      return cs[i].start + (col - i) * (cs[i + 1].start - cs[i].start);
    };
    const colAtTime = (t: number) => {
      const cs = map.candles;
      if (t <= cs[0].start) return (t - cs[0].start) / stepMs;
      const last = cs.length - 1;
      if (t >= cs[last].start) return last + (t - cs[last].start) / stepMs;
      let lo = 0;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cs[mid].start <= t) lo = mid;
        else hi = mid;
      }
      const span = cs[hi].start - cs[lo].start || stepMs;
      return lo + (t - cs[lo].start) / span;
    };

    const timeTickList = timeTicks(timeAtCol(view.c0), timeAtCol(view.c1), plot.w);
    setTickDebug((prev) => {
      const next = timeTickList.map((t) => `${t.label}@${t.time}`).join('|');
      return prev === next ? prev : next;
    });

    for (const tick of timeTickList) {
      const x = (colAtTime(tick.time) - view.c0) * colW;
      if (x < 0 || x > plot.w) continue;

      if (tick.major) {
        ctx.strokeStyle = 'rgba(148,163,184,0.14)';
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, plot.h + 3);
        ctx.stroke();
      }

      const w = ctx.measureText(tick.label).width;
      ctx.fillStyle = tick.major ? 'rgba(226,232,240,0.95)' : 'rgba(148,163,184,0.85)';
      ctx.fillText(tick.label, Math.min(Math.max(0, x - w / 2), plot.w - w), plot.h + 6);
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
    map, view, active, panel, enabledTiers, livePrice, size, plot, hover,
    interval, showProfile, profileW, profileX, axisX, rasterRows, rowGeom, minRaw,
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
      // Proportional to the actual wheel movement: a flat step made trackpads compound
      // into a runaway zoom-out.
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode);

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
      const colW = plot.w / (view.c1 - view.c0);
      const col = Math.max(0, Math.min(map.nCols - 1, Math.floor(view.c0 + mx / colW)));

      /*
       * Tooltip figures are the DISPLAY ROW's per-tier sums — the same buckets the raster
       * cell paints and the panel bar draws. Reading the one raw bucket under the cursor,
       * which this replaced, disagreed with both whenever a row spanned several buckets:
       * the live audit measured $164.26K against $123.28K at the same screen position.
       * Zoomed in to one bucket per row, this is the raw bucket again.
       */
      const row = rowGeom ? rowGeom.rowAtY(my) : -1;
      const scores = row >= 0 && rowGeom
        ? rowGeom.rowTiers(col, row)
        : map.matrices.map(() => 0);

      setHover({
        x: mx,
        y: my,
        region,
        price,
        col,
        scores,
        time: map.candles[col].start,
        row,
      });
    },
    [map, view, plot, regionAt, rowGeom],
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
  const panelRow = hover && panel && hover.row >= 0 ? panel.rows[hover.row] : null;

  /** Display row holding the live price — the split both tooltips choose their scale by. */
  const priceRowLive = useMemo(() => {
    if (!rowGeom || !map || livePrice == null || !(livePrice > 0)) return -1;
    const pb = Math.min(rowGeom.b1, Math.max(rowGeom.b0, priceToBucket(map.grid, livePrice)));
    return rowOfBucket(pb, rowGeom.b0, rowGeom.b1, rasterRows);
  }, [rowGeom, map, livePrice, rasterRows]);

  /*
   * ONE side rule for every tooltip: rows below the price row (larger index) are long
   * liquidations, the rest short — each side anchored to open interest separately. The plot
   * tooltip used to pick its side from the cursor's exact price while the panel picked by
   * row, so the two could disagree inside the price row itself.
   */
  // Companion to __liqmapAudit: the USD scales and row geometry live outside the paint
  // effect on purpose — usdScale refreshes must never be able to trigger a repaint.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__liqmapAuditView = rowGeom
      ? { yTop: rowGeom.yTop, yBot: rowGeom.yBot, rasterRows, scales: usdScale, priceRowLive }
      : null;
  }, [rowGeom, rasterRows, usdScale, priceRowLive]);

  const rowScale = (r: number) => (r > priceRowLive ? usdScale.long : usdScale.short);
  const panelRowScale = hover ? rowScale(hover.row) : usdScale.long;
  const plotRowScale = hover ? rowScale(hover.row) : usdScale.long;

  return (
    <div className="chart" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="chart__canvas"
        data-ticks={tickDebug || undefined}
        data-view={view ? `${view.p0},${view.p1},${view.c0},${view.c1}` : undefined}
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
              <span>{panelRow.tiers[i] > 0 ? formatUsdPrecise(panelRow.tiers[i] * panelRowScale) : '—'}</span>
            </div>
          ))}
          <div className="tip__row tip__row--total">
            <span>total est.</span>
            <strong>{panelRow.total > 0 ? formatUsdPrecise(panelRow.total * panelRowScale) : '—'}</strong>
          </div>
          <div className="tip__row">
            <span style={{ color: LONG_COLOR }}>cum. longs</span>
            <span>{panelRow.cumLong > 0 ? formatUsd(panelRow.cumLong * usdScale.long) : '—'}</span>
          </div>
          <div className="tip__row">
            <span style={{ color: SHORT_COLOR }}>cum. shorts</span>
            <span>{panelRow.cumShort > 0 ? formatUsd(panelRow.cumShort * usdScale.short) : '—'}</span>
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
              <span>{hover.scores[i] > 0 ? formatUsd(hover.scores[i] * plotRowScale) : '—'}</span>
            </div>
          ))}
          <div className="tip__row tip__row--total">
            <span>total est.</span>
            <strong>{hoverTotal > 0 ? formatUsdPrecise(hoverTotal * plotRowScale) : '—'}</strong>
          </div>
          <div className="tip__note">estimated USD, not exchange-reported</div>
        </div>
      )}

      {/* Intensity scale. Charts guidance is explicit that an intensity map needs a legend
          and must not lean on colour alone — this also makes the class breaks checkable. */}
      {map && legend && (
        <div className="legend" aria-label="Intensity classes, estimated USD">
          <span className="legend__title">
            est. $ / band
            <em className="legend__floor">&lt; floor hidden</em>
          </span>
          <div className="legend__rows">
            {([
              { key: 'above', mark: '\u25b2', name: 'shorts', breaks: legend.above, scale: usdScale.short },
              { key: 'below', mark: '\u25bc', name: 'longs', breaks: legend.below, scale: usdScale.long },
            ] as const).map((side) => (
              <div className="legend__row" key={side.key}>
                <span className="legend__side">
                  {side.mark} {side.name}
                </span>
                {ramp.classColors.map((c, i) => (
                  <span className="legend__item" key={i}>
                    <i style={{ background: `rgb(${c[0]},${c[1]},${c[2]})`, opacity: classAlpha(i) / 255 }} />
                    <b className="legend__num">
                      {i === 0
                        ? `< ${formatUsd(side.breaks[0] * side.scale)}`
                        : `${formatUsd(side.breaks[i - 1] * side.scale)}+`}
                    </b>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {loadingOlder && <div className="chart__backfill">Loading older candles…</div>}

      <button className="chart__refit" onClick={() => map && setView(fitView(map))} type="button">
        Refit
      </button>
    </div>
  );
}
