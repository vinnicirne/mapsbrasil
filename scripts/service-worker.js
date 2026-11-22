const shell = 'mapsbrasil-shell-' + VERSION;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(shell).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('mapsbrasil-shell-') && key !== shell) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(shell).then(cache => cache.match('/index.html'))));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(shell).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
  }
});
