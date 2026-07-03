// Bedlek Tarım Defteri — Service Worker
// Amaç: uygulama kabuğunu (index.html, app.js, fontlar) önbelleğe alıp
// tarlada (çevrimdışı) uygulamanın AÇILABİLMESİNİ sağlamak.
// NOT: Supabase API çağrıları asla önbelleğe alınmaz — veri her zaman canlı gelir/gider.

const CACHE = 'bedlek-v1';
const KABUK = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

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
  if (req.method !== 'GET') return;                 // yalnızca GET
  const url = new URL(req.url);

  // Supabase veri çağrıları: her zaman ağdan (önbelleğe ALMA) — bayat veri riski olmasın
  if (url.hostname.endsWith('supabase.co')) return;

  // Uygulama kabuğu + fontlar: önce önbellek, yoksa ağdan çek ve önbelleğe ekle
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Başarılı yanıtları (aynı köken + fontlar) önbelleğe kopyala
        if (res && (res.ok || res.type === 'opaque')) {
          const kopya = res.clone();
          caches.open(CACHE).then((c) => c.put(req, kopya)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html'));  // çevrimdışı gezinme için
    })
  );
});
