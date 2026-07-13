const CACHE_NAME = 'rccg-top-v3';
const urlsToCache = [
  '/',
  '/login.html',
  '/index.html',
  '/follow-up.html',
  '/attendance.html',
  '/dashboard.html',
  '/common.js',
  '/manifest.json',
  '/offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Always fetch fresh HTML for main pages, but use cache for assets
  if (event.request.mode === 'navigate' && url.pathname.match(/\.html$/)) {
    event.respondWith(fetch(event.request));
    return;
  }
  // Otherwise, use cache with network fallback
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});