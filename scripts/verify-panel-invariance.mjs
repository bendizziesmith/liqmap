/**
 * The panel is the baseline, so it must not move when the threshold does.
 *
 * Drags the slider across three positions and, at each, captures the side-panel strip
 * pixel-for-pixel plus every panel tooltip figure. The strip must be byte-identical while
 * the heatmap visibly thins — that contrast is the whole point of the control.
 *
 * Usage: node scripts/verify-panel-invariance.mjs [baseUrl] [symbol] [interval]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'BTCUSDT';
const INTERVAL = process.argv[4] ?? '4h';

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

const capture = () =>
  page.evaluate(async () => {
    const cv = document.querySelector('.chart__canvas');
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const dpr = window.devicePixelRatio || 1;
    const AXIS_W = 62 * dpr;
    const PROFILE_W = 90 * dpr;
    const AXIS_H = 22 * dpr;
    const plotW = W - AXIS_W - PROFILE_W;
    const plotH = H - AXIS_H;

    // The panel strip: between the plot and the price gutter.
    const strip = ctx.getImageData(plotW, 0, PROFILE_W, plotH).data;
    let hash = 0;
    let painted = 0;
    for (let i = 0; i < strip.length; i += 4) {
      if (strip[i + 3] > 0) painted++;
      // FNV-ish rolling hash over the whole strip.
      hash = (hash * 16777619 + strip[i] + strip[i + 1] * 3 + strip[i + 2] * 7 + strip[i + 3] * 11) >>> 0;
    }

    // Heat area in the PLOT, which must visibly shrink.
    const plot = ctx.getImageData(0, 0, plotW, plotH).data;
    const PAL = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
    let heat = 0;
    for (let i = 0; i < plot.length; i += 4) {
      if (PAL.some((c) => Math.abs(plot[i] - c[0]) <= 6 && Math.abs(plot[i + 1] - c[1]) <= 6 && Math.abs(plot[i + 2] - c[2]) <= 6)) heat++;
    }

    // Panel tooltip figures at five heights.
    const r = cv.getBoundingClientRect();
    const cssPlotW = r.width - 62 - 90;
    const cssPlotH = r.height - 22;
    const tips = [];
    for (const f of [0.15, 0.3, 0.5, 0.7, 0.85]) {
      cv.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 21, clientX: r.left + cssPlotW + 45, clientY: r.top + cssPlotH * f,
        bubbles: true, isPrimary: true,
      }));
      await new Promise((z) => setTimeout(z, 160));
      const tip = document.querySelector('.tip');
      const rows = tip ? [...tip.querySelectorAll('.tip__row')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()) : [];
      tips.push(rows.find((x) => x.startsWith('total est.')) ?? '(none)');
    }
    cv.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 21, bubbles: true }));
    await new Promise((z) => setTimeout(z, 250));

    return {
      stripHash: hash,
      stripPainted: painted,
      heat,
      tips,
      threshold: document.querySelector('.thresh__readout b')?.textContent?.trim() ?? '',
      pools: document.querySelector('.thresh__count')?.textContent?.trim() ?? '',
    };
  });

const setSlider = async (pos) => {
  await page.evaluate((p) => {
    const el = document.querySelector('.thresh__slider');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(p));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, pos);
  await new Promise((r) => setTimeout(r, 1100));
};

const shots = [];
for (const [pos, label] of [[0, 'zero'], [0.5, 'mid'], [0.9, 'max']]) {
  await setSlider(pos);
  const c = await capture();
  await page.screenshot({ path: `docs/screenshots/panelinv-${label}-${SYMBOL.toLowerCase()}.png` });
  shots.push({ pos, label, ...c });
}

console.log(`\n${SYMBOL} ${INTERVAL} — panel invariance — ${BASE}`);
console.log('='.repeat(82));
console.log('  pos   threshold     pools       plot heat px   panel strip hash   panel painted');
for (const s of shots) {
  console.log(
    `  ${s.pos.toFixed(1)}   ${s.threshold.padEnd(11)} ${s.pools.padEnd(11)} ${String(s.heat).padStart(9)}   ` +
      `${String(s.stripHash).padStart(12)}   ${String(s.stripPainted).padStart(8)}`,
  );
}
const base = shots[0];
const identical = shots.every((s) => s.stripHash === base.stripHash && s.stripPainted === base.stripPainted);
const tipsSame = shots.every((s) => s.tips.every((t, i) => t === base.tips[i]));
const thinned = shots[shots.length - 1].heat < base.heat * 0.8;
console.log('-'.repeat(82));
console.log(`  panel strip byte-identical across all three : ${identical ? 'PASS' : 'FAIL'}`);
console.log(`  panel tooltips identical across all three   : ${tipsSame ? 'PASS' : `FAIL ${JSON.stringify(shots.map((s) => s.tips))}`}`);
console.log(`  heatmap visibly thinned                     : ${thinned ? `PASS (${base.heat} -> ${shots[shots.length - 1].heat})` : 'FAIL'}`);
console.log(`  panel tooltip sample                        : ${JSON.stringify(base.tips)}`);

await browser.close();
process.exit(identical && tipsSame && thinned ? 0 : 2);
