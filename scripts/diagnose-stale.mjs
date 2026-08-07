/**
 * Why is the user not seeing shipped defaults? Two candidates, both checked here:
 *   (a) persisted settings override new defaults — an old localStorage value wins forever
 *   (b) a stale service worker serves an older bundle
 *
 * Runs three states against the live site and reports, for each: the build ID actually
 * executing, the settings the app ended up with, and whether the raster rendered crisp.
 *
 * Usage: node scripts/diagnose-stale.mjs [baseUrl] [symbol] [interval]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const SYMBOL = process.argv[3] ?? 'BTCUSDT';
const INTERVAL = process.argv[4] ?? '4h';

/** The exact old-schema blob a user from the smoothing era would be carrying. */
const OLD_BLOB = {
  alertMinScore: 70,
  alertDistancePct: 1.5,
  alertsEnabled: false,
  levelDecay: true,
  smoothRendering: true,
  wickClearing: 'partial',
  standingShare: 'highLeverage',
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

/** Blur share: heat pixels that are NOT an exact palette colour can only be interpolation. */
function measure() {
  const cv = document.querySelector('.chart__canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const d = ctx.getImageData(0, 0, W, cv.height).data;
  const plotW = W - 62 - 90;
  const plotH = cv.height - 22;
  const PAL = [[59, 15, 112], [140, 41, 129], [222, 73, 104], [252, 165, 10], [252, 255, 164]];
  const near = (r, g, b, tol) => PAL.some((c) => Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol);
  let exact = 0;
  let interp = 0;
  const alphas = new Set();
  for (let y = 0; y < plotH; y++) {
    for (let x = 0; x < plotW; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] === 0) continue;
      if (near(d[i], d[i + 1], d[i + 2], 2)) { exact++; alphas.add(d[i + 3]); }
      else if (near(d[i], d[i + 1], d[i + 2], 40)) interp++;
    }
  }
  return {
    blurShare: exact + interp > 0 ? interp / (exact + interp) : 0,
    distinctAlphas: alphas.size,
    settings: JSON.parse(localStorage.getItem('liqmap.settings') ?? 'null'),
  };
}

/** Build ID as the running bundle reports it, read from the Settings panel. */
async function readBuildId(page) {
  return page.evaluate(async () => {
    const open = document.querySelector('button[aria-label="Open settings"]');
    open?.click();
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('.note--build code, .drawer__build code, .drawer code');
    const id = el?.textContent?.trim() ?? null;
    const wick = [...document.querySelectorAll('.drawer .seg__btn')]
      .filter((b) => /Partial|Full/.test(b.textContent ?? ''))
      .map((b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`);
    const smoothCtl = [...document.querySelectorAll('.drawer label')]
      .some((l) => /Smooth rendering/.test(l.textContent ?? ''));
    document.querySelector('.drawer button[aria-label="Close settings"]')?.click();
    return { id, wick, smoothControlPresent: smoothCtl };
  });
}

async function run(label, seed, { reloadTwice = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(
    (sym, iv, blob) => {
      localStorage.setItem('liqmap.view', JSON.stringify({
        symbol: sym, interval: iv, enabledTiers: [true, true, true, true],
        tab: 'heatmap', showProfile: true, colormap: 'inferno',
      }));
      if (blob) localStorage.setItem('liqmap.settings', JSON.stringify(blob));
      else localStorage.removeItem('liqmap.settings');
    },
    SYMBOL, INTERVAL, seed,
  );

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
    { timeout: 90_000 },
  );
  await new Promise((r) => setTimeout(r, 4000));

  if (reloadTwice) {
    // An ORDINARY reload — no cache bypass. This is the whole question for a stale SW.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
      { timeout: 90_000 },
    );
    await new Promise((r) => setTimeout(r, 4000));
  }

  const m = await page.evaluate(measure);
  const b = await readBuildId(page);
  const sw = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    return { count: regs.length, controlled: Boolean(navigator.serviceWorker.controller) };
  });
  await page.screenshot({ path: `docs/screenshots/state-${label}-${SYMBOL.toLowerCase()}.png` });
  await page.close();
  return { label, ...m, ...b, sw };
}

const states = [];
states.push(await run('a-fresh', null));
states.push(await run('b-oldschema', OLD_BLOB));
states.push(await run('c-reload', OLD_BLOB, { reloadTwice: true }));

console.log(`\n${SYMBOL} ${INTERVAL} — ${BASE}`);
console.log('='.repeat(94));
for (const s of states) {
  console.log(`\n[${s.label}]`);
  console.log(`  build id in Settings   : ${s.id}`);
  console.log(`  blur share             : ${(100 * s.blurShare).toFixed(2)}%   distinct alphas: ${s.distinctAlphas}`);
  console.log(`  verdict                : ${s.blurShare < 0.05 ? 'CRISP' : 'SMOOTH — not shipped defaults'}`);
  console.log(`  wick control           : ${JSON.stringify(s.wick)}  (* = pressed)`);
  console.log(`  smooth control present : ${s.smoothControlPresent}`);
  console.log(`  stored settings        : ${JSON.stringify(s.settings)}`);
  console.log(`  service worker         : ${s.sw.count} reg, controlled=${s.sw.controlled}`);
}

await browser.close();
