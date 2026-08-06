/**
 * Drive the heatmap back through history and report what each page costs.
 *
 * Panning left past the loaded edge should fetch older candles, keep the view anchored, and
 * stop at the cap. This measures candle count, the leftmost visible date, and JS heap after
 * every pan so a regression in any of the three is visible rather than inferred.
 *
 * Usage: node scripts/verify-backfill.mjs [baseUrl] [symbol] [interval]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'http://localhost:5177/';
const SYMBOL = process.argv[3] ?? 'BTCUSDT';
const INTERVAL = process.argv[4] ?? '4h';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--js-flags=--expose-gc'],
});

const page = await browser.newPage();

// Surface why a page request was skipped, and any Bybit error, instead of inferring it.
page.on('console', (m) => { if (/backfill|kline/i.test(m.text())) console.log('  [page]', m.text()); });
page.on('requestfailed', (r) => console.log('  [netfail]', r.url().slice(0, 90), r.failure()?.errorText));
page.on('response', async (r) => {
  if (!r.url().includes('/v5/market/kline')) return;
  if (r.status() !== 200) { console.log('  [http]', r.status(), r.url().slice(0, 90)); return; }
  try {
    const j = await r.json();
    if (j.retCode !== 0) console.log('  [bybit]', j.retCode, j.retMsg);
    else console.log('  [kline] rows=' + (j.result?.list?.length ?? 0));
  } catch { /* body already consumed */ }
});
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

await page.evaluateOnNewDocument((symbol, interval) => {
  localStorage.setItem('liqmap.view', JSON.stringify({
    symbol, interval, enabledTiers: [true, true, true, true],
    tab: 'heatmap', showProfile: true, colormap: 'inferno',
  }));
}, SYMBOL, INTERVAL);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 60_000 },
);
await new Promise((r) => setTimeout(r, 2500));

const probe = () => page.evaluate(async () => {
  const c = document.querySelector('.chart__canvas');
  const dpr = window.devicePixelRatio || 1;
  const plotW = c.width / dpr - 62 - 90;
  const plotH = c.height / dpr - 22;
  const rect = c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove', {
    pointerId: 900, clientX: rect.left + plotW * 0.02, clientY: rect.top + plotH * 0.5,
    bubbles: true, isPrimary: true }));
  await new Promise((r) => setTimeout(r, 220));
  const tip = document.querySelector('.tip');
  const m = /(\d+)\s+candles/.exec(document.querySelector('.status')?.textContent ?? '');
  // Force a collection first: without it the reading is dominated by repaint garbage that
  // has not been reclaimed yet, which says nothing about the steady-state footprint.
  if (typeof gc === 'function') { gc(); await new Promise((r) => setTimeout(r, 250)); }
  return {
    candles: m ? +m[1] : null,
    leftmost: tip ? tip.querySelector('.tip__row span').textContent.trim() : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
});

const pan = () => page.evaluate(async () => {
  const c = document.querySelector('.chart__canvas');
  const dpr = window.devicePixelRatio || 1;
  const plotW = c.width / dpr - 62 - 90;
  const plotH = c.height / dpr - 22;
  const rect = c.getBoundingClientRect();
  const id = Math.floor(Math.random() * 1e6);
  const ev = (t, x) => c.dispatchEvent(new PointerEvent(t, {
    pointerId: id, clientX: x, clientY: rect.top + plotH * 0.5, bubbles: true, isPrimary: true }));
  const x0 = rect.left + plotW * 0.15;
  ev('pointerdown', x0);
  for (let s = 1; s <= 8; s++) { ev('pointermove', x0 + s * 90); await new Promise((r) => setTimeout(r, 45)); }
  ev('pointerup', x0 + 720);
});

const start = await probe();
console.log(`start          ${String(start.candles).padStart(5)} candles  left=${start.leftmost}  heap=${start.heapMB}MB`);

let last = start;
for (let i = 1; i <= 40; i++) {
  await pan();
  // Fetch + full rebuild + the prepend cooldown.
  await new Promise((r) => setTimeout(r, 2600));
  const now = await probe();
  console.log(`after pan ${String(i).padStart(2)}   ${String(now.candles).padStart(5)} candles  left=${now.leftmost}  heap=${now.heapMB}MB`);
  last = now;
  if (now.candles >= 5000) { console.log('\nreached cap'); break; }
}

const crashed = await page.evaluate(() => !!document.querySelector('.chart__canvas')).catch(() => false);
console.log(`\nalive at end: ${crashed}`);
console.log(`grew from ${start.candles} to ${last.candles} candles`);
console.log(`heap ${start.heapMB}MB -> ${last.heapMB}MB`);

await browser.close();
