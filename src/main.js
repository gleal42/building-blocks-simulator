import { start } from './app.js';

function boot() {
  const hot = window.claude?.hot;
  if (hot?.ready) hot.ready(start);
  else start(hot?.data ?? {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
