// ============================================================
//  Service Worker lexpert — cache offline + auto-update
// ============================================================
// Stratégie :
//   - HTML : network-first (toujours essayer le réseau pour catcher
//     les nouvelles versions ; fallback cache si offline)
//   - Assets statiques (fonts, libs, icones) : stale-while-revalidate
//   - /api/* : network-only (les données sont dynamiques)
// ============================================================

const VERSION = 'v3';
const CACHE_STATIC  = `lexpert-static-${VERSION}`;
const CACHE_RUNTIME = `lexpert-runtime-${VERSION}`;

// Assets précachés à l'installation
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) API : toujours réseau (jamais de cache)
  if (url.pathname.startsWith('/api/')) {
    return; // laisse le browser faire son fetch normal
  }

  // 2) HTML (navigation) : network-first → cache
  const isHtml = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').includes('text/html');
  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // 3) Autres GET (assets) : stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          // Ne cache que les réponses OK et basiques/CORS
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
