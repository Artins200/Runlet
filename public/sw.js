/* Runlet offline cache (browser mode). Electron loads from file:// and does not need it.
   The shell HTML contains a per-process API token, so it is cached WITHOUT the
   token and always fetched network-first. Static assets are cache-first. */
const CACHE = 'runlet-v2';
const ASSETS = ['/dist/bundle.js', '/dist/styles.css', '/public/icon.svg', '/public/manifest.webmanifest'];
const TOKEN_META = /(name="runlet-api-token" content=")[a-f0-9]{32,128}(")/i;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;   // CDN handled by browser cache

  const isShell = req.mode === 'navigate' || url.pathname === '/' || /\.html?$/i.test(url.pathname);
  if (isShell) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        const body = await res.text();
        // Never persist a live API token in the offline cache.
        const safe = body.replace(TOKEN_META, '$1$2');
        await cache.put('/offline-shell.html', new Response(safe, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }));
        return new Response(safe, { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch (_) {
        return (await cache.match('/offline-shell.html')) ||
          new Response('<!doctype html><meta charset="utf-8"><h1>Runlet — офлайн</h1><p>Запустите редактор онлайн, чтобы обновить ресурсы.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy).catch(() => {}));
      return res;
    }).catch(() => caches.match('/offline-shell.html')))
  );
});
