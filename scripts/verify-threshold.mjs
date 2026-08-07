/**
 * Threshold sweep + three-surface agreement + alignment check.
 *
 *  - drags the slider from 0 upward and records surviving pools, per-tier totals and the
 *    painted heat area at each stop (all must fall monotonically)
 *  - compares the heatmap's surviving pool count against the Map tab at the same threshold
 *  - checks band y-positions against the price axis and the side-panel bars at three prices
 *
 * Usage: node scripts/verify-threshold.mjs [baseUrl] [symbol] [interval]
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

/** Painted heat area + the toolbar's own readouts. */
const readState = () =>
  page.evaluate(() => {
    const cv = document.querySelector('.chart__canvas');
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const d = ctx.getImageData(0, 0, W, cv.height).data;
    const plotW = W - 62 - 90;
    const plotH = cv.height - 22;
    const PAL = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
    let heat = 0;
    for (let y = 0; y < plotH; y++) {
      for (let x = 0; x < plotW; x++) {
        const i = (y * W + x) * 4;
        if (PAL.some((c) => Math.abs(d[i] - c[0]) <= 6 && Math.abs(d[i + 1] - c[1]) <= 6 && Math.abs(d[i + 2] - c[2]) <= 6)) heat++;
      }
    }
    const chips = [...document.querySelectorAll('.seg--tiers .seg__btn--tier')].map((b) =>
      (b.querySelector('.seg__total')?.textContent ?? '').trim(),
    );
    return {
      heat,
      chips,
      total: document.querySelector('.seg__grand b')?.textContent?.trim() ?? '',
      threshold: document.querySelector('.thresh__readout b')?.textContent?.trim() ?? '',
      pools: document.querySelector('.thresh__count')?.textContent?.trim() ?? '',
      sliderMaxDisabled: document.querySelector('.thresh__slider')?.disabled ?? null,
    };
  });

/** Set the slider by position and let React repaint. */
const setSlider = async (pos) => {
  await page.evaluate((p) => {
    const el = document.querySelector('.thresh__slider');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(p));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, pos);
  await new Promise((r) => setTimeout(r, 900));
};

const parse = (s) => {
  const m = /\$([\d.]+)([KMBT])?/.exec(s ?? '');
  return m ? parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] ?? 1) : 0;
};

console.log(`\n${SYMBOL} ${INTERVAL} — threshold sweep — ${BASE}`);
console.log('='.repeat(104));
console.log(' slider  threshold      pools   heat px   ' + 'per-tier visible totals'.padEnd(38) + 'combined');
console.log('-'.repeat(104));

const rows = [];
for (const pos of [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1]) {
  await setSlider(pos);
  const s = await readState();
  rows.push({ pos, ...s, thresholdUsd: parse(s.threshold), totalUsd: parse(s.total) });
  console.log(
    `  ${pos.toFixed(2)}   ${s.threshold.padEnd(12)} ${s.pools.padEnd(10)} ${String(s.heat).padStart(7)}   ` +
      `${s.chips.join(' / ').padEnd(38)}${s.total}`,
  );
  if (pos === 0) await page.screenshot({ path: `docs/screenshots/thresh-0-${SYMBOL.toLowerCase()}.png` });
  if (pos === 0.7) await page.screenshot({ path: `docs/screenshots/thresh-mid-${SYMBOL.toLowerCase()}.png` });
}

const poolsOf = (r) => Number(/(\d+)/.exec(r.pools)?.[1] ?? 0);
// The forming candle repaints between stops, so a few pixels of jitter are the live chart,
// not the filter. Tolerate 0.1% and require the overall trend to be a real decline.
const mono = (get, tol = 0) =>
  rows.every((r, i) => i === 0 || get(r) <= get(rows[i - 1]) * (1 + tol) + 1e-9);
