/**
 * Capture desktop and phone screenshots of the running app.
 *
 * Drives the system Chrome through puppeteer-core so the CSS viewport is set exactly.
 * Chrome's own `--headless --screenshot` was not usable here: it lays the page out at its
 * own width and crops to --window-size, so media queries match the wrong breakpoint.
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'http://localhost:5177/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');

const DESKTOP = { width: 1440, height: 900, dsf: 1 };
const PHONE = { width: 390, height: 844, dsf: 2, mobile: true };

const SHOTS = [
  { name: 'desktop.png', ...DESKTOP, view: { symbol: 'BTCUSDT', tab: 'heatmap', showProfile: true } },
  { name: 'mobile.png', ...PHONE, view: { symbol: 'BTCUSDT', tab: 'heatmap', showProfile: true } },
  { name: 'map-desktop.png', ...DESKTOP, view: { symbol: 'XRPUSDT', tab: 'map', showProfile: true } },
  { name: 'map-mobile.png', ...PHONE, view: { symbol: 'XRPUSDT', tab: 'map', showProfile: true } },
  // Social card: the real product at the 1.91:1 ratio scrapers expect. Written into
  // public/ so the build copies it to the site root.
  {
    name: 'classes-xrp.png',
    ...DESKTOP,
    view: { symbol: 'XRPUSDT', interval: '1h', tab: 'heatmap', showProfile: true, colormap: 'inferno' },
  },
  {
    name: 'classes-classic.png',
    ...DESKTOP,
    view: { symbol: 'XRPUSDT', interval: '1h', tab: 'heatmap', showProfile: true, colormap: 'classic' },
  },
  {
    name: 'og.png',
    width: 1200,
    height: 630,
    dsf: 1,
    dir: 'public',
    view: { symbol: 'BTCUSDT', tab: 'heatmap', showProfile: true },
  },
];

const BASE_VIEW = {
  symbol: 'BTCUSDT',
  interval: '4h',
  enabledTiers: [true, true, true, true],
  tab: 'heatmap',
  showProfile: true,
  colormap: 'inferno',
};

mkdirSync(OUT, { recursive: true });

// The social card is a build input, not documentation. Regenerating it from a deployed URL
// would dirty the tree and require another deploy to publish the change, so only rebuild it
// when shooting against a local dev server.
const isLocal = /localhost|127\.0\.0\.1/.test(BASE);
const shots = SHOTS.filter((s) => s.dir !== 'public' || isLocal);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

for (const shot of shots) {
  const page = await browser.newPage();
  await page.setViewport({
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.dsf,
    isMobile: Boolean(shot.mobile),
    hasTouch: Boolean(shot.mobile),
  });

  // Seed the persisted view so each shot lands on the surface it is meant to show.
  const view = JSON.stringify({ ...BASE_VIEW, ...shot.view });
  await page.evaluateOnNewDocument((v) => {
    localStorage.setItem('liqmap.view', v);
  }, view);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  const ready =
    shot.view.tab === 'map'
      ? // Both Map panels must have finished loading.
        () => document.querySelectorAll('.panel').length === 2 &&
              document.querySelectorAll('.panel__empty').length === 0
      : () => {
          const el = document.querySelector('.status');
          return el && /[1-9]\d*\s+candles/.test(el.textContent ?? '');
        };

  await page
    .waitForFunction(ready, { timeout: 60_000 })
    .catch(() => console.warn(`${shot.name}: timed out waiting for content`));

  // Let the live price and the first paint settle.
  await new Promise((r) => setTimeout(r, 2500));

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) console.warn(`${shot.name}: horizontal overflow detected`);

  const dest = shot.dir ? join(ROOT, shot.dir, shot.name) : join(OUT, shot.name);
  await page.screenshot({ path: dest });
  console.log(`wrote ${shot.dir ?? 'docs/screenshots'}/${shot.name} (${shot.width}x${shot.height})`);
  await page.close();
}

await browser.close();
