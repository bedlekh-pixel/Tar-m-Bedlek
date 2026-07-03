// Bedlek Tarım Defteri — Service Worker (v2)
// Strateji:
//  - Uygulama dosyaları (index.html, app.js, manifest): ÖNCE AĞ (network-first)
//    → online iken HER ZAMAN güncel kod gelir; sadece çevrimdışında önbelleğe düşer.
//  - Fontlar/ikonlar (çapraz köken + statik): önce önbellek (cache-first).
//  - Supabase / Drive çağrıları: SW hiç karışmaz (her zaman canlı).

const CACHE = 'bedlek-v2';
const KABUK = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(KABUK)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Veri / yedek çağrıları: SW karışmaz (her zaman ağdan, bayat veri riski olmasın)
  if (url.hostname.endsWith('supabase.co') ||
      url.hostname.endsWith('script.google.com') ||
      url.hostname.endsWith('googleusercontent.com')) return;

  // Aynı köken uygulama dosyaları: ÖNCE AĞ (güncel kod), başarısızsa önbellek
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const kopya = res.clone();
          caches.open(CACHE).then((c) => c.put(req, kopya)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Çapraz köken (fontlar vb.): önce önbellek, yoksa ağdan çek + önbelleğe ekle
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const kopya = res.clone();
          caches.open(CACHE).then((c) => c.put(req, kopya)).catch(() => {});
        }
        return res;
      });
    })
  );
});
