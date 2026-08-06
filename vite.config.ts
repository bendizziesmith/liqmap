import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Short identifier for the running build, surfaced in Settings.
 *
 * Netlify sets COMMIT_REF during CI; locally it falls back to git. Without it, "are you on
 * the current build?" is unanswerable, which is exactly the question a stale service worker
 * makes you ask.
 */
function buildId(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

// `base: './'` keeps every asset URL relative. That is what allows the exact same
// `dist/` to be served from a web host today and from Capacitor's `capacitor://`
// file origin later without a rebuild.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
  server: {
    // Named rather than disabling the host check outright: lets a containerised browser
    // (and a phone on the LAN) reach the dev server without dropping the protection.
    allowedHosts: ['host.docker.internal', 'localhost'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
