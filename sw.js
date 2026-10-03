/* Offline cache for the installed web app. Each release precaches every file at once under a
   new CACHE name (bump it with the version), so a page never mixes files from two releases. */
'use strict';
const CACHE = 'solidlab-2.2.0-ellipse-20261004';
const FILES = ['./', './index.html', './app.js', './geometry.js', './render.js', './diagram.js', './diagram-app.js', './pwa.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('solidlab-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Files outside the release list (e.g. examples) come from the network when online.
    return fetch(request).catch(async () => (await cache.match('./index.html')) || Response.error());
  }));
});
