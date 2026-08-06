/**
 * Live verification for level decay + the calendar time axis.
 *
 * Reads the rendered canvas rather than trusting the engine: counts painted and top-class
 * pixels above and below the live-price line, with decay on and then off, and checks the
 * axis ticks land on calendar boundaries and stay glued to their dates across a pan and a
 * backfill prepend.
 *
 * Usage: node scripts/verify-live-decay.mjs [baseUrl] [symbol] [interval]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.netlify.app/';
const SYMBOL = process.argv[3] ?? 'XRPUSDT';
const INTERVAL = process.argv[4] ?? '1d';

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
    localStorage.setItem('liqmap.settings', JSON.stringify({
      alertMinScore: 70, alertDistancePct: 1.5, alertsEnabled: false, levelDecay: true,
    }));
  },
  SYMBOL,
  INTERVAL,
);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 90_000 },
);
await new Promise((r) => setTimeout(r, 4000));

/** Painted / top-class pixel counts, split at the live-price line. */
const sample = () =>
  page.evaluate(() => {
    const cv = document.querySelector('.chart__canvas');
    const dpr = window.devicePixelRatio || 1;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const d = ctx.getImageData(0, 0, W, H).data;

    const AXIS_W = 62 * dpr;
    const PROFILE_W = 90 * dpr;
    const AXIS_H = 22 * dpr;
    const plotW = W - AXIS_W - PROFILE_W;
    const plotH = H - AXIS_H;

    // The live price tag is a solid white block in the right-hand gutter. The row with the
    // most near-white pixels there is the price line.
    let priceY = -1;
    let best = 0;
    for (let y = 0; y < plotH; y++) {
      let n = 0;
      for (let x = W - AXIS_W; x < W; x++) {
        const i = (y * W + x) * 4;
        if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) n++;
      }
      if (n > best) { best = n; priceY = y; }
    }

    /*
     * Classify by matching the five inferno class colours directly.
     *
     * Classifying by exclusion does not work: the raster carries its class alpha in the
     * alpha channel, so getImageData returns each class at close to its pure RGB, and a
     * "looks like a teal candle" test (g > r, b > 150) swallows the brightest heat class
     * (252,255,164) whole. Matching the known palette keeps heat and candles apart.
     */
    const CLASS_RGB = [
      [59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164],
    ];
    const classOfPixel = (r, g, b) => {
      for (let k = 0; k < CLASS_RGB.length; k++) {
        const c = CLASS_RGB[k];
        if (Math.abs(r - c[0]) <= 10 && Math.abs(g - c[1]) <= 10 && Math.abs(b - c[2]) <= 10) return k;
      }
      return -1;
    };

    let paintedA = 0, paintedB = 0, hotA = 0, hotB = 0, cellsA = 0, cellsB = 0;
    for (let y = 0; y < plotH; y++) {
      // Skip the price line itself and its immediate neighbours.
      if (Math.abs(y - priceY) < 3 * dpr) continue;
      const above = y < priceY;
      for (let x = 0; x < plotW; x++) {
        const i = (y * W + x) * 4;
        const k = classOfPixel(d[i], d[i + 1], d[i + 2]);
        if (above) cellsA++; else cellsB++;
        if (k < 0) continue;
        if (above) { paintedA++; if (k >= 3) hotA++; }
        else { paintedB++; if (k >= 3) hotB++; }
      }
    }
    return { priceY: priceY / dpr, paintedA, paintedB, hotA, hotB, cellsA, cellsB };
  });

const ticks = () =>
  page.evaluate(() => {
    const raw = document.querySelector('.chart__canvas')?.getAttribute('data-ticks') ?? '';
    return raw
      ? raw.split('|').map((s) => {
          const at = s.lastIndexOf('@');
          return { label: s.slice(0, at), time: Number(s.slice(at + 1)) };
        })
      : [];
  });

const setDecay = async (on) => {
  await page.evaluate((want) => {
    document.querySelector('.toolbar button[aria-label="Settings"], .btn--icon')?.click();
  }, on);
  // Drive the checkbox directly through React's own change handler.
  await page.evaluate((want) => {
    const boxes = [...document.querySelectorAll('.drawer input[type="checkbox"]')];
    const label = boxes.find((b) => /Level decay/.test(b.closest('label')?.textContent ?? ''));
    if (label && label.checked !== want) label.click();
    document.querySelector('.drawer button[aria-label="Close settings"]')?.click();
  }, on);
  await new Promise((r) => setTimeout(r, 5000));
};

const pctf = (x) => `${(100 * x).toFixed(2)}%`;
const report = (name, s) => {
  console.log(`  ${name}`);
  console.log(`    painted above ${pctf(s.paintedA / s.cellsA)}   below ${pctf(s.paintedB / s.cellsB)}   ratio ${(s.paintedA / Math.max(1, s.paintedB)).toFixed(2)}`);
  console.log(`    top-class above ${pctf(s.hotA / s.cellsA)}   below ${pctf(s.hotB / s.cellsB)}   gap ${(s.hotB / s.cellsB / Math.max(1e-9, s.hotA / s.cellsA)).toFixed(1)}x`);
};

