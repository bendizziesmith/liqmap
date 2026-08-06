/**
 * Ghost-shelf verification: does level decay remove the ancient far-from-price shelves, and
 * does turning it off bring them back?
 *
 * The default view is fitted to recent candles, so the 2024/2025 ghosts — which sit at
 * roughly 4x the current price — are off screen and the toggle looks like it does nothing.
 * This zooms the price axis all the way out first so the whole grid is visible, then counts
 * painted heat pixels above the live-price line with decay off and on.
 *
 * Usage: node scripts/verify-ghosts.mjs [baseUrl] [symbol] [interval]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.netlify.app/';
const SYMBOL = process.argv[3] ?? 'XRPUSDT';
const INTERVAL = process.argv[4] ?? '1d';

/**
 * Zoom and pan the price axis until the whole grid is on screen.
 *
 * Driven by the view domain the chart publishes rather than by guessed drag distances: a
 * fixed number of drags either undershoots and misses the ghosts or overshoots into a +-39
 * price range where every level collapses onto one line.
 */
async function frameWholeGrid(target) {
  const cv = document.querySelector('.chart__canvas');
  const domain = () => (cv.getAttribute('data-view') ?? '').split(',').map(Number);
  const drag = async (x, y0, y1, id) => {
    const ev = (t, y) =>
      cv.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
    ev('pointerdown', y0);
    for (let s = 1; s <= 10; s++) {
      ev('pointermove', y0 + ((y1 - y0) * s) / 10);
      await new Promise((z) => setTimeout(z, 30));
    }
    ev('pointerup', y1);
    await new Promise((z) => setTimeout(z, 300));
  };

  for (let i = 0; i < 12; i++) {
    const r = cv.getBoundingClientRect();
    const [p0, p1] = domain();
    if (!Number.isFinite(p0)) break;
    if (p0 <= target.lo && p1 >= target.hi) break;

    const span = p1 - p0;
    const want = (target.hi - target.lo) * 1.08;
    if (span < want) {
      // Zoom the price axis out: dragging it down scales the domain by e^(px/400).
      const px = Math.min(r.height * 0.7, 400 * Math.log(want / span));
      const mid = r.top + r.height * 0.2;
      await drag(r.right - 30, mid, mid + px, 77);
    } else {
      // Right span, wrong centre — pan the plot so the far-above band comes into view.
      const wantMid = (target.lo + target.hi) / 2;
      const gotMid = (p0 + p1) / 2;
      const px = ((wantMid - gotMid) / span) * r.height;
      const mid = r.top + r.height * 0.5;
      await drag(r.left + r.width * 0.4, mid, Math.max(r.top + 5, Math.min(r.bottom - 5, mid + px)), 78);
    }
  }
  return domain();
}

/** Painted heat pixels above the live-price line, and within the far-above band. */
function samplePixels() {
  const cv = document.querySelector('.chart__canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const plotW = W - 62 - 90;
  const plotH = H - 22;

  // The live price tag is a solid white block in the right-hand gutter.
  let priceY = -1;
  let best = 0;
  for (let y = 0; y < plotH; y++) {
    let n = 0;
    for (let x = W - 62; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++;
    }
    if (n > best) { best = n; priceY = y; }
  }

  const CLASS_RGB = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
  const cls = (r, g, b) => {
    for (let k = 0; k < 5; k++) {
      const c = CLASS_RGB[k];
      if (Math.abs(r - c[0]) <= 10 && Math.abs(g - c[1]) <= 10 && Math.abs(b - c[2]) <= 10) return k;
    }
    return -1;
  };

  // Map the far-above band (2x price and up) to pixels using the published domain.
  const [p0, p1] = (cv.getAttribute('data-view') ?? '').split(',').map(Number);
  const yOf = (price) => ((p1 - price) / (p1 - p0)) * plotH;
  const price = p0 + (1 - priceY / plotH) * (p1 - p0);
  const farBand = yOf(price * 2);

  /*
   * Counting merely-painted pixels does not measure this. Classes come from percentiles of
   * whatever is on screen, so they are scale-invariant: a ghost decayed to a thousandth of
   * its old value is still non-zero and still gets painted, just in the faintest class. What
   * decay changes is which levels are strong enough to take the TOP classes, so that is what
   * is counted here — separately for the far-above band and for the band around price.
   */
  let painted = 0, cells = 0, hotFar = 0, cellsFar = 0, hotNear = 0, cellsNear = 0;
  const nearTop = yOf(price * 1.15);
  for (let y = 0; y < priceY - 3; y++) {
    for (let x = 0; x < plotW; x++) {
      const k = cls(d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]);
      cells++;
      if (y < farBand) cellsFar++;
      if (y >= nearTop) cellsNear++;
      if (k < 0) continue;
      painted++;
      if (k >= 3 && y < farBand) hotFar++;
      if (k >= 3 && y >= nearTop) hotNear++;
    }
  }
  return { priceY, painted, cells, hotFar, cellsFar, hotNear, cellsNear, p0, p1, price };
}

async function run(decay) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(
    (sym, iv, d) => {
      localStorage.setItem('liqmap.view', JSON.stringify({
        symbol: sym, interval: iv, enabledTiers: [true, true, true, true],
        tab: 'heatmap', showProfile: true, colormap: 'inferno',
      }));
      localStorage.setItem('liqmap.settings', JSON.stringify({
        alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false, levelDecay: d,
      }));
    },
    SYMBOL, INTERVAL, decay,
  );

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
    { timeout: 90_000 },
  );
  await new Promise((r) => setTimeout(r, 4000));

  const domain = await page.evaluate(frameWholeGrid, { lo: 0.2, hi: 4.4 });
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`  decay ${decay ? 'on ' : 'off'}: framed price range [${domain[0]?.toFixed(2)}, ${domain[1]?.toFixed(2)}]`);

  const s = await page.evaluate(samplePixels);
  await page.screenshot({
    path: `docs/screenshots/decay-${decay ? 'on' : 'off'}-${SYMBOL.toLowerCase()}-${INTERVAL}.png`,
  });
  await browser.close();
  return s;
}

const pct = (x) => `${(100 * x).toFixed(2)}%`;

const off = await run(false);
const on = await run(true);

console.log(`\n${SYMBOL} ${INTERVAL} — price axis zoomed fully out, at ${BASE}`);
console.log('='.repeat(72));
console.log('                                      DECAY OFF      DECAY ON');
console.log(`  painted above price          ${pct(off.painted / off.cells).padStart(14)}${pct(on.painted / on.cells).padStart(14)}`);
console.log(`  TOP-CLASS above 2x price     ${pct(off.hotFar / off.cellsFar).padStart(14)}${pct(on.hotFar / on.cellsFar).padStart(14)}`);
console.log(`  top-class pixels above 2x       ${String(off.hotFar).padStart(11)}${String(on.hotFar).padStart(14)}`);
console.log(`  TOP-CLASS within 15% of price${pct(off.hotNear / off.cellsNear).padStart(14)}${pct(on.hotNear / on.cellsNear).padStart(14)}`);
console.log(`  top-class pixels near price     ${String(off.hotNear).padStart(11)}${String(on.hotNear).padStart(14)}`);
console.log(`\n  ghost shelf:  ${off.hotFar} -> ${on.hotFar} top-class pixels above 2x price`);
console.log(`  near price:   ${off.hotNear} -> ${on.hotNear} top-class pixels within 15% of price`);
console.log(`  screenshots: docs/screenshots/decay-{off,on}-${SYMBOL.toLowerCase()}-${INTERVAL}.png`);
