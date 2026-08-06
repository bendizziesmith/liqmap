/**
 * Measure how the heat actually reads: contiguous vertical band heights, isolated-pixel
 * speckle, and the share of clean background — plus three plot-tooltip USD figures, which
 * rendering must not touch.
 *
 * Run against the deployed build before and after a rendering change to compare.
 *
 * Usage: node scripts/verify-bands.mjs [baseUrl] [symbol] [interval] [label]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.netlify.app/';
const SYMBOL = process.argv[3] ?? 'XRPUSDT';
const INTERVAL = process.argv[4] ?? '1d';
const LABEL = process.argv[5] ?? 'now';
// Band GEOMETRY is measured with smoothing off: the anti-aliased edges smoothing adds do
// not match the exact class palette, so a colour-matching scan under-counts runs. The
// aggregation decides band height; smoothing only softens edges.
const SMOOTH = process.argv[6] !== 'crisp';

/** Contiguous run statistics over the heat raster, by intensity threshold. */
function measureBands() {
  const cv = document.querySelector('.chart__canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const plotW = W - 62 - 90;
  const plotH = H - 22;

  const CLASS_RGB = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
  const classAt = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] === 0) return -1;
    for (let k = 0; k < 5; k++) {
      const c = CLASS_RGB[k];
      if (Math.abs(d[i] - c[0]) <= 10 && Math.abs(d[i + 1] - c[1]) <= 10 && Math.abs(d[i + 2] - c[2]) <= 10) return k;
    }
    return -1; // candles, gridlines, crosshair — not heat
  };

  const stats = {};
  for (const threshold of [1, 2, 3]) {
    const runs = [];
    // Sample every 4th column: adjacent columns are near-identical and this keeps the scan
    // to a few hundred thousand reads.
    for (let x = 0; x < plotW; x += 4) {
      let run = 0;
      for (let y = 0; y < plotH; y++) {
        if (classAt(x, y) >= threshold) {
          run++;
        } else if (run > 0) {
          runs.push(run);
          run = 0;
        }
      }
      if (run > 0) runs.push(run);
    }
    runs.sort((a, b) => a - b);
    const median = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
    const singles = runs.filter((r) => r === 1).length;
    stats[threshold] = {
      runs: runs.length,
      median,
      mean: runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0,
      singlePixelShare: runs.length ? singles / runs.length : 0,
    };
  }

  // Background cleanliness: share of plot pixels carrying no heat at all.
  let unpainted = 0;
  let total = 0;
  for (let x = 0; x < plotW; x += 4) {
    for (let y = 0; y < plotH; y++) {
      total++;
      if (classAt(x, y) < 0) unpainted++;
    }
  }

  const [p0, p1] = (cv.getAttribute('data-view') ?? '').split(',').map(Number);
  return { stats, unpaintedShare: unpainted / total, p0, p1, plotW, plotH };
}

