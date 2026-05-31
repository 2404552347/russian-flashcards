// Service Worker for 多语言单词闪卡 PWA
const CACHE_NAME = 'flashcards-v2';
const ASSETS = [
  '.',
  'index.html',
  'js/app.js',
  'css/style.css',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// Install: cache all core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => {
        console.warn('SW: cache addAll partial failure', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for HTML, cache-first for static assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip cross-origin requests (except Font Awesome which we cache)
  if (url.origin !== location.origin && !url.href.includes('cdnjs.cloudflare.com')) {
    return;
  }

  // For navigation requests (HTML), use network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // For static assets, use cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
