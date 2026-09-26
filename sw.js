/* ============================================================
   Service Worker для «Дитячий розклад»
   Стратегія:
     - App shell (HTML/CSS/JS/іконки) — cache-first + оновлення у фоні
     - API /api/schedule            — network-first + fallback у кеш
     - Інше                         — network-only

   Оновлення нової версії SW: показуємо тост у застосунку,
   користувач тисне «Оновити» — тоді skipWaiting + reload.
   ============================================================ */
'use strict';

/* ⚠️ ЗМІНЮЙТЕ ВЕРСІЮ при кожному релізі — це змусить браузер
   витягнути свіжий кеш замість використовувати старий. */
const VERSION = 'v1.0.2';
const SHELL_CACHE = 'fsc-shell-' + VERSION;
const DATA_CACHE = 'fsc-data-' + VERSION;

/* Список ресурсів, які кешуємо одразу при встановленні SW.
   Іконки не додаємо в precache, щоб SW не впав, якщо їх ще немає —
   вони закешуються ліниво при першому запиті. */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

/* ============ INSTALL ============ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => {
        console.warn('[SW] Precache помилка:', err);
      })
    // НЕ викликаємо skipWaiting() автоматично — чекаємо на команду з клієнта
  );
});

/* ============ ACTIVATE ============ */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Прибираємо старі кеші
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      );
      // Одразу беремо контроль над відкритими вкладками
      await self.clients.claim();
    })()
  );
});

/* ============ MESSAGE (команди з клієнта) ============ */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ============ FETCH ============ */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ігноруємо не-GET (POST/PUT для API йдуть напряму в мережу)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не втручаємось у зовнішні домени (fonts.googleapis.com тощо)
  if (url.origin !== self.location.origin) return;

  // API /api/schedule — network-first з fallback у кеш
  if (url.pathname === '/api/schedule') {
    event.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // Все інше (shell + іконки + інші статичні) — cache-first
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

/* ---------- Стратегії ---------- */

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Оновлюємо кеш у фоні (stale-while-revalidate light)
    fetchAndCache(request, cache).catch(() => {});
    return cached;
  }

  try {
    return await fetchAndCache(request, cache);
  } catch (err) {
    // Якщо шукали навігацію (HTML) і немає мережі й кешу — віддаємо index.html
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // Немає мережі — віддаємо останній збережений розклад
    const cached = await cache.match(request);
    if (cached) return cached;
    // Останній fallback — порожня валідна відповідь, щоб застосунок не впав
    return new Response(
      JSON.stringify({ version: 2, children: [], updatedAt: null, _offline: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function fetchAndCache(request, cache) {
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}