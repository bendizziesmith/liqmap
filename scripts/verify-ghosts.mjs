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

/** Drag the price axis downward three times; each drag zooms that axis out about its centre. */
async function zoomPriceOut() {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const x = r.right - 30; // inside the price gutter
  const ev = (t, y) =>
    cv.dispatchEvent(new PointerEvent(t, { pointerId: 77, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  for (let pass = 0; pass < 3; pass++) {
    const from = r.top + r.height * 0.25;
    const to = r.top + r.height * 0.95;
    ev('pointerdown', from);
    for (let s = 1; s <= 12; s++) {
      ev('pointermove', from + ((to - from) * s) / 12);
      await new Promise((z) => setTimeout(z, 35));
    }
    ev('pointerup', to);
    await new Promise((z) => setTimeout(z, 250));
  }
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

  let painted = 0, cells = 0, paintedFar = 0, cellsFar = 0;
  // Once zoomed right out the top third of the above-price half is where the ~4x ghosts sit.
  const farBand = priceY / 3;
  for (let y = 0; y < priceY - 3; y++) {
    for (let x = 0; x < plotW; x++) {
      const k = cls(d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]);
      cells++;
      if (y < farBand) cellsFar++;
      if (k < 0) continue;
      painted++;
      if (y < farBand) paintedFar++;
    }
  }
  return { priceY, painted, cells, paintedFar, cellsFar };
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

  await page.evaluate(zoomPriceOut);
  await new Promise((r) => setTimeout(r, 1500));

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
console.log(`  painted in the far-above band${pct(off.paintedFar / off.cellsFar).padStart(14)}${pct(on.paintedFar / on.cellsFar).padStart(14)}`);
console.log(`  far-band pixels                 ${String(off.paintedFar).padStart(11)}${String(on.paintedFar).padStart(14)}`);
console.log(`\n  ghost shelf reduction: ${(off.paintedFar / Math.max(1, on.paintedFar)).toFixed(1)}x fewer painted pixels far above price`);
console.log(`  screenshots: docs/screenshots/decay-{off,on}-${SYMBOL.toLowerCase()}-${INTERVAL}.png`);
