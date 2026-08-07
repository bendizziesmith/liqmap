import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The canonical origin lives in exactly one kind of place: static social/SEO metadata.
 * Runtime code must never name a host of ours — data paths are Bybit's API or relative —
 * so moving domains is a metadata edit, never a code change.
 */
const ORIGIN = 'https://liqmap.smithblock.ai';
const root = join(__dirname, '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('canonical origin metadata', () => {
  it('declares the canonical link on the new origin', () => {
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
  });

  it('points og:url and both social images at the new origin', () => {
    expect(html).toContain(`<meta property="og:url" content="${ORIGIN}/" />`);
    expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/og.png" />`);
    expect(html).toContain(`<meta name="twitter:image" content="${ORIGIN}/og.png" />`);
  });

  it('does not reference the netlify.app host anywhere in the shell', () => {
    expect(html).not.toContain('netlify.app');
  });
});

describe('no host is hardcoded in runtime data paths', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  it('src/ names no origin of ours — only Bybit endpoints and relative paths', () => {
    for (const file of walk(join(root, 'src'))) {
      if (!/\.(ts|tsx|css)$/.test(file) || file.endsWith('origin.test.ts')) continue;
      const body = readFileSync(file, 'utf8');
      expect(body, file).not.toMatch(/liqmap\.(netlify\.app|smithblock\.ai)/);
    }
  });

  it('the service worker keys on its own origin, not a named one', () => {
    const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
    expect(sw).toContain('self.location.origin');
    expect(sw).not.toMatch(/https?:\/\/liqmap/);
  });

  it('the manifest stays relative, so it works on any origin', () => {
    const man = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8'));
    expect(man.start_url).toBe('./');
    expect(man.scope).toBe('./');
    for (const icon of man.icons) expect(icon.src.startsWith('./')).toBe(true);
  });
});
