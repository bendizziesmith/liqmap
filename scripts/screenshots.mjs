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
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');

const SHOTS = [
  { name: 'desktop.png', width: 1440, height: 900, dsf: 1 },
  { name: 'mobile.png', width: 390, height: 844, dsf: 2, mobile: true },
];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

for (const shot of SHOTS) {
  const page = await browser.newPage();
  await page.setViewport({
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.dsf,
    isMobile: Boolean(shot.mobile),
    hasTouch: Boolean(shot.mobile),
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // Wait until the engine has actually built a map — the status bar reports the count.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('.status');
        return el && /[1-9]\d*\s+candles/.test(el.textContent ?? '');
      },
      { timeout: 45_000 },
    )
    .catch(() => console.warn(`${shot.name}: timed out waiting for candles`));

  // Let the live price and the first paint settle.
  await new Promise((r) => setTimeout(r, 2500));

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) console.warn(`${shot.name}: horizontal overflow detected`);

  await page.screenshot({ path: join(OUT, shot.name) });
  console.log(`wrote ${shot.name} (${shot.width}x${shot.height})`);
  await page.close();
}

await browser.close();
