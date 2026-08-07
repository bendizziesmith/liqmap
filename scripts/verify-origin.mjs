/**
 * Real-browser verification that an origin serves a working app: heat renders, the socket
 * reaches Live, the Map tab loads, the service worker registers AND controls THIS origin
 * (no stale worker carried over from another host), and the console stays clean.
 *
 * Usage: node scripts/verify-origin.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'https://liqmap.smithblock.ai/';
const origin = new URL(BASE).origin;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const errors = [];
const check = async (width, height, mobile, label) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('liqmap.view', JSON.stringify({
      symbol: 'BTCUSDT', interval: '4h', enabledTiers: [true, true, true, true],
      tab: 'heatmap', showProfile: true, colormap: 'inferno',
    }));
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => /[1-9]\d*\s+candles/.test(document.querySelector('.status')?.textContent ?? ''),
    { timeout: 90_000 },
  );
  await new Promise((r) => setTimeout(r, 6000));

  const res = await page.evaluate(async (expectedOrigin) => {
    // Heat actually painted: count pixels matching the inferno class palette.
    const cv = document.querySelector('.chart__canvas');
    let heat = 0;
    if (cv) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const P = [[59,15,112],[140,41,129],[222,73,104],[252,165,10],[252,255,164]];
      for (let i = 0; i < d.length; i += 4) {
        if (P.some((c) => Math.abs(d[i]-c[0])<=10 && Math.abs(d[i+1]-c[1])<=10 && Math.abs(d[i+2]-c[2])<=10)) heat++;
      }
    }
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      heat,
      status: document.querySelector('.status')?.textContent?.trim() ?? '',
      swCount: regs.length,
      swScopes: regs.map((r) => r.scope),
      swControlled: Boolean(navigator.serviceWorker.controller),
      swControllerUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
      // A worker whose scope is not this origin would be a carried-over registration.
      swForeign: regs.filter((r) => !r.scope.startsWith(expectedOrigin)).map((r) => r.scope),
      canonical: document.querySelector('link[rel=canonical]')?.href ?? null,
      ogUrl: document.querySelector('meta[property="og:url"]')?.content ?? null,
    };
  }, origin);

  await page.screenshot({ path: `docs/screenshots/origin-${label}.png` });

  // Map tab loads.
  const mapOk = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Map');
    if (!btn) return 'no Map button';
    btn.click();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (document.querySelectorAll('.panel').length === 2 &&
          document.querySelectorAll('.panel__empty').length === 0) return 'ok';
    }
    return 'timeout';
  });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `docs/screenshots/origin-${label}-map.png` });
  await page.close();
  return { ...res, mapOk };
};

const desktop = await check(1440, 900, false, 'desktop');
const mobile = await check(390, 844, true, 'mobile');
await browser.close();

const line = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`\nOrigin verification — ${BASE}\n${'='.repeat(64)}`);
for (const [label, r] of [['DESKTOP 1440x900', desktop], ['MOBILE 390x844', mobile]]) {
  console.log(`\n${label}`);
  line('heat pixels painted', r.heat);
  line('status bar', r.status);
  line('Map tab', r.mapOk);
  line('SW registrations', `${r.swCount} ${JSON.stringify(r.swScopes)}`);
  line('SW controlling page', r.swControlled ? `yes (${r.swControllerUrl})` : 'no');
  line('foreign-origin SWs', r.swForeign.length ? JSON.stringify(r.swForeign) : 'none');
  line('canonical', r.canonical);
  line('og:url', r.ogUrl);
}
console.log(`\nconsole errors: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
