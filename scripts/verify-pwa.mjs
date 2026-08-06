/**
 * Verify the service worker against a served production build.
 *
 * Must run over http://localhost (a secure context); a LAN or container hostname over plain
 * http gives no `navigator.serviceWorker` at all.
 *
 * Asserts the shell is cached and, critically, that no Bybit market data ever is.
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] ?? 'http://localhost:5178/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE, { waitUntil: 'networkidle2' });

// Give the worker time to install and populate the cache.
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, {
  timeout: 20_000,
}).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));

const result = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const names = await caches.keys();
  const paths = [];
  for (const n of names) {
    const c = await caches.open(n);
    for (const req of await c.keys()) paths.push(req.url);
  }
  return {
    secureContext: window.isSecureContext,
    registered: Boolean(reg),
    scope: reg?.scope ?? null,
    controlled: navigator.serviceWorker.controller !== null,
    cacheNames: names,
    cachedUrls: paths,
  };
});

const bybitCached = result.cachedUrls.filter((u) => u.includes('bybit'));
const shellCached = result.cachedUrls.some((u) => u.endsWith('/') || u.includes('index.html'));

console.log(JSON.stringify({ ...result, bybitCached, shellCached }, null, 2));

await browser.close();

const failures = [];
if (!result.registered) failures.push('service worker did not register');
if (!shellCached) failures.push('app shell was not cached');
if (bybitCached.length > 0) failures.push(`market data was cached: ${bybitCached.join(', ')}`);

if (failures.length > 0) {
  console.error('\nFAIL:\n' + failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
console.log('\nPASS: shell cached, no market data cached.');
