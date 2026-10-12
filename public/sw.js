// Cambia la versión al publicar cambios para que se descarte la caché anterior.
const CACHE = 'nfta-gastos-v4';
const ARCHIVOS = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  // Los datos (/api) siempre van a la red: nunca se guardan gastos en la caché.
  if (ev.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Interfaz: se responde al instante desde la caché y se actualiza en segundo plano.
  ev.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(ev.request);
      const deRed = fetch(ev.request)
        .then((res) => {
          if (res.ok) cache.put(ev.request, res.clone());
          return res;
        })
        .catch(() => guardado);
      return guardado ?? deRed;
    }),
  );
});
