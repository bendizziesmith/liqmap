/**
 * Reproduce the Map brush snapping back to its default window.
 *
 * Drags the brush to a distinctly non-default position, then samples its edges for several
 * seconds without touching it. If a background refresh is resetting the range, the edges
 * revert on their own and the elapsed time tells us how fast.
 *
 * Usage: node scripts/repro-brush.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('liqmap.view', JSON.stringify({
    symbol: 'XRPUSDT', interval: '1h', enabledTiers: [true, true, true, true],
    tab: 'map', showProfile: true, colormap: 'inferno',
  }));
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.querySelectorAll('.panel').length === 2 &&
        document.querySelectorAll('.panel__empty').length === 0,
  { timeout: 90_000 },
);
await new Promise((r) => setTimeout(r, 2500));

const report = await page.evaluate(async () => {
  const cv = document.querySelector('.panel__canvas');
  const dpr = window.devicePixelRatio || 1;
  const plotH = cv.height / dpr - 20 - 26 - 6;
  const brushTop = plotH + 20 + 6;
  const rect = cv.getBoundingClientRect();

  /** Visible bin window, published by the component. */
  const edges = () => {
    const raw = cv.getAttribute('data-brush');
    return raw ? raw.split(',').map(Number) : null;
  };
  const plotW = cv.width / dpr - 46;
  const xOfBin = (i) => (i / 200) * plotW;

  const ev = (t, x, id) => cv.dispatchEvent(new PointerEvent(t, {
    pointerId: id, clientX: x, clientY: rect.top + brushTop + 13, bubbles: true, isPrimary: true }));

  const before = edges();

  // Drag the right handle well inward — a window nothing would choose by default.
  const from = rect.left + xOfBin(before[1]);
  const to = rect.left + xOfBin(before[0] + (before[1] - before[0]) * 0.35);
  ev('pointerdown', from, 61);
  for (let s = 1; s <= 8; s++) { ev('pointermove', from + (to - from) * s / 8, 61); await new Promise((r) => setTimeout(r, 40)); }
  ev('pointerup', to, 61);
  await new Promise((r) => setTimeout(r, 350));

  const afterDrag = edges();

  // Now leave it completely alone and watch.
  const samples = [];
  const t0 = Date.now();
  let revertedAt = null;
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const e = edges();
    samples.push({ ms: Date.now() - t0, edges: e });
    if (revertedAt === null && e && afterDrag &&
        Math.abs(e[1] - afterDrag[1]) > 8) revertedAt = Date.now() - t0;
  }

  return { before, afterDrag, revertedAt, first8: samples.slice(0, 8), last: samples[samples.length - 1] };
});

console.log('default window (bins) :', report.before);
console.log('after dragging narrower:', report.afterDrag);
console.log('reverted after (ms)      :', report.revertedAt ?? 'never');
console.log('final edges              :', report.last.edges);
console.log('\nfirst samples:');
for (const s of report.first8) console.log(`  +${String(s.ms).padStart(4)}ms  ${JSON.stringify(s.edges)}`);

await browser.close();
