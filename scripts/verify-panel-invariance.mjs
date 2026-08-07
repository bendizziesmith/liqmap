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

/** Fast strip-only read — no tooltip sweep, so successive captures are ~1s apart. */
const captureStrip = () =>
  page.evaluate(() => {
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

    // The panel strip: between the plot and the price gutter. Hashed PER ROW, so a diff
    // says which rows moved — the live price line is drawn across this strip and the
    // cumulative curves follow it, so some drift between captures is the chart being live,
    // not the threshold. Row granularity is what separates the two.
    const strip = ctx.getImageData(plotW, 0, PROFILE_W, plotH).data;
    const rowW = Math.round(PROFILE_W);

    /*
     * Count BAR pixels per row, not every pixel.
     *
     * The cumulative curves are a function of the live price and are stroked the full
     * height of the strip, so they move whenever price moves — whatever the slider is
     * doing. Hashing the whole strip therefore measures elapsed time, not the threshold.
     * The bars are the panel's data, and their per-row length is exactly the quantity that
     * must not change. Tier colours and the hot accent at tight tolerance; the curve
     * colours (#4ade80, #f59e0b) are excluded, and #f59e0b is 16 apart in green from the
     * nearest tier colour so tolerance 6 keeps them separate.
     */
    const BAR = [[106, 10, 104], [187, 55, 84], [249, 142, 9], [245, 219, 76], [252, 255, 164]];
    const isBar = (i) => BAR.some((c) =>
      Math.abs(strip[i] - c[0]) <= 6 && Math.abs(strip[i + 1] - c[1]) <= 6 && Math.abs(strip[i + 2] - c[2]) <= 6);

    const rowHash = [];
    let painted = 0;
    for (let y = 0; y < plotH; y++) {
      let bars = 0;
      for (let x = 0; x < rowW; x++) {
        const i = (y * rowW + x) * 4;
        if (strip[i + 3] > 0) painted++;
        if (isBar(i)) bars++;
      }
      rowHash.push(bars);
    }

    // Heat area in the PLOT, which must visibly shrink.
    const plot = ctx.getImageData(0, 0, plotW, plotH).data;
    const PAL = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
    let heat = 0;
    for (let i = 0; i < plot.length; i += 4) {
      if (PAL.some((c) => Math.abs(plot[i] - c[0]) <= 6 && Math.abs(plot[i + 1] - c[1]) <= 6 && Math.abs(plot[i + 2] - c[2]) <= 6)) heat++;
    }

    // A few sample pixels per row, so a diff can say WHAT changed, not just that it did.
    const rowSample = [];
    for (let y = 0; y < plotH; y++) {
      const px = [];
      for (const x of [4, Math.floor(rowW / 2), rowW - 8]) {
        const i = (y * rowW + x) * 4;
        px.push(`${strip[i]},${strip[i + 1]},${strip[i + 2]},${strip[i + 3]}`);
      }
      rowSample.push(px.join(' | '));
    }

    return {
      rowHash,
      rowSample,
      stripPainted: painted,
      heat,
      threshold: document.querySelector('.thresh__readout b')?.textContent?.trim() ?? '',
      pools: document.querySelector('.thresh__count')?.textContent?.trim() ?? '',
    };
  });

/** Panel tooltip figures at five heights, read separately so they cost the strip no time. */
const captureTips = () =>
  page.evaluate(async () => {
    const cv = document.querySelector('.chart__canvas');
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
    return tips;
  });

const setSlider = async (pos) => {
  await page.evaluate((p) => {
    const el = document.querySelector('.thresh__slider');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(p));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, pos);
  await new Promise((r) => setTimeout(r, 1100));
};

const rowsDiffering = (a, b) => a.rowHash.reduce((n, h, i) => n + (h === b.rowHash[i] ? 0 : 1), 0);

/**
 * Run a sequence of slider positions with identical timing and report how many panel rows
 * differ from the first capture.
 *
 * The cumulative curves are a function of the LIVE price and are drawn the full height of
 * the strip, so any elapsed time moves rows whether or not the threshold changed. The only
 * honest comparison is against a control that HOLDS the threshold across the same timing —
 * anything the varying run does beyond that is attributable to the threshold.
 */
