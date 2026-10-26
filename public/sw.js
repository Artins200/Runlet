/* Runlet offline cache (browser mode). Electron loads from file:// and does not need it. */
const CACHE = 'runlet-v1';
const SHELL = ['/', '/index.html', '/dist/bundle.js', '/dist/styles.css', '/public/icon.svg', '/public/manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return; // CDN handled by browser cache
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy).catch(() => {}));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
