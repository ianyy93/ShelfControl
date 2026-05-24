self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', () => {
  // empty fetch handler is enough for PWA installation
  // Version 2: bust cache
});