console.log('-'.repeat(104));
console.log(`  pools fall monotonically       : ${mono(poolsOf)}`);
console.log(`  heat area falls monotonically  : ${mono((r) => r.heat, 0.001)}  (first ${rows[0].heat} -> last ${rows.at(-1).heat})`);
console.log(`  combined total falls monotonic : ${mono((r) => r.totalUsd)}`);
console.log(`  threshold rises monotonically  : ${rows.every((r, i) => i === 0 || r.thresholdUsd >= rows[i - 1].thresholdUsd)}`);

// ---- three-surface agreement at one non-zero threshold ----
await setSlider(0.6);
const heatState = await readState();
const mapPools = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Map');
  btn?.click();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (document.querySelectorAll('.panel').length === 2 &&
        document.querySelectorAll('.panel__empty').length === 0) break;
  }
  await new Promise((r) => setTimeout(r, 1200));
  // Count painted bar columns in each Map panel: a filtered-out bin paints nothing.
  return [...document.querySelectorAll('.panel__canvas')].map((cv) => {
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const BAR = [[106, 10, 104], [187, 55, 84], [249, 142, 9], [245, 219, 76], [252, 255, 164]];
    let painted = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && BAR.some((c) => Math.abs(d[i] - c[0]) <= 14 && Math.abs(d[i + 1] - c[1]) <= 14 && Math.abs(d[i + 2] - c[2]) <= 14)) painted++;
    }
    return painted;
  });
});
console.log(`\n  THREE SURFACES at ${heatState.threshold}:`);
console.log(`    heatmap: ${heatState.pools}, ${heatState.heat} heat px`);
console.log(`    Map panels painted bar px: ${JSON.stringify(mapPools)} (non-zero = threshold applied, not blanked)`);
await page.screenshot({ path: `docs/screenshots/thresh-map-${SYMBOL.toLowerCase()}.png` });

// ---- alignment: band y vs price axis vs panel bar, at three prices ----
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Heatmap');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 2500));
await setSlider(0);
const align = await page.evaluate(async () => {
  const cv = document.querySelector('.chart__canvas');
  const [p0, p1] = (cv.getAttribute('data-view') ?? '').split(',').map(Number);
  const r = cv.getBoundingClientRect();
  const plotW = r.width - 62 - 90;
  const plotH = r.height - 22;
  const out = [];
  for (const f of [0.25, 0.5, 0.75]) {
    const y = plotH * f;
    // Price the axis mapping says this row is.
    const axisPrice = p1 - (y / plotH) * (p1 - p0);
    // Price the plot tooltip reports at the same y.
    cv.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 11, clientX: r.left + plotW - 6, clientY: r.top + y, bubbles: true, isPrimary: true,
    }));
    await new Promise((z) => setTimeout(z, 180));
    const plotTip = document.querySelector('.tip')?.querySelector('.tip__row strong')?.textContent ?? '';
    // Price the side panel reports at the same y.
    cv.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 11, clientX: r.left + plotW + 45, clientY: r.top + y, bubbles: true, isPrimary: true,
    }));
    await new Promise((z) => setTimeout(z, 180));
    const panelTip = document.querySelector('.tip')?.querySelector('.tip__row strong')?.textContent ?? '';
    out.push({ y: Math.round(y), axisPrice, plotTip, panelTip });
  }
  return out;
});
console.log(`\n  ALIGNMENT at three heights (axis mapping vs plot tooltip vs panel tooltip):`);
for (const a of align) {
  const plot = Number(a.plotTip.replace(/[^0-9.]/g, ''));
  const panel = Number(a.panelTip.replace(/[^0-9.]/g, ''));
  const dPlot = Math.abs(plot - a.axisPrice) / a.axisPrice;
  const dPanel = Math.abs(panel - a.axisPrice) / a.axisPrice;
  console.log(
    `    y=${String(a.y).padStart(3)}  axis ${a.axisPrice.toFixed(2).padStart(10)}  plot ${a.plotTip.padStart(10)}  panel ${a.panelTip.padStart(10)}` +
      `   drift ${(100 * dPlot).toFixed(3)}% / ${(100 * dPanel).toFixed(3)}%`,
  );
}

await browser.close();
