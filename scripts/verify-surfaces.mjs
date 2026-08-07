/**
 * Surface-consistency audit: at the same price, the latest heatmap column, the side-panel
 * bar and both tooltips must describe the same number from the same buckets.
 *
 * Hovers the plot over the LAST column and the side panel at the same y for N prices
 * spanning the visible range, reads both tooltips, and — when the build exposes it — the
 * shared per-row series (window.__liqmapAudit) those figures must derive from.
 *
 * Usage: node scripts/verify-surfaces.mjs [baseUrl] [symbol] [interval] [label]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'XRPUSDT';
const INTERVAL = process.argv[4] ?? '4h';
const LABEL = process.argv[5] ?? 'now';
const POINTS = 20;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(
  (sym, iv) => {
    localStorage.setItem('liqmap.view', JSON.stringify({
      symbol: sym, interval: iv, enabledTiers: [true, true, true, true],
      tab: 'heatmap', showProfile: true, colormap: 'inferno',
    }));
    // Smoothing off for the cross-correlation: the 0.25/0.5/0.25 bar smoothing flattens
    // the correlation peak across neighbouring offsets. Figures are identical either way —
    // that is the point of the audit.
    localStorage.setItem('liqmap.settings', JSON.stringify({
      alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false,
      levelDecay: true, smoothRendering: false,
    }));
  },
  SYMBOL, INTERVAL,
);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 90_000 },
);
await new Promise((r) => setTimeout(r, 5000));

const rows = await page.evaluate(async (nPoints) => {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const AXIS_W = 62, PROFILE_W = 90, AXIS_H = 22;
  const plotW = r.width - AXIS_W - PROFILE_W;
  const plotH = r.height - AXIS_H;

  const hoverAt = async (x, y) => {
    cv.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 7, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: true,
    }));
    await new Promise((z) => setTimeout(z, 130));
    const tip = document.querySelector('.tip');
    if (!tip) return null;
    const lines = [...tip.querySelectorAll('.tip__row')].map((n) => n.innerText.replace(/\s+/g, ' ').trim());
    return {
      head: lines[0] ?? '',
      total: (lines.find((s) => s.startsWith('total est.')) ?? '').replace('total est. ', ''),
      tiers: lines.slice(1).filter((s) => /×/.test(s)),
    };
  };

  // Re-read per point, not once up front: the OI scale refreshes on a timer, so a snapshot
  // taken before a 20-point sweep goes stale mid-run and reports a divergence that is the
  // probe's own lag rather than the app's.
  const out = [];
  for (let i = 0; i < nPoints; i++) {
    const y = ((i + 0.5) / nPoints) * plotH;
    // Plot hover: centre of the last visible column.
    const plotTip = await hoverAt(plotW - 4, y);
    // Panel hover: same y, inside the profile strip.
    const panelTip = await hoverAt(plotW + PROFILE_W / 2, y);

    // The shared per-row series the tooltips must derive from: rows[r] * sideScale.
    const audit = window.__liqmapAudit ?? null;
    const auditView = window.__liqmapAuditView ?? null;
    let shared = null;
    if (audit && auditView) {
      const f = (y - auditView.yTop) / (auditView.yBot - auditView.yTop);
      const r = f >= 0 && f < 1 ? Math.min(auditView.rasterRows - 1, Math.floor(f * auditView.rasterRows)) : -1;
      if (r >= 0) {
        const scale = r > auditView.priceRowLive ? auditView.scales.long : auditView.scales.short;
        shared = audit.rows[r] * scale;
      }
    }
    out.push({
      y: Math.round(y),
      plotPrice: plotTip?.head ?? '(none)',
      plotTotal: plotTip?.total ?? '(none)',
      panelPrice: panelTip?.head ?? '(none)',
      panelTotal: panelTip?.total ?? '(none)',
      shared,
    });
  }
  // Clear the hover so nothing lingers in later screenshots.
  cv.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 7, bubbles: true }));

  /*
   * Pixel cross-correlation: panel bar length per display row (measured from pixels)
   * against the shared row series. If the surfaces are aligned the peak sits at offset 0.
   */
  const audit = window.__liqmapAudit ?? null;
  const auditView = window.__liqmapAuditView ?? null;
  let xcorr = null;
  if (audit && auditView) {
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width;
    const axisX = (plotW + PROFILE_W) * dpr;
    const barLen = [];
    for (let r = 0; r < auditView.rasterRows; r++) {
      const yMid = (auditView.yTop + ((r + 0.5) / auditView.rasterRows) * (auditView.yBot - auditView.yTop)) * dpr;
      const yy = Math.round(yMid);
      if (yy < 0 || yy >= cv.height - 22 * dpr) { barLen.push(0); continue; }
      // Scan leftward from the axis edge, counting TIER BAR colours only — the cumulative
      // curves and their translucent fills also live in the strip and would smear the
      // measurement toward wherever the curves are fat.
      const BAR_RGB = [[106, 10, 104], [187, 55, 84], [249, 142, 9], [245, 219, 76], [252, 255, 164]];
      const isBar = (k) => BAR_RGB.some((c) =>
        Math.abs(img[k] - c[0]) <= 14 && Math.abs(img[k + 1] - c[1]) <= 14 && Math.abs(img[k + 2] - c[2]) <= 14);
      let len = 0;
      for (let x = Math.floor(axisX) - 2; x > plotW * dpr; x--) {
        const k = (yy * W + x) * 4;
        if (img[k + 3] > 0 && isBar(k)) len++;
      }
      barLen.push(len);
    }
    const series = audit.rows.map((v) => Math.pow(Math.max(0, v), 0.68)); // bar gamma
    const corrAt = (off) => {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
      for (let r = 0; r < series.length; r++) {
        const q = r + off;
        if (q < 0 || q >= barLen.length) continue;
        const a = series[r], b = barLen[q];
        sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b; n++;
      }
      const cov = sxy - (sx * sy) / n;
      const va = sxx - (sx * sx) / n;
      const vb = syy - (sy * sy) / n;
      return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
    };
    xcorr = [];
    for (let off = -5; off <= 5; off++) xcorr.push({ off, r: corrAt(off) });
  }
  return { out, hasHook: audit != null, view: cv.getAttribute('data-view'), xcorr };
}, POINTS);

