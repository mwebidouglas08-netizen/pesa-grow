/**
 * ============================================================
 *  PESA GROW — Service Worker  (Production PWA)
 *  Strategy:
 *   • App shell  → Cache First (instant load)
 *   • API calls  → Network First with offline fallback
 *   • Images     → Stale-While-Revalidate
 *   • Offline    → Serve /offline.html
 * ============================================================
 */

const CACHE_VERSION  = 'pg-v2';
const SHELL_CACHE    = `${CACHE_VERSION}-shell`;
const API_CACHE      = `${CACHE_VERSION}-api`;
const IMAGE_CACHE    = `${CACHE_VERSION}-img`;

// Files cached immediately on install (app shell)
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/admin.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Google Fonts (cache on first visit via install)
];

// API routes to cache for offline reading
const CACHEABLE_API = [
  '/api/plans',
  '/api/settings/public',
  '/api/health',
];

// ── Install: cache app shell ───────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      // Cache shell assets — ignore failures (some may not exist yet)
      return Promise.allSettled(
        SHELL_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] Could not cache:', url, e.message))
        )
      );
    }).then(() => {
      console.log('[SW] Shell cached');
      return self.skipWaiting();   // Activate immediately
    })
  );
});

// ── Activate: delete old caches ───────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('pg-') && k !== SHELL_CACHE && k !== API_CACHE && k !== IMAGE_CACHE)
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // ── API requests → Network First ──────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request, url));
    return;
  }

  // ── Images → Stale-While-Revalidate ───────────────
  if (/\.(png|jpg|jpeg|svg|webp|gif|ico)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  // ── Google Fonts → Stale-While-Revalidate ─────────
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  // ── App shell → Cache First ────────────────────────
  event.respondWith(cacheFirstShell(request));
});

// ── Strategy: Network First (API) ─────────────────────────
async function networkFirstApi(request, url) {
  const isCacheable = CACHEABLE_API.some(p => url.pathname === p);
  try {
    const response = await fetch(request.clone());
    // Cache successful public API responses
    if (response.ok && isCacheable) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — try cache
    if (isCacheable) {
      const cached = await caches.match(request);
      if (cached) {
        console.log('[SW] Serving API from cache:', url.pathname);
        return cached;
      }
    }
    // Return offline JSON response for API calls
    return new Response(
      JSON.stringify({ error: 'You are offline. Please check your connection.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Strategy: Cache First (shell) ─────────────────────────
async function cacheFirstShell(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — serve offline page for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      const offlinePage = await caches.match('/offline.html');
      return offlinePage || new Response('<h1>You are offline</h1>', { headers: { 'Content-Type': 'text/html' } });
    }
    return new Response('Offline', { status: 503 });
  }
}

// ── Strategy: Stale-While-Revalidate ──────────────────────
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Fetch in background to update cache
  const fetchPromise = fetch(request.clone()).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || await fetchPromise ||
    new Response('', { status: 404 });
}

// ── Background Sync: retry failed deposits/withdrawals ────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncPendingTransactions());
  }
});

async function syncPendingTransactions() {
  // Notify all open clients to retry pending operations
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_TRANSACTIONS' });
  });
}

// ── Push Notifications ─────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'Pesa Grow', body: event.data.text() }; }

  const options = {
    body:    data.body || 'You have a new notification',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || '/dashboard.html' },
    actions: [
      { action: 'open',    title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    tag:     data.tag || 'pg-notification',
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Pesa Grow 💰', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/dashboard.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else self.clients.openWindow(url);
    })
  );
});

// ── Skip waiting on message ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