/** Plot-tooltip totals at three fixed points, which rendering must leave alone. */
async function readTooltips() {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const plotW = r.width - 62 - 90;
  const plotH = r.height - 22;
  const out = [];
  for (const [fx, fy] of [[0.35, 0.3], [0.6, 0.55], [0.85, 0.72]]) {
    const x = r.left + plotW * fx;
    const y = r.top + plotH * fy;
    cv.dispatchEvent(new PointerEvent('pointermove', { pointerId: 5, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    await new Promise((z) => setTimeout(z, 200));
    const tip = document.querySelector('.tip');
    if (!tip) { out.push(null); continue; }
    const rows = [...tip.querySelectorAll('.tip__row')].map((n) => n.innerText.replace(/\s+/g, ' ').trim());
    out.push({ at: `${fx},${fy}`, head: rows[0] ?? '', total: rows.find((s) => s.startsWith('total est.')) ?? '' });
  }
  return out;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(
  (sym, iv, sm) => {
    localStorage.setItem('liqmap.view', JSON.stringify({
      symbol: sym, interval: iv, enabledTiers: [true, true, true, true],
      tab: 'heatmap', showProfile: true, colormap: 'inferno',
    }));
    // Decay off: the spot-checked tooltip figures have to be comparable across builds, and
    // decay's own numbers move as new candles close.
    localStorage.setItem('liqmap.settings', JSON.stringify({
      alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false,
      levelDecay: false, smoothRendering: sm,
    }));
  },
  SYMBOL, INTERVAL, SMOOTH,
);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 90_000 },
);
await new Promise((r) => setTimeout(r, 4000));

const m = await page.evaluate(measureBands);
await page.screenshot({ path: `docs/screenshots/bands-${LABEL}-${SYMBOL.toLowerCase()}-${INTERVAL}.png` });
const tips = await page.evaluate(readTooltips);

console.log(`\n${SYMBOL} ${INTERVAL} — ${LABEL} — ${BASE}`);
console.log('='.repeat(70));
console.log(`  view price range [${m.p0?.toFixed(4)}, ${m.p1?.toFixed(4)}]  plot ${m.plotW}x${m.plotH}`);
for (const t of [1, 2, 3]) {
  const s = m.stats[t];
  console.log(
    `  class >= ${t}:  median run ${String(s.median).padStart(3)}px   mean ${s.mean.toFixed(1).padStart(5)}px   ` +
      `runs ${String(s.runs).padStart(6)}   1px-only ${(100 * s.singlePixelShare).toFixed(1).padStart(5)}%`,
  );
}
console.log(`  clean background (no heat): ${(100 * m.unpaintedShare).toFixed(1)}%`);
console.log('  tooltips (decay off):');
for (const t of tips) console.log(`    ${t ? `${t.at}  ${t.head}  ${t.total}` : '(none)'}`);

// Rendering must not touch the figures: toggle smoothing INSIDE this session and compare.
// (Comparing across separate runs confounds rendering with live-data drift — the OI series
// and the forming candle move between page loads.)
const tipsAt = () => page.evaluate(async () => {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const plotW = r.width - 62 - 90;
  const plotH = r.height - 22;
  const out = [];
  for (const [fx, fy] of [[0.35, 0.3], [0.6, 0.55], [0.85, 0.72]]) {
    cv.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 6, clientX: r.left + plotW * fx, clientY: r.top + plotH * fy, bubbles: true, isPrimary: true }));
    await new Promise((z) => setTimeout(z, 150));
    const tip = document.querySelector('.tip');
    const rows = tip ? [...tip.querySelectorAll('.tip__row')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()) : [];
    out.push(rows.find((x) => x.startsWith('total est.')) ?? '(none)');
  }
  return out;
});
const flipSmooth = () => page.evaluate(() => {
  document.querySelector('button[aria-label="Settings"]')?.click();
  const boxes = [...document.querySelectorAll('.drawer input[type="checkbox"]')];
  boxes.find((b) => /Smooth rendering/.test(b.closest('label')?.textContent ?? ''))?.click();
  document.querySelector('.drawer button[aria-label="Close settings"]')?.click();
});
const tipsA = await tipsAt();
await flipSmooth();
await new Promise((r) => setTimeout(r, 900));
const tipsB = await tipsAt();
await flipSmooth();
await new Promise((r) => setTimeout(r, 900));
const parity = tipsA.every((v, i) => v === tipsB[i]);
console.log(`  smooth-toggle tooltip parity: ${parity ? 'IDENTICAL' : `DIFFER ${JSON.stringify({ tipsA, tipsB })}`}`);

// Fully zoomed in, a single bucket must still be resolvable.
await page.evaluate(async () => {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const x = r.right - 30;
  const ev = (t, y) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 91, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  for (let pass = 0; pass < 4; pass++) {
    const from = r.top + r.height * 0.8;
    const to = r.top + r.height * 0.2;
    ev('pointerdown', from);
    for (let s = 1; s <= 10; s++) { ev('pointermove', from + ((to - from) * s) / 10); await new Promise((z) => setTimeout(z, 30)); }
    ev('pointerup', to);
    await new Promise((z) => setTimeout(z, 250));
  }
});
await new Promise((r) => setTimeout(r, 1200));
const zoomed = await page.evaluate(measureBands);
const span = zoomed.p1 - zoomed.p0;
console.log(`\n  ZOOMED IN — price range [${zoomed.p0?.toFixed(5)}, ${zoomed.p1?.toFixed(5)}] (span ${span.toFixed(5)})`);
for (const t of [2, 3]) {
  const s = zoomed.stats[t];
  console.log(`  class >= ${t}:  median run ${String(s.median).padStart(3)}px   runs ${s.runs}`);
}
await page.screenshot({ path: `docs/screenshots/bands-${LABEL}-zoomed-${SYMBOL.toLowerCase()}-${INTERVAL}.png` });

await browser.close();
