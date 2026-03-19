// ══════════════════════════════════════════════════
//  PESA GROW — SERVICE WORKER
//  Enables PWA installation and offline support
// ══════════════════════════════════════════════════

const CACHE_NAME    = 'pesagrow-v1';
const OFFLINE_URL   = '/index.html';

// Files to cache for offline use
const CACHE_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/manifest.json',
];

// ── INSTALL ──────────────────────────────────────
// Cache essential files when SW first installs
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(CACHE_ASSETS);
      })
      .then(() => self.skipWaiting()) // activate immediately
  );
});

// ── ACTIVATE ─────────────────────────────────────
// Clean up old caches when new SW activates
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // take control immediately
  );
});

// ── FETCH ─────────────────────────────────────────
// Network-first strategy:
// - Try network first for fresh content
// - Fall back to cache if offline
// - API calls always go to network (never cached)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always hit the network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'You are offline. Please check your connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // For HTML pages and assets — network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200 && event.request.method === 'GET') {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(event.request)
          .then(cached => cached || caches.match(OFFLINE_URL));
      })
  );
});

// ── BACKGROUND SYNC ──────────────────────────────
// Show notification when app is installed
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
