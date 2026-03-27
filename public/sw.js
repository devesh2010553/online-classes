/* EduStream Service Worker v3 */
const CACHE = "edustream-v3";
const PRECACHE = ["/", "/css/style.css", "/js/main.js", "/js/room.js", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.url.includes("socket.io") || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return res; })
      .catch(() => caches.match(e.request))
  );
});