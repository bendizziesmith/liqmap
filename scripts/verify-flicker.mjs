/**
 * Intra-candle stability: between candle closes, only the last column, the price line, the
 * legend and the side panel may change. This captures the raster twice a few seconds apart
 * inside one candle and counts changed pixels OUTSIDE the last column and overlays.
 *
 * Also bins the changed pixels by x so the report says WHERE the churn is, which is what
 * separates "ladder recoloured everything" from "one column moved".
 *
 * Usage: node scripts/verify-flicker.mjs [baseUrl] [symbol] [interval] [gapMs] [label]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'XRPUSDT';
const INTERVAL = process.argv[4] ?? '4h';
const GAP_MS = Number(process.argv[5] ?? 5000);
const LABEL = process.argv[6] ?? 'now';

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
  },
  SYMBOL, INTERVAL,
);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 90_000 },
);
// Let the initial load, live socket and first reseed fully settle.
await new Promise((r) => setTimeout(r, 6000));

/** Raw RGBA of the plot area, plus the geometry needed to interpret it. */
function grab() {
  const cv = document.querySelector('.chart__canvas');
  const ctx = cv.getContext('2d');
  const { width: W, height: H } = cv;
  const view = (cv.getAttribute('data-view') ?? '').split(',').map(Number);
  const d = ctx.getImageData(0, 0, W, H).data;
  // The live-price tag is a solid near-white block in the right gutter; its row is the
  // price line, which the contract allows to move.
  let priceY = -1;
  let best = 0;
  for (let y = 0; y < H - 22; y++) {
    let n = 0;
    for (let x = W - 62; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++;
    }
    if (n > best) { best = n; priceY = y; }
  }
  return { W, H, view, priceY, px: Array.from(d) };
}

// Keep the pointer away so no crosshair/tooltip pollutes the diff.
const a = await page.evaluate(grab);
await new Promise((r) => setTimeout(r, GAP_MS));
const b = await page.evaluate(grab);
await browser.close();

if (a.view.join() !== b.view.join()) {
  console.log(`view moved between captures (${a.view} -> ${b.view}) — rerun`);
  process.exit(1);
}

const { W, H } = a;
const PROFILE_W = 90, AXIS_W = 62, AXIS_H = 22;
const plotW = W - AXIS_W - PROFILE_W;
const plotH = H - AXIS_H;
const [p0, p1, c0, c1] = a.view;
const colW = plotW / (c1 - c0);

// The last (forming) column's x-range, padded a pixel each side for the candle stroke.
const lastColX0 = Math.floor(plotW - colW) - 2;
// With smoothing on, the blit's bilinear filter bleeds a changed forming-column source
// pixel up to one source column leftward — part of rendering the last column, not history.
const filterX0 = Math.floor(plotW - 2 * colW) - 2;

// Price-line rows in EITHER capture are overlay movement the contract allows (the dashes
// make them partial-width, so a full-width test misses them). The detector returns the TOP
// of the 18px price tag; the dashed line runs through its centre 9px lower, so the whole
// tag-height band around each capture's tag is the price-line allowance.
const overlayRow = (y) =>
  (a.priceY >= 0 && y >= a.priceY - 1 && y <= a.priceY + 20) ||
  (b.priceY >= 0 && y >= b.priceY - 1 && y <= b.priceY + 20);

let changedPlot = 0;
let changedOutsideLast = 0;   // strict: everything left of the forming column
let changedHistory = 0;       // minus allowed overlays: price line rows + filter margin
const byCol = new Uint32Array(Math.ceil(plotW / 8) + 1);
const rowsHit = new Set();

for (let y = 0; y < plotH; y++) {
  for (let x = 0; x < plotW; x++) {
    const i = (y * W + x) * 4;
    if (a.px[i] === b.px[i] && a.px[i + 1] === b.px[i + 1] &&
        a.px[i + 2] === b.px[i + 2] && a.px[i + 3] === b.px[i + 3]) continue;
    changedPlot++;
    if (x < lastColX0) {
      changedOutsideLast++;
      byCol[Math.floor(x / 8)]++;
      rowsHit.add(y);
      if (x < filterX0 && !overlayRow(y)) changedHistory++;
    }
  }
}

// The price line moves with the tick: horizontal runs at one y are it, not heat churn.
// Estimate it: rows where nearly the whole width changed.
let priceLineRows = 0;
for (const y of rowsHit) {
  let n = 0;
  for (let x = 0; x < lastColX0; x++) {
    const i = (y * W + x) * 4;
    if (a.px[i] !== b.px[i] || a.px[i + 1] !== b.px[i + 1] ||
        a.px[i + 2] !== b.px[i + 2] || a.px[i + 3] !== b.px[i + 3]) n++;
  }
  if (n > lastColX0 * 0.7) priceLineRows++;
}

// Diagnose each churned row: where it is, how much of it changed, and a sample transition.
const rowDetail = [];
for (const y of [...rowsHit].sort((p2, q) => p2 - q)) {
  let n = 0;
  let sample = null;
  for (let x = 0; x < lastColX0; x++) {
    const i = (y * W + x) * 4;
    if (a.px[i] !== b.px[i] || a.px[i + 1] !== b.px[i + 1] ||
        a.px[i + 2] !== b.px[i + 2] || a.px[i + 3] !== b.px[i + 3]) {
      n++;
      if (!sample && x > 40) sample = `x=${x} [${a.px[i]},${a.px[i + 1]},${a.px[i + 2]},${a.px[i + 3]}]->[${b.px[i]},${b.px[i + 1]},${b.px[i + 2]},${b.px[i + 3]}]`;
    }
  }
  rowDetail.push({ y, n, sample });
}

const spread = byCol.filter((n) => n > 0).length;
console.log(`\n${SYMBOL} ${INTERVAL} — ${LABEL} — two captures ${GAP_MS}ms apart, same view`);
console.log('='.repeat(68));
console.log(`  plot ${plotW}x${plotH}, last column starts at x=${lastColX0}`);
console.log(`  price line row: capture A y=${a.priceY}, capture B y=${b.priceY}`);
console.log(`  changed pixels in plot            : ${changedPlot}`);
console.log(`  changed OUTSIDE the last column   : ${changedOutsideLast} (strict)`);
console.log(`  changed in HISTORY                : ${changedHistory} (minus price-line rows + smoothing margin)`);
console.log(`  distinct rows touched outside     : ${rowsHit.size} (of which ~full-width price-line rows: ${priceLineRows})`);
console.log(`  8px column bins with any change   : ${spread} / ${Math.ceil(lastColX0 / 8)}`);
console.log(`  verdict: ${changedHistory === 0 ? 'STABLE — history frozen' :
  spread > Math.ceil(lastColX0 / 8) * 0.5 ? 'GLOBAL RECOLOUR — ladder or scale moved' : 'localised churn'}`);
for (const rd of rowDetail.slice(0, 12)) {
  console.log(`    row y=${rd.y}  changed=${rd.n}px  ${rd.sample ?? ''}`);
}
console.log(`  view: prices [${p0.toFixed(4)}, ${p1.toFixed(4)}], cols [${c0.toFixed(1)}, ${c1.toFixed(1)}]`);
