// Offline support: same-origin files are fetched from the network first (so new words and
// app updates arrive immediately) and fall back to the last cached copy when offline.
const CACHE = "slovar-v3";
const SHELL = ["./", "./index.html", "./app.js", "./style.css", "./words.json", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Fonts and icons: cache after first load so the app keeps its look offline.
    if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com") || url.hostname === "cdn.jsdelivr.net") {
      event.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        c.put(req, res.clone());
        return res;
      }))));
    }
    return;
  }
  if (url.pathname.includes("/restore/")) return;
  // "no-cache" revalidates with the server every time, so a new version shows up on the next open
  // instead of after the browser's 10-minute HTTP cache expires.
  event.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html")))
  );
});
