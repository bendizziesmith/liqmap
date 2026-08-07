/**
 * Quantify how "soft" the heat renders.
 *
 * The raster is painted in exactly five palette colours. Any pixel in the plot that is a
 * heat pixel but NOT an exact palette colour can only have come from interpolation — so
 * the share of off-palette heat pixels is a direct blur measure, not a judgement call.
 *
 * Also reports vertical edge hardness (how many scanline transitions are single-pixel
 * steps between two palette colours vs multi-pixel gradients) and the alpha spread.
 *
 * Usage: node scripts/verify-crisp.mjs [baseUrl] [symbol] [interval] [smooth:on|off] [label]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'BTCUSDT';
const INTERVAL = process.argv[4] ?? '4h';
const SMOOTH = (process.argv[5] ?? 'on') === 'on';
const LABEL = process.argv[6] ?? (SMOOTH ? 'smooth' : 'crisp');

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
    localStorage.setItem('liqmap.settings', JSON.stringify({
      alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false,
      levelDecay: true, smoothRendering: sm, wickClearing: 'full',
      standingShare: 'highLeverage',
    }));
  },
  SYMBOL, INTERVAL, SMOOTH,
);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 90_000 },
);
await new Promise((r) => setTimeout(r, 5000));

const m = await page.evaluate(() => {
  const cv = document.querySelector('.chart__canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const plotW = W - 62 - 90;
  const plotH = H - 22;

  const PAL = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
  const CANDLE = [[94, 234, 212], [248, 113, 113]];
  const exact = (r, g, b, set, tol) =>
    set.findIndex((c) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol);

  let heatExact = 0;   // pixel is precisely a palette colour
  let heatNear = 0;    // within a loose tolerance: interpolated between palette colours
  let ground = 0;
  let candle = 0;
  let other = 0;
  const alphas = new Set();

  for (let y = 0; y < plotH; y++) {
    for (let x = 0; x < plotW; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (a === 0 || (r < 20 && g < 22 && b < 30)) { ground++; continue; }
      if (exact(r, g, b, CANDLE, 30) >= 0) { candle++; continue; }
      if (exact(r, g, b, PAL, 2) >= 0) { heatExact++; alphas.add(a); continue; }
      if (exact(r, g, b, PAL, 40) >= 0) { heatNear++; continue; }
      other++;
    }
  }

  // Vertical edge hardness on heat columns: for each scanline, walk down and classify each
  // colour change as a hard step (adjacent pixels both exact palette) or a soft ramp.
  let hard = 0;
  let soft = 0;
  for (let x = 0; x < plotW; x += 3) {
    let prev = -2;
    for (let y = 0; y < plotH; y++) {
      const i = (y * W + x) * 4;
      const k = exact(d[i], d[i + 1], d[i + 2], PAL, 2);
      const loose = exact(d[i], d[i + 1], d[i + 2], PAL, 40);
      if (k >= 0) {
        if (prev >= 0 && k !== prev) hard++;
        prev = k;
      } else if (loose >= 0) {
        soft++;
        prev = -1;
      } else {
        prev = -2;
      }
    }
  }

  const heat = heatExact + heatNear;
  return {
    heatExact, heatNear, ground, candle, other,
    blurShare: heat > 0 ? heatNear / heat : 0,
    hardEdges: hard,
    softPixels: soft,
    distinctAlphas: [...alphas].sort((a, b) => a - b),
    plotW, plotH,
    view: cv.getAttribute('data-view'),
  };
});

await page.screenshot({ path: `docs/screenshots/render-${LABEL}-${SYMBOL.toLowerCase()}-${INTERVAL}.png` });
await browser.close();

const pct = (x) => `${(100 * x).toFixed(2)}%`;
console.log(`\n${SYMBOL} ${INTERVAL} — smoothing ${SMOOTH ? 'ON' : 'OFF'} (${LABEL}) — ${BASE}`);
console.log('='.repeat(70));
console.log(`  heat pixels, exact palette   : ${m.heatExact}`);
console.log(`  heat pixels, INTERPOLATED    : ${m.heatNear}`);
console.log(`  BLUR SHARE (interp / heat)   : ${pct(m.blurShare)}`);
console.log(`  hard class edges on scanlines: ${m.hardEdges}`);
console.log(`  soft/ramp pixels on scanlines: ${m.softPixels}`);
console.log(`  distinct alphas in exact heat: ${JSON.stringify(m.distinctAlphas)}`);
console.log(`  ground ${m.ground}  candle ${m.candle}  other ${m.other}`);
console.log(`  view: ${m.view}`);