console.log(`\n${SYMBOL} ${INTERVAL} — live at ${BASE}\n${'='.repeat(66)}`);

const on = await sample();
report('DECAY ON (default)', on);
await page.screenshot({ path: `docs/screenshots/decay-on-${SYMBOL.toLowerCase()}-${INTERVAL}.png` });

// ---- axis checks, done while decay is on ----
const t0 = await ticks();
const boundary = (t) => {
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
};
console.log(`\n  TIME AXIS`);
console.log(`    ticks: ${t0.map((t) => t.label).join('  ')}`);
console.log(`    all on local calendar boundaries: ${t0.every((t) => boundary(t.time))}`);
console.log(`    labels unique: ${new Set(t0.map((t) => t.label)).size === t0.length}`);

// Pan left by dragging the plot, then confirm surviving ticks kept their dates and labels.
await page.evaluate(async () => {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const y = r.top + r.height * 0.4;
  const from = r.left + r.width * 0.25;
  const to = r.left + r.width * 0.72;
  const ev = (t, x) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 31, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  ev('pointerdown', from);
  for (let s = 1; s <= 14; s++) { ev('pointermove', from + ((to - from) * s) / 14); await new Promise((r2) => setTimeout(r2, 45)); }
  ev('pointerup', to);
});
await new Promise((r) => setTimeout(r, 2500));
const t1 = await ticks();
const survivors = t0.filter((a) => t1.some((b) => b.time === a.time));
const glued = survivors.every((a) => t1.find((b) => b.time === a.time).label === a.label);
console.log(`    after panning: ${t1.map((t) => t.label).join('  ')}`);
console.log(`    ticks surviving the pan: ${survivors.length}, all keeping their label: ${glued}`);

// Pan to the left edge to trigger a history prepend, then compare the ticks either side of
// the prepend WITHOUT panning in between: the view is meant to shift with the new columns,
// so the visible dates — and therefore every tick — must come through untouched.
const candleCount = async () =>
  Number(/(\d+)\s+candles/.exec(await page.evaluate(() => document.querySelector('.status')?.textContent ?? ''))?.[1] ?? 0);

const beforeN = await candleCount();
await page.evaluate(async () => {
  const cv = document.querySelector('.chart__canvas');
  const r = cv.getBoundingClientRect();
  const y = r.top + r.height * 0.4;
  const from = r.left + r.width * 0.15;
  const to = r.left + r.width * 0.95;
  const ev = (t, x) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 32, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  ev('pointerdown', from);
  for (let s = 1; s <= 12; s++) { ev('pointermove', from + ((to - from) * s) / 12); await new Promise((r2) => setTimeout(r2, 40)); }
  ev('pointerup', to);
});
await new Promise((r) => setTimeout(r, 400));

const preTicks = await ticks();
let afterN = beforeN;
for (let k = 0; k < 40 && afterN === beforeN; k++) {
  await new Promise((r) => setTimeout(r, 400));
  afterN = await candleCount();
}
await new Promise((r) => setTimeout(r, 1200));
const t2 = await ticks();
const survivors2 = preTicks.filter((a) => t2.some((b) => b.time === a.time));
const glued2 = survivors2.every((a) => t2.find((b) => b.time === a.time).label === a.label);
console.log(`    candles: ${beforeN} -> ${afterN} (backfill prepend)`);
console.log(`    ticks before prepend: ${preTicks.map((t) => t.label).join('  ')}`);
console.log(`    ticks after prepend:  ${t2.map((t) => t.label).join('  ')}`);
console.log(`    all on calendar boundaries: ${t2.every((t) => boundary(t.time))}, surviving: ${survivors2.length}/${preTicks.length}, labels glued: ${glued2}`);
await page.screenshot({ path: `docs/screenshots/axis-panned-${SYMBOL.toLowerCase()}-${INTERVAL}.png` });

// ---- decay off ----
await page.evaluate(() => document.querySelector('.chart__refit')?.click());
await new Promise((r) => setTimeout(r, 1200));
await setDecay(false);
const off = await sample();
console.log('');
report('DECAY OFF', off);
await page.screenshot({ path: `docs/screenshots/decay-off-${SYMBOL.toLowerCase()}-${INTERVAL}.png` });

console.log(`\n  top-class density above price: ${pctf(off.hotA / off.cellsA)} (decay off) -> ${pctf(on.hotA / on.cellsA)} (decay on)`);
console.log(`  above:below top-class gap:     ${(off.hotB / off.cellsB / Math.max(1e-9, off.hotA / off.cellsA)).toFixed(1)}x (off) -> ${(on.hotB / on.cellsB / Math.max(1e-9, on.hotA / on.cellsA)).toFixed(1)}x (on)`);

await browser.close();
