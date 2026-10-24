// v5: network-first for the app shell (so updates arrive immediately), cache only as an offline fallback.
// API calls (/api/*) are never cached — financial data always comes live from the server.
const CACHE = 'cms-kharidi-v5.1';
const SHELL = ['/', '/index.html', '/style.css', '/manifest.webmanifest', '/icon.svg',
  '/js/main.js', '/js/api.js', '/js/ui.js', '/js/state.js', '/js/forms.js', '/js/pages.js', '/js/reports.js', '/js/settings.js', '/js/market-ref.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
