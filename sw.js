/* ============================================================
   Service Worker — Family School Web
   Стратегія:
     - HTML/CSS/JS оболонка: network-first, з fallback у кеш
     - schedule.json: network-first без кешу (щоб одразу бачити
       нову версію після пушу в репозиторій)
   Щоб форсувати оновлення користувачів — змініть CACHE_VERSION.
   ============================================================ */
'use strict';

const CACHE_VERSION = "fsc-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js"
];

/* ---------- Install: кладемо оболонку в кеш ---------- */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activate: чистимо старі кеші ---------- */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ---------- Fetch: маршрутизація ---------- */
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // schedule.json — завжди свіжий: беремо з мережі, кеш не використовуємо
  if (url.pathname.endsWith("/schedule.json") || url.pathname.endsWith("schedule.json")){
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(() => new Response(
        JSON.stringify({ version: 1, children: [] }),
        { headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Шрифти Google — просто мережа з fallback у кеш
  if (url.origin.includes("fonts.googleapis.com") || url.origin.includes("fonts.gstatic.com")){
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Оболонка: network-first, fallback → кеш
  if (url.origin === self.location.origin){
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200){
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
  }
});