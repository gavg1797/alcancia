/* Alcancía · service worker: la app abre sin internet con la última versión vista. */
const V = "alcancia-v9";
const SHELL = ["./", "index.html", "app.js", "core.js", "config.js", "icon.svg", "icon-192.png", "manifest.webmanifest",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"];
const CDN = /^https:\/\/(cdn\.sheetjs\.com|cdnjs\.cloudflare\.com)\//;
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => Promise.allSettled(SHELL.map(u => c.add(CDN.test(u) ? u : new Request(u, { cache: "reload" }))))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = e.request.url;
  if (e.request.method !== "GET") return;
  if (CDN.test(u)) {          // bibliotecas con versión fija: primero la copia guardada
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(n => { const c = n.clone(); caches.open(V).then(k => k.put(e.request, c)); return n; })));
  } else if (u.startsWith(self.location.origin)) {   // archivos de la app: primero la red, para recibir actualizaciones
    e.respondWith(fetch(u, { cache: "no-cache" }).then(n => { const c = n.clone(); caches.open(V).then(k => k.put(e.request, c)); return n; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