const parse = (s) => {
  const m = /\$([\d.]+)([KMBT])?/.exec(s ?? '');
  return m ? parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] ?? 1) : null;
};

const fmtShared = (v) => {
  if (v == null) return '';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(0)}`;
};

let match = 0, mismatch = 0, empty = 0, hookMismatch = 0;
console.log(`\n${SYMBOL} ${INTERVAL} — surface audit (${LABEL}) — ${BASE}`);
console.log(`  audit hook present: ${rows.hasHook}   view: ${rows.view}`);
console.log('='.repeat(96));
console.log('     y   plot price      plot total     panel price     panel total    verdict');
for (const r of rows.out) {
  const a = parse(r.plotTotal);
  const b = parse(r.panelTotal);
  let verdict;
  if (a == null && b == null) { verdict = 'both empty'; empty++; }
  else if (a == null || b == null) { verdict = 'ONE EMPTY'; mismatch++; }
  // "Identical to the dollar" is asserted on the formatted strings: both surfaces format
  // through the same formatter, so equal dollars produce equal strings.
  else if (r.plotTotal === r.panelTotal) { verdict = 'match'; match++; }
  else { verdict = `MISMATCH (${(Math.max(a, b) / Math.min(a, b)).toFixed(2)}x)`; mismatch++; }
  // Third leg: the tooltip dollars must derive from the shared row series (0.5% covers the
  // display formatter's own rounding).
  if (r.shared != null && a != null) {
    const rel = Math.abs(a - r.shared) / Math.max(1, r.shared);
    if (rel > 0.005) { verdict += ` HOOK-DIVERGES (${fmtShared(r.shared)})`; hookMismatch++; }
  }
  console.log(
    `  ${String(r.y).padStart(4)}   ${r.plotPrice.slice(0, 14).padEnd(14)} ${r.plotTotal.padEnd(14)} ` +
      `${r.panelPrice.slice(0, 14).padEnd(15)} ${r.panelTotal.padEnd(14)} ${verdict}`,
  );
}
console.log('='.repeat(96));
console.log(`  ${match} match, ${mismatch} mismatch, ${empty} both-empty of ${POINTS}` +
  (rows.hasHook ? `; matrix-hook divergences: ${hookMismatch}` : ''));
if (rows.xcorr) {
  const peak = rows.xcorr.reduce((b, c) => (c.r > b.r ? c : b));
  console.log(`  bar-vs-matrix cross-correlation: peak r=${peak.r.toFixed(3)} at offset ${peak.off}` +
    `   [${rows.xcorr.map((c) => c.r.toFixed(2)).join(' ')}]`);
}

await browser.close();
process.exit(mismatch > 0 ? 2 : 0);