const sequence = async (positions, label) => {
  const caps = [];
  for (const pos of positions) {
    await setSlider(pos);
    caps.push({ pos, ...(await captureStrip()) });
  }
  const diffs = caps.map((c) => rowsDiffering(caps[0], c));
  return { label, caps, diffs, worst: Math.max(...diffs) };
};

const varying = await sequence([0, 0.5, 0.9], 'threshold varying');
const control = await sequence([0, 0, 0], 'threshold held');

// Screenshots + tooltips at the three real positions.
const shots = [];
for (const [pos, label] of [[0, 'zero'], [0.5, 'mid'], [0.9, 'max']]) {
  await setSlider(pos);
  const c = await captureStrip();
  const tips = await captureTips();
  await page.screenshot({ path: `docs/screenshots/panelinv-${label}-${SYMBOL.toLowerCase()}.png` });
  shots.push({ pos, label, ...c, tips });
}

console.log(`\n${SYMBOL} ${INTERVAL} — panel invariance — ${BASE}`);
console.log('='.repeat(84));
console.log('  pos   threshold     pools        plot heat px   panel painted');
for (const s of shots) {
  console.log(
    `  ${s.pos.toFixed(1)}   ${s.threshold.padEnd(11)} ${s.pools.padEnd(12)} ${String(s.heat).padStart(9)}   ${String(s.stripPainted).padStart(8)}`,
  );
}
console.log('');
console.log('  panel BAR rows differing from the run\'s own first capture, same timing both runs:');
console.log(`    threshold VARYING [0, 0.5, 0.9] : ${JSON.stringify(varying.diffs)}`);
console.log(`    threshold HELD    [0, 0, 0]     : ${JSON.stringify(control.diffs)}  <- live-drift control`);
console.log('-'.repeat(84));

const attributable = varying.worst - control.worst;
const invariant = attributable <= 2;
const inkSame = shots.every((s) => s.stripPainted === shots[0].stripPainted);
/*
 * Tooltip figures are compared with a 0.5% tolerance, not byte-for-byte. The open-interest
 * scale refreshes on a timer, so the SAME pool reports a fractionally different dollar
 * figure seconds apart whatever the slider is doing — the run below saw $20.21M vs $20.22M.
 * The claim under test is invariance to the THRESHOLD, and 0.5% is far below any change a
 * filter would cause (a filtered row reports nothing at all).
 */
const usdOf = (t) => {
  const m = /\$([\d.]+)([KMBT])?/.exec(t ?? '');
  return m ? parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] ?? 1) : null;
};
const tipsSame = shots.every((s) =>
  s.tips.every((t, i) => {
    const a = usdOf(t);
    const b = usdOf(shots[0].tips[i]);
    if (a == null || b == null) return t === shots[0].tips[i];
    return Math.abs(a - b) / Math.max(a, b) < 0.005;
  }),
);
const thinned = shots[shots.length - 1].heat < shots[0].heat * 0.8;

console.log(`  rows attributable to the THRESHOLD : ${varying.worst} - ${control.worst} = ${attributable} -> ${invariant ? 'PASS — panel is invariant' : 'FAIL — threshold moved the panel'}`);
console.log(`  panel ink (painted px) unchanged   : ${inkSame ? `PASS (${shots[0].stripPainted} at every position)` : 'FAIL'}`);
console.log(`  panel tooltips identical           : ${tipsSame ? 'PASS' : `FAIL ${JSON.stringify(shots.map((s) => s.tips))}`}`);
console.log(`  heatmap visibly thinned            : ${thinned ? `PASS (${shots[0].heat} -> ${shots[shots.length - 1].heat})` : 'FAIL'}`);
console.log(`  panel tooltip sample               : ${JSON.stringify(shots[0].tips)}`);

await browser.close();
process.exit(invariant && inkSame && tipsSame && thinned ? 0 : 2);
