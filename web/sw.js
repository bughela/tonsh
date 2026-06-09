// Minimal service worker: exists so the app is installable and the static
// shell loads fast / survives a brief network blip. tonsh needs a live
// WebSocket to the server to do anything, so this is not real offline support.
const CACHE = 'tonsh-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/bundle.js',
  '/style.css',
  '/xterm.css',
  '/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (request.headers.get('upgrade') === 'websocket') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // live data: always hit the network

  // Network-first: the server is normally online, so prefer fresh assets and
  // pick up rebuilds immediately; fall back to cache only when offline.
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/index.html')))
  );
});
