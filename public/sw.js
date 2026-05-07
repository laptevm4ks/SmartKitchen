const CACHE_NAME = 'smart-kitchen-v1';
const PRECACHE_URLS = [
  '/style.css',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/images/bg_cartoon.png'
];

// Установка — кешируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Активация — чистим старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Стратегия: Network First для HTML/API, Cache First для статики
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Для статических ресурсов — Cache First
  if (url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|gif|woff2?)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Для остального — Network First (чтобы данные были свежими)
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});
