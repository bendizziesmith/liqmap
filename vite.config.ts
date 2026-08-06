import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps every asset URL relative. That is what allows the exact same
// `dist/` to be served from a web host today and from Capacitor's `capacitor://`
// file origin later without a rebuild.
export default defineConfig({
  base: './',
  plugins: [react()],
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
    include: ['src/**/*.test.ts'],
  },
});
