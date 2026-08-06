import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker only ever caches the app shell, so registering it cannot serve stale
// market data. It lives in `public/` rather than the bundle so it is emitted at the site
// root, where its scope covers navigations instead of just `/assets/`.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline shell is a bonus, not a requirement.
    });
  });
}
