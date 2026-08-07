/**
 * Read the displayed USD figures back off the chart and compare them with Bybit's own
 * open-interest value for the same symbol.
 *
 * The calibration claim is that the active unswept book totals about OI, so the cumulative
 * curves — which cover whatever slice of that book is on screen — must sit at or below it.
 *
 * Usage: node scripts/verify-usd.mjs [baseUrl] [symbol] [interval]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'XRPUSDT';
const INTERVAL = process.argv[4] ?? '1h';

const oiRes = await fetch(
  `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${SYMBOL}`,
).then((r) => r.json());
const oiValue = Number(oiRes.result.list[0].openInterestValue);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
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
await new Promise((r) => setTimeout(r, 3500));

const result = await page.evaluate(async () => {
  const c = document.querySelector('.chart__canvas');
  const dpr = window.devicePixelRatio || 1;
  const plotW = c.width / dpr - 62 - 90;
  const plotH = c.height / dpr - 22;
  const axisX = plotW + 90;
  const rect = c.getBoundingClientRect();
  const ev = (t, x, y, id = 500) => c.dispatchEvent(new PointerEvent(t, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true }));
  const parse = (s) => {
    const m = /\$([\d.]+)([KMBT])?/.exec(s || '');
    if (!m) return 0;
    return parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] ?? 1);
  };

  // Zoom the price axis right out so the panel covers as much of the book as possible.
  const ax = rect.left + axisX + 20;
  const ay = rect.top + plotH * 0.5;
  ev('pointerdown', ax, ay, 501);
  for (let s = 1; s <= 14; s++) { ev('pointermove', ax, ay + s * 26, 501); await new Promise((r) => setTimeout(r, 40)); }
  ev('pointerup', ax, ay + 364, 501);
  await new Promise((r) => setTimeout(r, 800));

  let cumLong = 0, cumShort = 0, biggest = 0, biggestTip = null;
  for (let y = 4; y < plotH - 4; y += 4) {
    ev('pointermove', rect.left + plotW + 45, rect.top + y);
    await new Promise((r) => setTimeout(r, 20));
    const tip = document.querySelector('.tip');
    if (!tip) continue;
    const rows = [...tip.querySelectorAll('.tip__row')].map((r) => r.innerText.replace(/\n/g, ' '));
    cumLong = Math.max(cumLong, parse(rows.find((r) => r.startsWith('cum. longs')) ?? ''));
    cumShort = Math.max(cumShort, parse(rows.find((r) => r.startsWith('cum. shorts')) ?? ''));
    const tot = parse(rows.find((r) => r.startsWith('total est.')) ?? '');
    if (tot > biggest) { biggest = tot; biggestTip = rows.join(' | '); }
  }
  return { cumLong, cumShort, biggest, biggestTip };
});

const fmt = (v) => `$${(v / 1e6).toFixed(1)}M`;
console.log(`${SYMBOL} ${INTERVAL} on ${BASE}`);
console.log(`  Bybit openInterestValue   ${fmt(oiValue)}`);
console.log(`  cumulative longs (max)    ${fmt(result.cumLong)}`);
console.log(`  cumulative shorts (max)   ${fmt(result.cumShort)}`);
console.log(`  both sides                ${fmt(result.cumLong + result.cumShort)}  = ${((result.cumLong + result.cumShort) / oiValue * 100).toFixed(0)}% of OI`);
console.log(`  heaviest single level     ${fmt(result.biggest)}`);
console.log(`  heaviest tooltip: ${result.biggestTip}`);

await browser.close();
