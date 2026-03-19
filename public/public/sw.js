// ══════════════════════════════════════════════════
//  PESA GROW — SERVICE WORKER v2
//  Robust PWA install — never fails silently
// ══════════════════════════════════════════════════

const CACHE = 'pesagrow-v2';

// ── INSTALL — cache pages but NEVER fail ──────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Add files one by one — if one fails, others still cache
      const files = ['/', '/index.html', '/dashboard.html', '/manifest.json'];
      for (const file of files) {
        try { await cache.add(file); } catch(e) { console.warn('[SW] Could not cache:', file); }
      }
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — clean old caches ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH — network first, cache fallback ─────────
self.addEventListener('fetch', event => {
  // Skip non-GET and API requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Cache fresh successful responses
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone)).catch(()=>{});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
  );
});

// ── MESSAGE — allow force update ──────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
