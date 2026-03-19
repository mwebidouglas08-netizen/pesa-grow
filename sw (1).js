/* Pesa Grow — Service Worker v4 */
var CACHE = 'pg-v4';

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      /* add one at a time — never fail install */
      return cache.add('/').catch(function(){})
        .then(function(){ return cache.add('/index.html').catch(function(){}); })
        .then(function(){ return cache.add('/manifest.json').catch(function(){}); });
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  /* only handle GET, skip API calls */
  if (e.request.method !== 'GET') return;
  if (e.request.url.indexOf('/api/') !== -1) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response && response.status === 200) {
        var copy = response.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request).then(function(cached){
        return cached || caches.match('/index.html');
      });
    })
  );
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
