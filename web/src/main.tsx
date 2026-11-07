import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { httpApi } from './shared/api/api.ts';
import { App } from './app/index.ts';
import { applyStoredLanguage } from './shared/i18n/index.ts';
import './index.css';
import { applyStoredTheme } from './shared/lib/browser/theme.ts';

// The token lives in an HttpOnly cookie after the first load; keep it out of the address bar.
const url = new URL(window.location.href);
if (url.searchParams.has('token')) {
  url.searchParams.delete('token');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

applyStoredTheme();
applyStoredLanguage();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App api={httpApi} />
    </StrictMode>,
  );
}
