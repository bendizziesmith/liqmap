/**
 * Is the minimum-pool slider usable? Four questions, measured not guessed:
 *
 *   (a) which build is live, and does it carry the anchored-span fix
 *   (b) sensitivity — pools surviving at 10 evenly spaced positions; flat stretches mean
 *       the mapping wastes travel
 *   (c) does raising the threshold RECOLOUR survivors (it must not — the class ladder has
 *       to come from the unfiltered visible set)
 *   (d) does it update during drag (input) or only on release (change)
 *
 * Usage: node scripts/diagnose-slider.mjs [baseUrl] [symbol] [interval] [label]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'BTCUSDT';
const INTERVAL = process.argv[4] ?? '4h';
const LABEL = process.argv[5] ?? 'now';

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
    localStorage.removeItem(`liqmap.threshold.${sym}:${iv}`);
  },
  SYMBOL, INTERVAL,
);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
  { timeout: 90_000 },
);
await new Promise((r) => setTimeout(r, 5000));

const buildId = await page.evaluate(async () => {
  document.querySelector('button[aria-label="Open settings"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const id = document.querySelector('.drawer__build code')?.textContent?.trim() ?? null;
  document.querySelector('.drawer button[aria-label="Close settings"]')?.click();
  return id;
});

/**
 * Three fixed probe points, chosen on bands that are painted at threshold 0 and sit well
 * apart. Their colours are sampled at every threshold: a survivor must keep its exact
 * colour, or the chart reads as mutating rather than thinning.
 */
const probes = await page.evaluate(() => {
  const cv = document.querySelector('.chart__canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width;
  const plotW = W - 62 - 90;
  const plotH = cv.height - 22;
  const PAL = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
  const cls = (i) => PAL.findIndex((c) =>
    Math.abs(d[i] - c[0]) <= 2 && Math.abs(d[i + 1] - c[1]) <= 2 && Math.abs(d[i + 2] - c[2]) <= 2);
  // Pick the brightest pixel in each of three widely separated bands; bright ones survive
  // a high threshold, so the comparison is meaningful across the whole sweep.
  const out = [];
  for (const frac of [0.2, 0.45, 0.72]) {
    let best = null;
    const x = Math.floor(plotW * 0.35);
    for (let y = Math.floor(plotH * frac); y < Math.floor(plotH * (frac + 0.12)); y++) {
      const i = (y * W + x) * 4;
      const k = cls(i);
      if (k >= 0 && (!best || k > best.k)) best = { x, y, k };
    }
    if (best) out.push(best);
  }
  return out;
});

const sample = () =>
  page.evaluate((pts) => {
    const cv = document.querySelector('.chart__canvas');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const W = cv.width;
    return {
      colours: pts.map((p) => {
        const i = (p.y * W + p.x) * 4;
        return `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`;
      }),
      threshold: document.querySelector('.thresh__readout b')?.textContent?.trim() ?? '',
      pools: Number(/(\d+)/.exec(document.querySelector('.thresh__count')?.textContent ?? '')?.[1] ?? 0),
    };
  }, probes);

/** Set by position. `input` only — this is also the (d) responsiveness probe. */
const setSlider = async (pos, { fireChange = false } = {}) => {
  await page.evaluate((p, fc) => {
    const el = document.querySelector('.thresh__slider');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(p));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (fc) el.dispatchEvent(new Event('change', { bubbles: true }));
  }, pos, fireChange);
  await new Promise((r) => setTimeout(r, 850));
};

console.log(`\n${SYMBOL} ${INTERVAL} — slider diagnosis (${LABEL}) — ${BASE}`);
console.log(`  build: ${buildId}`);
console.log('='.repeat(78));
console.log('  pos   threshold      pools   drop   probe colours (must not change)');
console.log('-'.repeat(78));

const rows = [];
let base = null;
for (let i = 0; i <= 10; i++) {
  const pos = i / 10;
  await setSlider(pos);
  const s = await sample();
  if (i === 0) base = s.colours;
  const drop = rows.length ? rows[rows.length - 1].pools - s.pools : 0;
  rows.push({ pos, ...s });
  /*
   * Only probes that are still PAINTED can be compared. A probe the threshold has hidden
   * reads as fully transparent, which is the filter doing its job — counting that as a
   * recolour would fail the very behaviour under test.
   */
  const painted = s.colours.map((c, j) => [c, base[j]]).filter(([c]) => !c.endsWith(',0'));
  const stable = painted.length === 0 ? '(all hidden)' : painted.every(([c, b0]) => c === b0);
  console.log(
    `  ${pos.toFixed(1)}   ${s.threshold.padEnd(12)} ${String(s.pools).padStart(5)}  ${String(drop).padStart(5)}   ` +
      `${stable === true ? `stable (${painted.length} painted)` : stable === '(all hidden)' ? '(all hidden)' : `CHANGED ${JSON.stringify(s.colours)}`}`,
  );
}

// Sensitivity: how evenly does travel translate into pools removed?
const drops = rows.slice(1).map((r, i) => rows[i].pools - r.pools);
const flat = drops.filter((d) => d === 0).length;
const maxDrop = Math.max(...drops);
console.log('-'.repeat(78));
console.log(`  segments with ZERO effect      : ${flat} / ${drops.length}`);
console.log(`  biggest single-segment drop    : ${maxDrop} pools (${((100 * maxDrop) / rows[0].pools).toFixed(0)}% of all)`);
console.log(`  drops per segment              : ${JSON.stringify(drops)}`);
const stillPainted = rows.flatMap((r) => r.colours.map((c, j) => [c, base[j]]).filter(([c]) => !c.endsWith(',0')));
console.log(`  colour stability across sweep  : ${stillPainted.every(([c, b0]) => c === b0) ? `PASS — all ${stillPainted.length} painted probe samples kept their exact colour` : 'FAIL — survivors recoloured'}`);

// (d) responsiveness: does an `input` alone (no `change`) move the readout?
await setSlider(0);
const before = await sample();
await page.evaluate(() => {
  const el = document.querySelector('.thresh__slider');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '0.6');
  el.dispatchEvent(new Event('input', { bubbles: true })); // drag, not release
});
await new Promise((r) => setTimeout(r, 700));
const during = await sample();
console.log(`  updates during drag (input)    : ${during.threshold !== before.threshold ? `YES (${before.threshold} -> ${during.threshold})` : 'NO — release only'}`);

await browser.close();
