const CACHE = "zeno-v1";
const ASSETS = ["/", "/index.html", "/zeno-v6.jsx"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;
  // Don't cache API calls
  if(e.request.url.includes("api.anthropic.com")) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if(res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    })).catch(() => caches.match("/index.html"))
  );
});

// ── Push Notifications ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'ZENO';
  const options = {
    body: data.body || '¿Cómo está tu energía hoy?',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'zeno-reminder',
    renotify: true,
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: '✨ Abrir ZENO' },
      { action: 'dismiss', title: 'Luego' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ── Background sync for scheduled reminders ──
self.addEventListener('periodicsync', event => {
  if (event.tag === 'zeno-daily-checkin') {
    event.waitUntil(
      self.registration.showNotification('ZENO ⚡', {
        body: '¿Cómo está tu energía hoy? Un momento para ti.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'daily-checkin',
        renotify: false,
      })
    );
  }
});
