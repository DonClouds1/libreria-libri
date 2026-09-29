const CACHE_NAME = 'libreria-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './lib.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Le chiamate alle API di ricerca libri: sempre dalla rete (non ha senso cachearle a lungo)
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('openlibrary.org')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({ items: [] }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // App shell: cache-first, con aggiornamento in background
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
